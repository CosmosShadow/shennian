// @arch docs/features/desktop-project-creation.md
// @test ../../__tests__/desktop-project-directory-picker.test.ts
import type { FsEntry, ResFrame } from '@shennian/wire'
import { FILE_SYSTEM_ROOTS_PATH, canGoUp, getParentDirectoryPath } from '../../utils/directoryNavigation'
import { filterDirBrowserEntries, getVisibleDirBrowserEntries, DIR_BROWSER_WEB_PAGE_SIZE } from '../../utils/dirBrowserEntries'

type State = { path: string; entries: FsEntry[]; query: string; visibleCount: number; loading: boolean; error: string | null }
type Options = { machineId: string; initialPath: string; isCurrent(): boolean; list(machineId: string, path: string): Promise<ResFrame> }
const absolute = (path: string) => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
function parseListing(value: unknown): { path: string; entries: FsEntry[] } {
  if (!value || typeof value !== 'object') throw new Error('directory_load_failed')
  const { path, entries } = value as { path?: unknown; entries?: unknown }
  if (typeof path !== 'string' || path.length > 4096 || (!absolute(path) && path !== FILE_SYSTEM_ROOTS_PATH)
    || !Array.isArray(entries) || entries.some(entry => !entry || typeof entry.name !== 'string' || typeof entry.path !== 'string' || typeof entry.isDir !== 'boolean')) throw new Error('directory_load_failed')
  return { path, entries: entries.map(entry => ({ name: entry.name, path: entry.path, isDir: entry.isDir })) }
}
export class DesktopProjectDirectoryModel {
  private state: State = { path: '', entries: [], query: '', visibleCount: DIR_BROWSER_WEB_PAGE_SIZE, loading: true, error: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private active = false
  private attemptedPath: string
  constructor(private readonly options: Options) { this.attemptedPath = options.initialPath || '~' }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  start(): void { this.active = true; void this.navigate(this.options.initialPath || '~') }
  stop(): void {
    this.active = false; this.generation++
    this.publish({ path: '', entries: [], query: '', visibleCount: DIR_BROWSER_WEB_PAGE_SIZE, loading: false, error: null })
  }
  isCurrent = () => this.active && this.options.isCurrent()
  async navigate(path: string): Promise<void> {
    if (!this.isCurrent()) return
    const generation = ++this.generation
    this.attemptedPath = path
    this.publish({ path: '', entries: [], query: '', visibleCount: DIR_BROWSER_WEB_PAGE_SIZE, loading: true, error: null })
    try {
      const response = await this.options.list(this.options.machineId, path)
      if (!this.isCurrent() || generation !== this.generation) return
      if (!response.ok) throw new Error(response.error || 'directory_load_failed')
      const listing = parseListing(response.payload)
      this.publish({ ...this.state, ...listing, loading: false })
    } catch (error) {
      if (this.isCurrent() && generation === this.generation) this.publish({ ...this.state, loading: false, error: error instanceof Error ? error.message : 'directory_load_failed' })
    }
  }
  retry = () => this.navigate(this.attemptedPath)
  home = () => this.navigate('~')
  roots = () => this.navigate(FILE_SYSTEM_ROOTS_PATH)
  up = () => { if (canGoUp(this.state.path)) void this.navigate(getParentDirectoryPath(this.state.path)) }
  search = (query: string) => { if (this.isCurrent()) this.publish({ ...this.state, query, visibleCount: DIR_BROWSER_WEB_PAGE_SIZE }) }
  more = () => { if (this.isCurrent()) this.publish({ ...this.state, visibleCount: this.state.visibleCount + DIR_BROWSER_WEB_PAGE_SIZE }) }
  visible() {
    const filtered = filterDirBrowserEntries(this.state.entries, this.state.query)
    return { entries: getVisibleDirBrowserEntries(filtered, this.state.visibleCount), count: filtered.length, remaining: Math.max(0, filtered.length - this.state.visibleCount) }
  }
  selectedPath(): string | null {
    return this.isCurrent() && !this.state.loading && !this.state.error && absolute(this.state.path) ? this.state.path : null
  }
  private publish(state: State): void { this.state = state; this.listeners.forEach(listener => listener()) }
}
