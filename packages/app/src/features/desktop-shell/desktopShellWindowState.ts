// @arch docs/design/desktop/unified-desktop-control.md#窗口与状态协议设计约束非新增-wire
// @arch docs/features/desktop-local-first-client.md#项目展开偏好
// @test ../../__tests__/desktop-shell-window-state.test.ts
import { sanitizeDesktopRecoveryHref } from '../../utils/desktopCrashRecovery'
import { DESKTOP_SIDEBAR_MIN_WIDTH, DESKTOP_SIDEBAR_MAX_WIDTH } from './desktopSidebarWidth'

export type DesktopShellNavigation = {
  sidebarVisible: boolean
  projectsOpen: boolean; roomsOpen: boolean; agentsOpen: boolean; machinesOpen: boolean
  expandedKeys: Record<string, boolean>; visibleSessionCounts: Record<string, number>; scrollOffset: number
  projectExpansionOverrides: Record<string, boolean>
  /** Explicit first-level disclosure choices; the `*Open` flags above also hold temporary navigation reveals. */
  sectionOverrides: DesktopShellSectionOverrides
}
export type DesktopShellSection = 'projects' | 'rooms' | 'agents'
export type DesktopShellSectionOverrides = Partial<Record<DesktopShellSection, boolean>>
/** Every group starts open; the first explicit disclosure click becomes that account's preference. */
export const DESKTOP_SECTION_DEFAULT_OPEN: Record<DesktopShellSection, boolean> = { projects: true, rooms: true, agents: true }
const SECTION_KEYS = ['projects', 'rooms', 'agents'] as const
function sectionOverrides(value: unknown): DesktopShellSectionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: DesktopShellSectionOverrides = {}
  for (const key of SECTION_KEYS) {
    const entry = (value as Record<string, unknown>)[key]
    if (typeof entry === 'boolean') result[key] = entry
  }
  return result
}
function sectionOpenState(overrides: DesktopShellSectionOverrides) {
  return {
    projectsOpen: overrides.projects ?? DESKTOP_SECTION_DEFAULT_OPEN.projects,
    roomsOpen: overrides.rooms ?? DESKTOP_SECTION_DEFAULT_OPEN.rooms,
    agentsOpen: overrides.agents ?? DESKTOP_SECTION_DEFAULT_OPEN.agents,
  }
}
export type DesktopShellDraftReference = { kind: 'room'; roomId: string } | { kind: 'session'; sessionId: string; roomId?: string }
export type DesktopShellReadingPosition = { scrollTop: number; distanceFromBottom: number; savedAt: number }
export type DesktopShellReadingScope = { kind: 'room' | 'session'; id: string }
export type DesktopShellWindowSnapshot = {
  version: 3; accountId: string; href: string | null; draftReferences: DesktopShellDraftReference[]
  navigation: DesktopShellNavigation
  panels: { fileWidth: number | null; navigationWidth?: number | null; agentNavigationWidth?: number | null; roomSplitWidth?: number | null }
  readingPositions: Record<string, DesktopShellReadingPosition>
}
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>
const STORAGE_KEY = 'shennian.desktop.windowState.v3'
export function createDesktopShellSnapshot(accountId: string): DesktopShellWindowSnapshot {
  return { version: 3, accountId, href: null, draftReferences: [], panels: { fileWidth: null }, readingPositions: {}, navigation: {
    sidebarVisible: true, ...sectionOpenState({}), machinesOpen: false, sectionOverrides: {},
    expandedKeys: {}, projectExpansionOverrides: {}, visibleSessionCounts: {}, scrollOffset: 0,
  } }
}
function validSplitWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 240 && value <= 10000 ? value : null
}
function readingKey(scope: DesktopShellReadingScope): string | null {
  if (!scope.id || scope.id.length > 4096 || /[\x00-\x1f\x7f]/.test(scope.id)) return null
  return `${scope.kind}:${scope.id}`
}
function readingPositions(value: unknown): Record<string, DesktopShellReadingPosition> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length > 1000) return null
  const result: Record<string, DesktopShellReadingPosition> = {}
  for (const [key, position] of entries) {
    if (!/^(room|session):[^\x00-\x1f\x7f]{1,4096}$/.test(key) || !position || typeof position !== 'object') return null
    const item = position as Record<string, unknown>
    if (
      typeof item.scrollTop !== 'number' || !Number.isFinite(item.scrollTop) || item.scrollTop < 0 ||
      typeof item.distanceFromBottom !== 'number' || !Number.isFinite(item.distanceFromBottom) || item.distanceFromBottom < 0 ||
      typeof item.savedAt !== 'number' || !Number.isFinite(item.savedAt) || item.savedAt < 0
    ) return null
    result[key] = { scrollTop: item.scrollTop, distanceFromBottom: item.distanceFromBottom, savedAt: item.savedAt }
  }
  return result
}
function draftReferences(href: string): DesktopShellDraftReference[] {
  const url = new URL(href, 'https://desktop.shennian.invalid')
  const session = /^\/chat\/([^/]+)$/.exec(url.pathname)
  if (session) return [{ kind: 'session', sessionId: session[1]! }]
  const roomId = url.searchParams.get('roomId')
  if (url.pathname !== '/room-workspace' || !roomId) return []
  const agentSessionId = url.searchParams.get('agentSessionId') ?? url.searchParams.get('scopedAgentSessionId')
  return [{ kind: 'room', roomId }, ...(agentSessionId ? [{ kind: 'session' as const, sessionId: agentSessionId, roomId }] : [])]
}
function navigation(value: unknown): DesktopShellNavigation | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const base = createDesktopShellSnapshot('').navigation
  // Older v3 snapshots predate the collapsible rail. Preserve all their state.
  if (v.sidebarVisible !== undefined && typeof v.sidebarVisible !== 'boolean') return null
  base.sidebarVisible = typeof v.sidebarVisible === 'boolean' ? v.sidebarVisible : true
  for (const key of ['projectsOpen', 'roomsOpen', 'agentsOpen', 'machinesOpen'] as const) {
    if (typeof v[key] !== 'boolean') return null
    base[key] = v[key]
  }
  if (typeof v.scrollOffset !== 'number' || !Number.isFinite(v.scrollOffset) || v.scrollOffset < 0 || v.scrollOffset > 10_000_000) return null
  base.scrollOffset = v.scrollOffset
  for (const key of ['expandedKeys', 'projectExpansionOverrides', 'visibleSessionCounts'] as const) {
    // Older snapshots contain auto-expanded keys, not durable user choices.
    const map = key === 'projectExpansionOverrides' && v[key] === undefined ? {} : v[key]
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length > 2000) return null
    for (const [id, entry] of Object.entries(map)) {
      if (!id || id.length > 4096 || /[\x00-\x1f\x7f]/.test(id)) return null
      if (key !== 'visibleSessionCounts') { if (typeof entry !== 'boolean') return null }
      else if (!Number.isSafeInteger(entry) || entry < 1 || entry > 100_000) return null
    }
    if (key !== 'visibleSessionCounts') base[key] = { ...map } as Record<string, boolean>
    else base.visibleSessionCounts = { ...map } as Record<string, number>
  }
  // Snapshots written before first-level preferences existed simply carry no override.
  base.sectionOverrides = sectionOverrides(v.sectionOverrides)
  return base
}

/** Persisted non-sensitive window state is scoped to the installed Desktop profile and account. */
export class DesktopShellWindowStateStore {
  private snapshots = new Map<string, DesktopShellWindowSnapshot>()
  private listeners = new Set<() => void>()
  private scrollSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(private readonly storage: () => StoragePort | null) {}
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  get(accountId: string): DesktopShellWindowSnapshot {
    const cached = this.snapshots.get(accountId)
    if (cached) return cached
    let snapshot = createDesktopShellSnapshot(accountId)
    if (accountId) {
      try {
        const raw = this.storage()?.getItem(`${STORAGE_KEY}:${encodeURIComponent(accountId)}`)
        if (raw && raw.length <= 256 * 1024) {
          const stored = JSON.parse(raw) as Partial<DesktopShellWindowSnapshot>
          const nav = navigation(stored.navigation)
          const fileWidth = stored.panels?.fileWidth
          const navigationWidth = stored.panels?.navigationWidth
          const validNavigationWidth = navigationWidth == null || (typeof navigationWidth === 'number' && Number.isFinite(navigationWidth) && navigationWidth >= DESKTOP_SIDEBAR_MIN_WIDTH && navigationWidth <= DESKTOP_SIDEBAR_MAX_WIDTH)
          const validPanel = fileWidth === null || (typeof fileWidth === 'number' && Number.isFinite(fileWidth) && fileWidth > 0 && fileWidth <= 100_000)
          const positions = readingPositions(stored.readingPositions)
          if (stored.version === 3 && stored.accountId === accountId && nav && validPanel && validNavigationWidth && positions) {
            const href = sanitizeDesktopRecoveryHref(stored.href)
            snapshot = { version: 3, accountId, href, navigation: { ...nav, ...sectionOpenState(nav.sectionOverrides), expandedKeys: { ...nav.projectExpansionOverrides }, visibleSessionCounts: {} }, panels: { fileWidth: fileWidth ?? null, navigationWidth: navigationWidth ?? null, agentNavigationWidth: validSplitWidth(stored.panels?.agentNavigationWidth), roomSplitWidth: validSplitWidth(stored.panels?.roomSplitWidth) }, readingPositions: positions, draftReferences: href ? draftReferences(href) : [] }
          }
        }
      } catch { /* Invalid or unavailable local preferences do not carry authority. */ }
    }
    this.snapshots.set(accountId, snapshot)
    return snapshot
  }
  recordLocation(accountId: string, href: string): boolean {
    const safe = sanitizeDesktopRecoveryHref(href)
    if (!accountId || !safe) return false
    const previous = this.get(accountId)
    if (previous.href === safe) return true
    this.commit({ ...previous, href: safe, draftReferences: draftReferences(safe) })
    return true
  }
  updateNavigation(accountId: string, update: (current: DesktopShellNavigation) => DesktopShellNavigation): void {
    if (!accountId) return
    const current = this.get(accountId)
    const next = update(current.navigation)
    if (next === current.navigation) return
    const checked = navigation(next)
    if (!checked) throw new Error('Invalid Desktop navigation state')
    this.commit({ ...current, navigation: checked })
  }
  /** Only an explicit disclosure action becomes a preference across window restarts. */
  setProjectExpanded(accountId: string, projectKey: string, expanded: boolean): void {
    this.updateNavigation(accountId, current => ({
      ...current,
      expandedKeys: { ...current.expandedKeys, [projectKey]: expanded },
      projectExpansionOverrides: { ...current.projectExpansionOverrides, [projectKey]: expanded },
    }))
  }
  /** Only an explicit disclosure action becomes a first-level preference; route reveals use `updateNavigation`. */
  setSectionExpanded(accountId: string, section: DesktopShellSection, expanded: boolean): void {
    this.updateNavigation(accountId, current => ({
      ...current,
      ...(section === 'projects' ? { projectsOpen: expanded } : section === 'rooms' ? { roomsOpen: expanded } : { agentsOpen: expanded }),
      sectionOverrides: { ...current.sectionOverrides, [section]: expanded },
    }))
  }
  /** Scrolling is not a navigation change: keep it out of React subscriptions and
   * coalesce synchronous localStorage writes until the scroll gesture settles. */
  recordNavigationScroll(accountId: string, offset: number): void {
    if (!accountId || !Number.isFinite(offset) || offset < 0 || offset > 10_000_000) return
    const current = this.get(accountId)
    if (Math.abs(current.navigation.scrollOffset - offset) < 1) return
    this.snapshots.set(accountId, { ...current, navigation: { ...current.navigation, scrollOffset: offset } })
    this.scheduleScrollSave(accountId)
  }
  private scheduleScrollSave(accountId: string): void {
    clearTimeout(this.scrollSaveTimers.get(accountId))
    this.scrollSaveTimers.set(accountId, setTimeout(() => {
      this.scrollSaveTimers.delete(accountId)
      this.persist(this.get(accountId))
    }, 250))
  }
  flushPendingWrites(): void {
    for (const [accountId, timer] of this.scrollSaveTimers) {
      clearTimeout(timer)
      this.persist(this.get(accountId))
    }
    this.scrollSaveTimers.clear()
  }
  setFilePanelWidth(accountId: string, width: number): void {
    if (!accountId || !Number.isFinite(width) || width <= 0 || width > 100_000) return
    const current = this.get(accountId)
    if (current.panels.fileWidth === width) return
    this.commit({ ...current, panels: { ...current.panels, fileWidth: width } })
  }
  setSplitWidth(accountId: string, kind: 'agentNavigationWidth' | 'roomSplitWidth', width: number | null): void {
    if (!accountId || (width !== null && validSplitWidth(width) === null)) return
    const current = this.get(accountId)
    if (current.panels[kind] === width) return
    this.commit({ ...current, panels: { ...current.panels, [kind]: width } })
  }
  setNavigationWidth(accountId: string, width: number): void {
    if (!accountId || !Number.isFinite(width) || width < DESKTOP_SIDEBAR_MIN_WIDTH || width > DESKTOP_SIDEBAR_MAX_WIDTH) return
    const current = this.get(accountId)
    if (current.panels.navigationWidth === width) return
    this.commit({ ...current, panels: { ...current.panels, navigationWidth: width } })
  }
  getReadingPosition(accountId: string, scope: DesktopShellReadingScope): DesktopShellReadingPosition | null {
    const key = readingKey(scope)
    if (!accountId || !key) return null
    return this.get(accountId).readingPositions[key] ?? null
  }
  setReadingPosition(accountId: string, scope: DesktopShellReadingScope, position: DesktopShellReadingPosition): void {
    const key = readingKey(scope)
    if (!accountId || !key || !readingPositions({ [key]: position })) return
    const current = this.get(accountId)
    const previous = current.readingPositions[key]
    if (
      previous &&
      Math.abs(previous.scrollTop - position.scrollTop) < 1 &&
      Math.abs(previous.distanceFromBottom - position.distanceFromBottom) < 1
    ) return
    const positions = { ...current.readingPositions, [key]: position }
    // Reading offsets are not reactive layout state. Publishing them wakes the
    // sidebar and workspace on every scroll event, even when only chat moved.
    this.snapshots.set(accountId, { ...current, readingPositions: positions })
    this.scheduleScrollSave(accountId)
  }
  private persist(snapshot: DesktopShellWindowSnapshot): void {
    if (Object.keys(snapshot.readingPositions).length > 500) {
      snapshot = { ...snapshot, readingPositions: Object.fromEntries(
        Object.entries(snapshot.readingPositions)
          .sort((left, right) => right[1].savedAt - left[1].savedAt).slice(0, 500),
      ) }
      this.snapshots.set(snapshot.accountId, snapshot)
    }
    try { this.storage()?.setItem(`${STORAGE_KEY}:${encodeURIComponent(snapshot.accountId)}`, JSON.stringify(snapshot)) }
    catch { /* State stays available for this mounted window; no business data is synthesized. */ }
  }
  private commit(snapshot: DesktopShellWindowSnapshot): void {
    clearTimeout(this.scrollSaveTimers.get(snapshot.accountId))
    this.scrollSaveTimers.delete(snapshot.accountId)
    this.snapshots.set(snapshot.accountId, snapshot)
    this.persist(snapshot)
    this.listeners.forEach(listener => listener())
  }
}
export const desktopShellWindowState = new DesktopShellWindowStateStore(() => {
  try { return typeof window === 'undefined' ? null : window.localStorage }
  catch { return null }
})
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', () => desktopShellWindowState.flushPendingWrites())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') desktopShellWindowState.flushPendingWrites()
  })
}
