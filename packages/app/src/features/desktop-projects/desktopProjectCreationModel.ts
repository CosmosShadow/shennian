// @arch docs/features/desktop-project-creation.md
// @test ../../__tests__/desktop-project-creation.test.ts
import type { Machine, NianProject } from '@shennian/wire'

type Options = {
  accountId: string
  machineId: string
  initialWorkDir: string
  current(): {
    accountId: string | null
    machine: Machine | undefined
    connected: boolean
    available: boolean
  }
  canonicalize(input: { machineId: string; workDir: string }): Promise<{ project: NianProject }>
  onCreated(project: NianProject): void
  describeError(error: unknown): string
}

export class DesktopProjectCreationModel {
  private active = false
  private generation = 0
  private state: {
    workDir: string
    pending: boolean
    error: string
    focusWorkDirRequest: number
  }
  private listeners = new Set<() => void>()
  constructor(private readonly options: Options) {
    this.state = {
      workDir: options.initialWorkDir,
      pending: false,
      error: '',
      focusWorkDirRequest: 0,
    }
  }
  getState = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  start = () => {
    this.active = true
    this.generation++
    this.update({ ...this.state, pending: false, error: '' })
    return () => { this.active = false; this.generation++ }
  }
  setWorkDir = (workDir: string) => {
    if (!this.active || this.state.pending) return
    this.update({ ...this.state, workDir, error: '' })
  }
  setExternalError = (error: string) => {
    if (!this.active || this.state.pending) return
    this.update({
      ...this.state,
      error,
      focusWorkDirRequest: this.state.focusWorkDirRequest + 1,
    })
  }
  private update(next: typeof this.state) { this.state = next; this.listeners.forEach(listener => listener()) }
  private current(generation: number) {
    return this.active && this.generation === generation && Boolean(this.options.accountId) && this.options.current().accountId === this.options.accountId
  }
  async create(): Promise<void> {
    const generation = this.generation
    if (!this.current(generation) || this.state.pending) return
    const current = this.options.current()
    const machine = current.machine
    const path = this.state.workDir.trim()
    try {
      if (!path || !/^(?:~(?:[\\/]|$)|\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) throw new Error('project_context_required')
      if (!current.connected || !current.available || !machine ||
          machine.id !== this.options.machineId || machine.remoteAccessDisabledAt) {
        throw new Error('machine_offline_error')
      }
      if (machine.role === 'granted' && machine.permission === 'view') throw new Error('permission_denied')
      this.update({ ...this.state, pending: true, error: '' })
      const { project } = await this.options.canonicalize({ machineId: this.options.machineId, workDir: path })
      if (!this.current(generation)) return
      const latest = this.options.current().machine
      if (!latest || latest.id !== this.options.machineId || (latest.role === 'granted' && latest.permission === 'view')) throw new Error('permission_denied')
      if (!project?.id || project.machineId !== this.options.machineId || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(project.workDir)) throw new Error('desktop_project_invalid_result')
      this.options.onCreated(project)
    } catch (error) {
      if (this.current(generation)) this.update({
        ...this.state,
        pending: false,
        error: this.options.describeError(error),
        focusWorkDirRequest: this.state.focusWorkDirRequest + 1,
      })
    } finally {
      if (this.current(generation) && this.state.pending) this.update({ ...this.state, pending: false })
    }
  }
}
