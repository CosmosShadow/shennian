// @arch docs/architecture/session-organization.md
// @arch docs/features/desktop-page-state-matrix.md#project-and-personal-session-closure
// @test ../../__tests__/desktop-project-screen-model.test.ts
import type { AgentType, NianProject } from '@shennian/wire'
import type { SessionPageResult } from '../account-runtime/accountRuntime.types'
import type { ProjectSessionPageFailure } from '../projects/services/projectSessionPageState'

export function isDesktopProjectAlias(workDir: string) { return /^~(?:[\\/]|$)/.test(workDir.trim()) }
export function canLaunchDesktopProject(input: { accountId: string; projectAvailable: boolean; machineAvailable: boolean; workDir: string; machineState: string; forbidden: boolean }) {
  return Boolean(input.accountId && input.projectAvailable && input.machineAvailable &&
    !isDesktopProjectAlias(input.workDir) && !input.forbidden && input.machineState === 'online')
}
export function desktopProjectFailure(error: unknown, connected: boolean): ProjectSessionPageFailure {
  const value = error && typeof error === 'object' ? error as { code?: string; status?: number } : {}
  if ([401, 403, 404].includes(Number(value.status)) ||
    ['AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'PROJECT_UNAVAILABLE'].includes(value.code ?? '')) return 'forbidden'
  if (!connected || ['OFFLINE', 'MACHINE_OFFLINE', 'NETWORK_UNAVAILABLE'].includes(value.code ?? '')) return 'offline'
  return 'error'
}
export function desktopProjectLaunchDefaults(project: {
  defaultAgentType?: AgentType | null; defaultModelId?: string | null
  latestAgentType?: AgentType | null; latestModelId?: string | null
}) {
  return project.defaultAgentType
    ? { preferredAgentType: project.defaultAgentType, preferredModelId: project.defaultModelId ?? null }
    : { preferredAgentType: project.latestAgentType, preferredModelId: project.latestModelId }
}
export type DesktopProjectPageState = {
  loading: boolean; attempted: boolean; resolvingAlias: boolean; hasMore: boolean
  before?: number; failure: ProjectSessionPageFailure | null
}
type Scope = { accountId: string; machineId: string; workDir: string; projectId: string | null; online: boolean }
type Dependencies = {
  accountId(): string | null
  connected(): boolean
  canonicalize(input: { machineId: string; workDir: string }): Promise<{ project: NianProject }>
  loadPage(projectId: string, page: { limit: number; before?: number }): Promise<SessionPageResult>
  navigate(project: NianProject): void
}
const initial = (): DesktopProjectPageState => ({ loading: false, attempted: false, resolvingAlias: false, hasMore: true, failure: null })

export class DesktopProjectScreenModel {
  private state = initial()
  private scope: Scope | null = null
  private generation = 0
  private busy = false
  private endLocked = false
  private listeners = new Set<() => void>()
  constructor(private readonly dependencies: Dependencies) {}
  getState = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(next: Partial<DesktopProjectPageState>) {
    this.state = { ...this.state, ...next }; this.listeners.forEach((listener) => listener())
  }
  dispose() { this.generation++; this.scope = null; this.busy = false }
  open(scope: Scope) {
    this.generation++; this.scope = scope; this.busy = false; this.endLocked = false
    this.state = initial(); this.update({ resolvingAlias: isDesktopProjectAlias(scope.workDir) })
    void this.retry()
  }
  scrollBegin() { this.endLocked = false }
  endReached() {
    if (this.endLocked) return
    this.endLocked = true
    void this.load(false)
  }
  retry = async () => {
    const scope = this.scope
    if (!scope || this.busy) return
    if (!scope.accountId || this.dependencies.accountId() !== scope.accountId) { this.update({ attempted: true, failure: 'forbidden' }); return }
    if (!isDesktopProjectAlias(scope.workDir)) { await this.load(true); return }
    if (!scope.online) { this.update({ resolvingAlias: true, attempted: true, failure: 'offline' }); return }
    const generation = this.generation
    this.busy = true
    this.update({ resolvingAlias: true, loading: true, failure: null, attempted: true })
    try {
      const { project } = await this.dependencies.canonicalize({ machineId: scope.machineId, workDir: scope.workDir })
      if (!this.current(generation, scope)) return
      if (project.machineId !== scope.machineId || isDesktopProjectAlias(project.workDir)) throw new Error('invalid_canonical_project')
      // The canonical route owns paging. Never load a legacy alias namespace.
      this.dependencies.navigate(project)
    } catch (error) {
      if (this.current(generation, scope)) this.update({ failure: desktopProjectFailure(error, this.dependencies.connected()) })
    } finally {
      if (this.current(generation, scope)) { this.busy = false; this.update({ loading: false }) }
    }
  }
  private current(generation: number, scope: Scope) {
    return generation === this.generation && this.scope === scope && this.dependencies.accountId() === scope.accountId
  }
  private async load(reset: boolean) {
    const scope = this.scope
    if (!scope || this.busy || isDesktopProjectAlias(scope.workDir) || (!reset && !this.state.hasMore)) return
    if (!scope.projectId) { this.update({ attempted: true }); return }
    const generation = this.generation
    this.busy = true
    this.update({ loading: true, attempted: true, failure: this.state.failure === 'forbidden' ? 'forbidden' : null })
    try {
      const result = await this.dependencies.loadPage(scope.projectId, { limit: 100, before: reset ? undefined : this.state.before })
      if (!this.current(generation, scope)) return
      if (typeof result.hasMore !== 'boolean' || (result.nextBefore != null && !Number.isFinite(result.nextBefore))) throw new Error('invalid_project_page')
      this.update({ hasMore: result.hasMore, before: result.nextBefore ?? undefined, failure: null })
    } catch (error) {
      if (this.current(generation, scope)) this.update({ failure: desktopProjectFailure(error, this.dependencies.connected()) })
    } finally {
      if (this.current(generation, scope)) { this.busy = false; this.update({ loading: false }) }
    }
  }
}
