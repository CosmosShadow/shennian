// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test ../../__tests__/desktop-agent-detail-projection.test.ts
import type { AgentWorkspace } from '@shennian/wire'

type State = { agent: AgentWorkspace | null; repairing: boolean; failed: boolean }
type Options = {
  agentId: string
  isCurrent(): boolean
  read(): Promise<AgentWorkspace | null>
  recover(agentId: string): Promise<AgentWorkspace>
  subscribeRevision(listener: () => void): () => void
  requestSync(): Promise<unknown>
  onUnavailable(): void
}

/** Desktop detail observes main's full Agent projection; never persists a response in renderer. */
export class DesktopAgentDetailProjection {
  private value: State = { agent: null, repairing: false, failed: false }
  private listeners = new Set<() => void>()
  private generation = 0
  private stopped = true
  private pending = false
  private committedRevision = false
  private running: Promise<void> | null = null
  constructor(private readonly options: Options) {}
  getState = (): State => this.value
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  isCurrent = (): boolean => !this.stopped && this.options.isCurrent()
  private valid(generation: number): boolean { return this.isCurrent() && generation === this.generation }
  private update(patch: Partial<State>): void {
    if (!this.isCurrent()) return
    this.value = { ...this.value, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  start = (): (() => void) => {
    this.stopped = false
    const generation = ++this.generation
    this.running = null
    this.pending = false
    this.committedRevision = false
    this.update({ repairing: false })
    const unsubscribe = this.options.subscribeRevision(() => {
      this.committedRevision = true
      void this.read()
    })
    void this.read()
    return () => {
      unsubscribe()
      if (generation !== this.generation) return
      this.stopped = true
      this.generation++
      this.running = null
    }
  }
  read = (): Promise<void> => {
    if (!this.isCurrent()) return Promise.resolve()
    this.pending = true
    if (this.running) return this.running
    const generation = this.generation
    const running = Promise.resolve().then(async () => {
      while (this.pending && this.valid(generation)) {
        this.pending = false
        const committed = this.committedRevision
        this.committedRevision = false
        try {
          const agent = await this.options.read()
          if (!this.valid(generation)) return
          if (this.pending) { this.committedRevision ||= committed; continue }
          if (agent && agent.id !== this.options.agentId) throw new Error('Agent projection identity is invalid.')
          this.update({ agent, failed: !agent })
          // Replica reconciliation can publish a committed revision while its
          // replacement snapshot is still being installed. A transient null is
          // therefore not authority to navigate away from the user's restored
          // workspace. Explicit delete actions already leave the page; a missing
          // projection remains here with retry so restart recovery is stable.
        } catch (error) {
          if (!this.valid(generation)) return
          if (this.pending) continue
          const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
          if (code === 'AUTH_REQUIRED' || code === 'FORBIDDEN') {
            this.update({ agent: null, failed: true })
            this.options.onUnavailable()
          } else this.update({ failed: true })
        }
      }
    }).finally(() => { if (this.running === running) this.running = null })
    this.running = running
    return running
  }
  refresh = async (): Promise<void> => {
    const generation = this.generation
    if (!this.valid(generation)) return
    try { await this.options.requestSync() } catch { /* Existing local detail remains readable offline. */ }
    if (this.valid(generation)) await this.read()
  }
  repair = async (): Promise<void> => {
    const generation = this.generation
    if (!this.valid(generation) || this.value.repairing || this.value.agent?.repairAction !== 'retry') return
    this.update({ repairing: true })
    try {
      const recovered = await this.options.recover(this.options.agentId)
      if (!this.valid(generation)) return
      if (recovered.id !== this.options.agentId) throw new Error('Agent recovery identity is invalid.')
      // Main commits and broadcasts the result. Do not manufacture a local replacement or Session links.
      await this.refresh()
    } catch (error) {
      if (this.valid(generation)) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
        if (code === 'AUTH_REQUIRED' || code === 'FORBIDDEN') {
          this.update({ agent: null, failed: true })
          this.options.onUnavailable()
        }
      }
      throw error
    } finally { if (this.valid(generation)) this.update({ repairing: false }) }
  }
}
