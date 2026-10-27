// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test ../../__tests__/desktop-agent-list-projection.test.ts
import type { AgentWorkspace } from '@shennian/wire'
type State = { agents: AgentWorkspace[]; loading: boolean; failed: boolean }
type Options = {
  initial: AgentWorkspace[] | null
  isCurrent(): boolean
  read(): Promise<AgentWorkspace[]>
  subscribeRevision(listener: () => void): () => void
  requestSync(): Promise<unknown>
  onSnapshot(agents: AgentWorkspace[]): void
}
export class DesktopAgentListProjection {
  private state: State
  private listeners = new Set<() => void>()
  private revision = 0
  private lifetime = 0
  private active = false
  private pending = false
  private runningLifetime: number | null = null
  constructor(private readonly options: Options) {
    this.state = { agents: options.initial ?? [], loading: options.initial === null, failed: false }
  }
  getState = (): State => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private current(): boolean { return this.active && this.options.isCurrent() }
  private update(state: State): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
  start(): () => void {
    this.active = true
    const lifetime = ++this.lifetime
    const unsubscribe = this.options.subscribeRevision(() => this.refresh())
    this.refresh()
    return () => {
      unsubscribe()
      if (lifetime !== this.lifetime) return
      this.active = false
      this.lifetime += 1
      this.revision += 1
      this.pending = false
    }
  }
  private refresh = (): void => {
    if (!this.current()) return
    this.revision += 1
    this.pending = true
    if (this.runningLifetime !== this.lifetime) void this.drain()
  }
  private async drain(): Promise<void> {
    const lifetime = this.lifetime
    this.runningLifetime = lifetime
    try {
      while (this.pending && this.current() && lifetime === this.lifetime) {
        this.pending = false
        const revision = this.revision
        try {
          const agents = await this.options.read()
          if (!this.current() || lifetime !== this.lifetime || revision !== this.revision) continue
          this.options.onSnapshot(agents)
          this.update({ agents, loading: false, failed: false })
        } catch {
          if (this.current() && lifetime === this.lifetime && revision === this.revision) {
            this.update({ ...this.state, loading: false, failed: true })
          }
        }
      }
    } finally {
      if (this.runningLifetime === lifetime) this.runningLifetime = null
    }
  }
  retry = async (): Promise<void> => {
    if (!this.current()) return
    const lifetime = this.lifetime
    try {
      await this.options.requestSync()
    } catch {
      if (this.current() && lifetime === this.lifetime) this.update({ ...this.state, loading: false, failed: true })
      return
    }
    if (this.current() && lifetime === this.lifetime) this.refresh()
  }
}
