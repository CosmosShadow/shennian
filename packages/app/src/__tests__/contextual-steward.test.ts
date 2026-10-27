vi.mock('../features/projects/coordination/ProjectCoordinationComposer', () => ({ ProjectCoordinationComposer: () => null }))
import en from '../../../../open-source/packages/shared/src/i18n/en'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
// @vitest-environment happy-dom
// @covers packages/app/src/components/MobileRootScreenFrame.tsx
// @covers packages/app/src/features/steward/contextualSteward.ts
// @covers packages/app/src/features/steward/ContextualStewardDock.tsx
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  account: 'unit-owner', app: 'active', path: '/features', params: {} as Record<string, string>, focused: true,
  deferDock: false, dockJobs: [] as Array<() => void>,
  dock: {} as any, gesture: {} as any, button: {} as any,
  navigate: vi.fn(), push: vi.fn(), dismissEvents: new Set<(s: string) => void>(),
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  InteractionManager: { runAfterInteractions: (job: () => void) => {
    if (state.deferDock) state.dockJobs.push(job); else job()
    return { cancel: vi.fn() }
  } },
  StyleSheet: { create: (styles: unknown) => styles },
  KeyboardAvoidingView: ({ children }: any) => React.createElement('section', null, children),
  Keyboard: { addListener: () => ({ remove() {} }) },
  AppState: { get currentState() { return state.app }, addEventListener: (_: string, fn: (s: string) => void) => { state.dismissEvents.add(fn); return { remove: () => state.dismissEvents.delete(fn) } } },
  PanResponder: { create: (gesture: any) => { state.gesture = gesture; return { panHandlers: {} } } },
  View: ({ children, testID, style }: any) => React.createElement('div', { 'data-testid': testID, 'data-padding-bottom': style?.paddingBottom ?? 0, 'data-min-height': style?.minHeight ?? 0 }, children),
  Text: ({ children }: any) => React.createElement('span', null, children),
  Pressable: (props: any) => { state.button = props; return React.createElement('button', { onClick: props.onPress }, props.children) },
}))
vi.mock('react-native-svg', () => ({
  default: ({ children }: any) => React.createElement('svg', null, children),
  Path: () => React.createElement('path'),
}))
vi.mock('expo-router', () => ({
  usePathname: () => state.path, useGlobalSearchParams: () => state.params,
  useRouter: () => ({ push: state.push, navigate: state.navigate }),
}))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => state.focused }))
vi.mock('react-native-safe-area-context', () => { const context = React.createContext({ top: 59, bottom: 34 }); return { SafeAreaInsetsContext: context, useSafeAreaInsets: () => React.useContext(context) } })
vi.mock('../components/MobileRootTabBar', () => ({ MobileRootTabBar: () => React.createElement('nav', null, 'Tabs') }))
vi.mock('../components/RecoverableScreen', () => ({ renderRecoverableScreen: (props: any) => props.children }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/i18n', () => ({ default: { t: (key: keyof typeof zh) => zh[key] } }))
vi.mock('../config/auth', () => ({ useAuthStore: Object.assign((fn: any) => fn({ user: { id: state.account } }), { getState: () => ({ user: { id: state.account } }) }) }))
vi.mock('../features/steward/StewardScreen', () => ({ StewardScreen: (props: any) => { state.dock = props; return React.createElement('aside', null, props.composerDraft?.text) } }))
vi.mock('../features/steward/stewardSessionsStore', () => ({ useStewardSessionsStore: { getState: () => ({ sessions: [] }) } }))
vi.mock('../features/sessions/sessionAccountClient', () => ({ sessionAccountClient: { getSession: vi.fn(async () => ({ sessionScope: 'steward' })) } }))
import { renderMobileRootScreen } from '../components/MobileRootScreenFrame'
import { stewardPageContext, withStewardContext, stewardPlaceholderKey } from '../features/steward/contextualSteward'
import { ContextualStewardDock } from '../features/steward/ContextualStewardDock'
import { useContextualStewardDraft } from '../features/steward/ContextualStewardContext'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined, host: HTMLDivElement
async function render(element: React.ReactNode) {
  if (!root) { host = document.createElement('div'); document.body.append(host); root = createRoot(host) }
  await act(async () => root!.render(element))
}
beforeEach(() => { state.deferDock = false; state.dockJobs = []; state.account = 'unit-owner'; state.app = 'active'; state.focused = true; state.path = '/features'; state.params = {}; state.push.mockReset(); state.navigate.mockReset() })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host?.remove(); vi.useRealTimers() })
describe('context-aware common input', () => {
  it('keeps a stable input slot before focus, on project-to-calendar switching, and after blur', async () => {
    for (const [name, focused] of [['index', true], ['index', false], ['personal-modules', false], ['personal-modules', true]] as const) {
      state.focused = focused
      await render(renderMobileRootScreen({ route: { name, key: name, params: { tab: 'reminders', __mobileEntry: 'tab' } }, children: React.createElement('main', null, 'page') }))
      expect(host.querySelector('[data-testid="contextual-composer-slot"]')?.getAttribute('data-min-height')).toBe('88')
      expect(!!host.querySelector('aside')).toBe(focused)
    }
    await render(renderMobileRootScreen({ route: { name: 'project', key: 'detail', params: { __mobileEntry: 'push' } }, children: React.createElement('main') }))
    expect(host.querySelector('[data-testid="contextual-composer-slot"]')?.getAttribute('data-min-height')).toBe('88')
  })

  it('keeps the fixed tab directory outside detail composers and page frames', async () => {
    await render(renderMobileRootScreen({ route: { name: '(tabs)', key: 'roots' }, children: React.createElement('main', null, 'directory') }))
    expect(host.querySelector('main')?.textContent).toBe('directory')
    expect(host.querySelector('aside')).toBeNull()
    expect(host.querySelector('[data-testid="mobile-page-viewport"]')).toBeNull()
  })

  it('removes the AI dock and its slot inside user apps, restoring it only on the application list', async () => {
    for (const [name, params] of [
      ['local-app', { machineId: 'unit-machine', appId: 'unit-app' }],
      ['local-app', {}],
      ['content', { machineId: 'unit-machine', appId: 'unit-app' }],
      ['content', {}],
    ] as const) {
      await render(renderMobileRootScreen({ route: { name, key: name, params }, children: React.createElement('main', null, 'application UI') }))
      const isList = name === 'content' && !('appId' in params)
      expect(!!host.querySelector('aside')).toBe(isList)
      expect(!!host.querySelector('[data-testid="contextual-composer-slot"]')).toBe(isList)
      expect(host.querySelector('main')?.textContent).toBe('application UI')
    }
  })

  it('offers translated page-specific hints including calendar changes, schedules and directory details', () => {
    const cases: Array<[string, Record<string, string>, string]> = [
      ['personal-modules', { tab: 'reminders' }, 'calendar'], ['personal-modules', { tab: 'english' }, 'english'],
      ['personal-modules', { tab: 'recording' }, 'recording'], ['personal-workspace', { kind: 'diary' }, 'diary'],
      ['personal-workspace', { kind: 'memory' }, 'memory'], ['scheduled-tasks', {}, 'scheduled_tasks'],
      ['remote-folder', { path: '/unit/folder' }, 'folder'], ['index', {}, 'projects'], ['project', {}, 'project'],
      ['features', {}, 'features'], ['spaces/index', {}, 'rooms'], ['agents/index', {}, 'agents'],
      ['plaza', {}, 'plaza'], ['folders', {}, 'folders'], ['machines', {}, 'computers'],
      ['contacts', {}, 'contacts'], ['content', {}, 'apps'], ['local-app', {}, 'app'],
    ]
    for (const [route, params, suffix] of cases) {
      const key = stewardPlaceholderKey(stewardPageContext(route, params)!)
      expect(key).toBe(`context_input_${suffix}`)
      for (const dict of [en, zh]) expect((dict as Record<string, string>)[key]?.length).toBeGreaterThan(5)
    }
    expect(stewardPlaceholderKey()).toBe('steward_placeholder')
  })

  it('does not reserve an opaque strip above the dock on conversation, feature and project pages', async () => {
    for (const name of ['spaces/index', 'features', 'project']) {
      await render(renderMobileRootScreen({ route: { name, key: name, params: { __mobileEntry: name === 'project' ? 'push' : 'tab' } }, children: React.createElement('main', null, 'scrolling page') }))
      const viewport = host.querySelector('[data-testid="mobile-page-viewport"]')!
      expect(viewport.getAttribute('data-padding-bottom')).toBe('0')
      expect(viewport.textContent).toBe('scrolling page')
      expect(host.querySelector('aside')).not.toBeNull()
      expect(host.querySelector('nav')).toBeNull()
    }
  })

  it('covers the useful module and directory surfaces, excludes security/forms and existing conversations', () => {
    for (const route of ['index', 'features', 'spaces/index', 'agents/index', 'plaza', 'project', 'remote-folder', 'personal-modules', 'personal-workspace', 'folders', 'machines']) expect(stewardPageContext(route)).not.toBeNull()
    for (const route of ['profile', 'billing', 'agents/new', 'chat/[sessionId]/index', 'room-workspace', 'scan', 'account-settings']) expect(stewardPageContext(route)).toBeNull()
  })
  it('takes only bounded navigation context, persists the snapshot with a turn, and leaves ordinary chats unchanged', () => {
    const context = stewardPageContext('remote-folder', { machineId: 'unit-machine', path: '/unit/design', token: 'never-send', body: 'private-file-content', query: 'ignored', workDir: 'x'.repeat(3000) })!
    expect(context.details).toEqual({ machineId: 'unit-machine', path: '/unit/design', workDir: 'x'.repeat(2048) })
    const turn = withStewardContext('Summarize this folder', context)
    context.details.path = '/different'
    expect(turn).toContain('/unit/design'); expect(turn).not.toContain('/different'); expect(turn).not.toContain('never-send')
    expect(withStewardContext('hello')).toBe('hello'); expect(withStewardContext('', context)).toBe('')
  })
  it('reserves the dock but defers its controller until the card transition ends, cancelling stale focus work', async () => {
    state.deferDock = true
    const page = () => React.createElement(ContextualStewardDock, { context: stewardPageContext('project')! })
    await render(page())
    expect(host.querySelector('[data-testid="contextual-composer-slot"]')).not.toBeNull()
    expect(host.querySelector('aside')).toBeNull()
    state.focused = false
    await render(page())
    await act(async () => state.dockJobs[0]())
    state.focused = true
    await render(page())
    expect(host.querySelector('aside')).toBeNull()
    await act(async () => state.dockJobs[1]())
    expect(host.querySelector('aside')).not.toBeNull()
  })
  it('inserts a creation request without navigating or executing, and mounts a real send dock only on the focused page', async () => {
    let draft!: (text: string) => void
    function Page() { const composer = useContextualStewardDraft(state.account); draft = composer.draft; return React.createElement(ContextualStewardDock, { context: stewardPageContext('agents/index')!, request: composer.request }) }
    await render(React.createElement(Page))
    await act(async () => draft('Create an agent, ask which computer first'))
    expect(host.textContent).toContain('ask which computer first')
    expect(state.dock.dockOnly).toBe(true); expect(state.dock.pageContext.page).toBe('agents')
    expect(state.navigate).not.toHaveBeenCalled(); expect(state.push).not.toHaveBeenCalled()
    state.account = 'other-owner'; await render(React.createElement(Page)); expect(host.textContent).toBe('')
    state.focused = false; await render(React.createElement(Page)); expect(host.textContent).toBe('')
  })
})
describe('recorder page composer placement', () => {
  it('hides the global input on capture, all-days and settings, but restores it for a selected day', async () => {
    for (const recordingView of ['home', 'days', 'settings', 'day']) {
      await render(renderMobileRootScreen({ route: { name: 'personal-modules', key: recordingView, params: { tab: 'recording', recordingView, recordingDay: '2026-10-23' } }, children: React.createElement('main', null, 'records') }))
      expect(!!host.querySelector('aside')).toBe(recordingView === 'day')
    }
  })
})
