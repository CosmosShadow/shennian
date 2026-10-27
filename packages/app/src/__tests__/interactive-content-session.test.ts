// @covers packages/app/src/features/interactive-content/contentSession.ts
import { describe, expect, it, vi } from 'vitest'
import { contentSwipeDirection, emptyContentSession, reduceContentSession, selectedDocument,
  type ContentDocument } from '../features/interactive-content/contentSession'

const doc = (workId: string, versionId = 'v1'): ContentDocument => ({ workId, headRevision: Number(versionId.slice(1)), versionId,
  title: 'unit fixture', summary: '', html: '<p>unit</p>', resourceOrigins: [], creatorId: 'alice', published: true })

describe('content host session state', () => {
  it('starts with no fabricated works and adds only a completed accepted job', () => {
    const empty = emptyContentSession()
    expect(selectedDocument(empty)).toBeNull()
    expect(reduceContentSession(empty, { type: 'completed', jobId: 'unknown', document: doc('w') })).toBe(empty)
    const accepted = reduceContentSession(empty, { type: 'accepted', job: { id: 'j', workId: null, kind: 'create' } })
    expect(accepted.documents).toHaveLength(0)
    const done = reduceContentSession(accepted, { type: 'completed', jobId: 'j', document: doc('w') })
    expect(selectedDocument(done)).toBeNull()
    expect(done.completedWorkId).toBe('w')
    expect(done.viewEpoch).toBe(0)
    const opened = reduceContentSession(done, { type: 'open', position: { workId: 'w', versionId: 'v1', followCurrent: true } })
    expect(selectedDocument(opened)?.workId).toBe('w')
    expect(done.jobs).toHaveLength(0)
  })
  it('keeps view epochs monotonic across account/deep-link resets so Redis context cannot reject a reopened page', () => {
    let state = { ...emptyContentSession(), viewEpoch: 25, documents: [doc('w')] }
    state = reduceContentSession(state, { type: 'reset' })
    expect(state.viewEpoch).toBe(26); expect(state.documents).toEqual([])
    state = reduceContentSession(state, { type: 'reset' })
    expect(state.viewEpoch).toBe(27)
  })
  it('does not steal focus when a background creation completes', () => {
    let state = reduceContentSession(emptyContentSession(), { type: 'open', position: { workId: 'b', versionId: 'v3', followCurrent: true } })
    state = reduceContentSession(state, { type: 'accepted', job: { id: 'j', workId: null, kind: 'create' } })
    state = reduceContentSession(state, { type: 'completed', jobId: 'j', document: doc('a') })
    expect(state.position?.workId).toBe('b')
    expect(state.completedWorkId).toBe('a')
  })
  it('keeps historical readers pinned, while current readers follow head events', () => {
    const initial = { ...emptyContentSession(), documents: [doc('w')], position: { workId: 'w', versionId: 'v1', followCurrent: false } }
    const pinned = reduceContentSession(initial, { type: 'headChanged', document: doc('w', 'v2') })
    expect(selectedDocument(pinned)?.versionId).toBe('v1')
    const following = reduceContentSession({ ...initial, position: { ...initial.position, followCurrent: true } }, { type: 'headChanged', document: doc('w', 'v2') })
    expect(selectedDocument(following)?.versionId).toBe('v2')
    expect(following.viewEpoch).toBe(1)
  })
  it('does not follow a delayed older head event', () => {
    const initial = { ...emptyContentSession(), documents: [doc('w', 'v3')], position: { workId: 'w', versionId: 'v3', followCurrent: true } }
    expect(reduceContentSession(initial, { type: 'headChanged', document: doc('w', 'v2') })).toBe(initial)
    const restore = { ...doc('w', 'v1'), headRevision: 4 }
    expect(selectedDocument(reduceContentSession(initial, { type: 'headChanged', document: restore }))?.versionId).toBe('v1')
  })
  it('does not leave failed cards or erase an existing document', () => {
    const initial = { ...emptyContentSession(), documents: [doc('w')], jobs: [{ id: 'j', workId: 'w', kind: 'modify' as const }] }
    const next = reduceContentSession(initial, { type: 'settledWithoutResult', jobId: 'j' })
    expect(next.documents).toEqual(initial.documents)
    expect(next.jobs).toHaveLength(0)
  })
  it('pages only on a deliberate vertical handle stroke, never horizontal, short, typing or recording', () => {
    for (const override of [{ editing: true }, { recording: true }, { dy: 20 }, { dx: 90 }]) {
      expect(contentSwipeDirection({ dx: 2, dy: -90, editing: false, recording: false, ...override })).toBe(0)
    }
    expect(contentSwipeDirection({ dx: 2, dy: -90, editing: false, recording: false })).toBe(1)
    expect(contentSwipeDirection({ dx: 2, dy: 90, editing: false, recording: false })).toBe(-1)
  })
})

// @covers packages/app/src/features/interactive-content/InteractiveContentShell.tsx
// Exercise the production shell element callbacks; do not inspect JSX source strings.
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useMemo: (run: () => unknown) => run(), useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()], useEffect: vi.fn(), useImperativeHandle: vi.fn(),
}))
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Keyboard: { dismiss: vi.fn() }, KeyboardAvoidingView: 'KeyboardAvoidingView',
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) }, Platform: { OS: 'ios' }, Pressable: 'Pressable',
  ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5, absoluteFillObject: {} },
}))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) }))
const entryNavigate = vi.hoisted(() => vi.fn())
vi.mock('expo-router', () => ({ useRouter: () => ({ navigate: entryNavigate }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Path: 'Path' }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { bg: '#fff', text: '#111', textMuted: '#666', border: '#ddd', brand: '#07f' }, isDark: false }) }))
vi.mock('react-native-webview', () => ({ WebView: 'NativeWebView' }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unit-request' }))
vi.mock('../features/interactive-content/ContentCanvas', () => ({ ContentCanvas: 'ContentCanvas' }))
vi.mock('../features/interactive-content/ContentCard', () => ({ ContentCard: 'ContentCard' }))
vi.mock('../features/interactive-content/GlassSurface', () => ({ GlassSurface: 'GlassSurface' }))
import { isValidElement, type ReactNode, type ReactElement } from 'react'
import { ContentPager, contentSurfaceKey, createContentSwipeController } from '../features/interactive-content/ContentPager'
import { ActionIconButton } from '../components/ActionIconButton'
import { HeaderIconButton } from '../components/AppPageHeader'
import { InteractiveContentShell, type ContentShellProps } from '../features/interactive-content/InteractiveContentShell'
function nodes(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  if (node.type === ActionIconButton) return nodes(ActionIconButton(node.props as Parameters<typeof ActionIconButton>[0]))
  if (node.type === HeaderIconButton) return nodes(HeaderIconButton(node.props as Parameters<typeof HeaderIconButton>[0]))
  return [node, ...nodes(node.props.children as ReactNode)]
}
function shell(overrides: Partial<ContentShellProps> = {}) {
  const props: ContentShellProps = { session: emptyContentSession(), input: '', available: true,
    onInput: vi.fn(), onBack: vi.fn(), onSubmit: vi.fn(), onPickMaterial: vi.fn(), onRecord: vi.fn(),
    onStopRecording: vi.fn(), onPage: vi.fn(), onShare: vi.fn(), onPublish: vi.fn(), onOpenCompleted: vi.fn(), ...overrides }
  return { props, elements: nodes(InteractiveContentShell(props)) }
}
describe('content host visual interaction contracts', () => {
  const own = { ...doc('w'), published: false }
  const session = { ...emptyContentSession(), documents: [own], position: { workId: 'w', versionId: 'v1', followCurrent: true } }
  it('keeps a disabled glass publish action visible while editing and prevents duplicate publishing', () => {
    for (const state of [{ canPublish: false }, { canPublish: true, publishing: true }]) {
      const { elements } = shell({ session, showPublish: true, ...state })
      const action = elements.find((element) => element.props.testID === 'interactive-content-publish')!
      expect(action.props.disabled).toBe(true)
      expect(elements.some((element) => element.type === 'GlassSurface' && nodes(element).includes(action))).toBe(true)
    }
    const { elements, props } = shell({ session, showPublish: true, canPublish: true })
    const action = elements.find((element) => element.props.testID === 'interactive-content-publish')!
    expect(action.props.disabled).toBeFalsy()
    ;(action.props.onPress as () => void)()
    expect(props.onPublish).toHaveBeenCalledOnce()
  })
  it('shows loading rather than a false empty creation screen during initial real feed recovery', () => {
    for (const loading of [true, false]) {
      const { elements } = shell({ loading })
      expect(elements.some((element) => element.type === 'ActivityIndicator')).toBe(loading)
      expect(elements.some((element) => ['content_empty_title', 'content_empty_body'].includes(String(element.props.children)))).toBe(false)
    }
  })
  it('uses contextual input hints without adding a separate creation screen', () => {
    const hint = (props: Partial<ContentShellProps>) => shell(props).elements.find((element) => element.props.testID === 'interactive-content-input')!.props.placeholder
    expect(hint({})).toBe('content_input_empty')
    expect(hint({ session })).toBe('content_input_edit')
    expect(hint({ session, updating: true })).toBe('content_input_modifying')
    expect(hint({ session: { ...session, documents: [{ ...own, published: true }] } })).toBe('content_input_current')
  })
  it('opens a completed work only when the single completion notice is pressed', () => {
    const { elements, props } = shell({ session: { ...emptyContentSession(), completedWorkId: 'new' } })
    expect(props.onOpenCompleted).not.toHaveBeenCalled()
    ;(elements.find((element) => element.props.testID === 'interactive-content-completed')!.props.onPress as () => void)()
    expect(props.onOpenCompleted).toHaveBeenCalledWith('new')
  })
  it('captures vertical drags only on the separate handle, not on the input bar', () => {
    const { elements, props } = shell({ session })
    expect(elements.find((element) => element.props.testID === 'interactive-content-input')!.props.pointerEvents).toBe('none')
    expect(elements.find((element) => element.props.testID === 'interactive-content-activate-input')!.props.accessible).toBe(false)
    expect(elements.find((element) => element.props.testID === 'interactive-content-input-bar')!.props.onMoveShouldSetPanResponderCapture).toBeUndefined()
    const bar = elements.find((element) => element.props.testID === 'interactive-content-paging-zone')!
    const start = bar.props.onStartShouldSetPanResponderCapture as () => boolean
    const move = bar.props.onMoveShouldSetPanResponderCapture as (event: unknown, gesture: object) => boolean
    const release = bar.props.onPanResponderRelease as (event: unknown, gesture: object) => void
    expect(start()).toBe(false)
    expect(move(null, { dx: 2, dy: 90 })).toBe(true)
    const pager = elements.find((element) => element.type === ContentPager)!
    const handle = { begin: vi.fn(), move: vi.fn(), finish: vi.fn() }
    ;(pager.props.ref as { current: unknown }).current = handle
    ;(bar.props.onPanResponderGrant as () => void)()
    ;(bar.props.onPanResponderMove as (event: unknown, gesture: object) => void)(null, { dx: 2, dy: 90 })
    release(null, { dx: 2, dy: 90 })
    expect(handle.begin).toHaveBeenCalledOnce()
    expect(handle.move).toHaveBeenCalledWith(90)
    expect(handle.finish).toHaveBeenCalledWith(-1)
    expect(props.onPage).not.toHaveBeenCalled()
    expect(move(null, { dx: 90, dy: 2 })).toBe(false)
    expect(move(null, { dx: 90, dy: 80 })).toBe(false)
    const locked = shell({ recording: true })
    const lockedBar = locked.elements.find((element) => element.props.testID === 'interactive-content-paging-zone')!
    ;(lockedBar.props.onStartShouldSetPanResponderCapture as () => boolean)()
    expect((lockedBar.props.onMoveShouldSetPanResponderCapture as (event: unknown, gesture: object) => boolean)(null, { dx: 2, dy: 90 })).toBe(false)
  })
  it('renders one-line recording with real level feedback and an icon stop action', () => {
    const quiet = shell({ recording: true, transcript: 'hello', recordingLevel: 0 })
    const loud = shell({ recording: true, transcript: 'hello', recordingLevel: 1 })
    const heights = (elements: typeof quiet.elements) => nodes(elements.find((element) => element.props.testID === 'interactive-content-level')!)
      .filter((element) => element.props.testID !== 'interactive-content-level' && (element.props.style as { height?: number })?.height !== undefined)
      .map((element) => (element.props.style as { height: number }).height)
    expect(Math.max(...heights(loud.elements))).toBeGreaterThan(Math.max(...heights(quiet.elements)))
    expect(loud.elements.find((element) => element.type === 'Text' && element.props.children === 'hello')?.props.numberOfLines).toBe(1)
    const stop = loud.elements.find((element) => element.props.accessibilityLabel === 'content_stop_record')!
    ;(stop.props.onPress as () => void)()
    expect(loud.props.onStopRecording).toHaveBeenCalledOnce()
    expect(nodes(stop).some((element) => element.props.name === 'stop')).toBe(true)
  })
})

// @covers packages/app/src/features/interactive-content/isolatedDocument.ts
import { buildIsolatedDocument } from '../features/interactive-content/isolatedDocument'

describe('untrusted HTML isolation wrapper', () => {
  it('keeps generated HTML inside an opaque-origin sandbox with no host bridge', () => {
    const html = buildIsolatedDocument('<script>parent.document.body.innerHTML="attack"</script>', ['https://assets.example.test/path?x=1'])
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).toContain('--shennian-safe-top:110px!important;--shennian-safe-bottom:135px!important')
    expect(html).not.toContain('allow-same-origin')
    expect(html).not.toContain('allow-top-navigation')
    expect(html).toContain("connect-src https://assets.example.test/api/interactive-content/assets/")
    expect(html).toContain('https://assets.example.test')
    expect(html).not.toContain('/path?x=1')
    expect(html).toContain('&lt;script&gt;')
  })
  it('cannot escape the srcdoc attribute or supply credential/file/JS resource URLs', () => {
    const html = buildIsolatedDocument('"><script>attack()</script><!--', [])
    expect(html).not.toContain('<script>attack()')
    for (const url of ['http://assets.test', 'file:///tmp/x', 'javascript:alert(1)', 'https://u:p@assets.test']) {
      expect(() => buildIsolatedDocument('', [url])).toThrow('invalid_resource_origin')
    }
  })
})

// @covers packages/app/src/features/interactive-content/contentClient.ts
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
import { createContentDocumentLoader, contentClient } from '../features/interactive-content/contentClient'
describe('bounded document lookahead', () => {
  function fixture() {
    const document = vi.fn().mockResolvedValue({ ...doc('w'), currentVersionId: 'v1', shareUrl: '' })
    const head = vi.fn().mockResolvedValue({ currentVersionId: 'v1', headRevision: 1, updating: false })
    return { document, head, loader: createContentDocumentLoader({ ...contentClient, document, head }) }
  }
  it('reuses lookahead HTML only after checking the current shared head', async () => {
    const { loader, document, head } = fixture()
    loader.prefetch(['w']); await Promise.resolve()
    expect((await loader.load('w')).versionId).toBe('v1')
    expect(document).toHaveBeenCalledOnce(); expect(head).toHaveBeenCalledWith('w')
    head.mockResolvedValue({ currentVersionId: 'v2', headRevision: 2, updating: false })
    document.mockResolvedValue({ ...doc('w', 'v2'), currentVersionId: 'v2', shareUrl: '' })
    expect((await loader.load('w')).versionId).toBe('v2')
    expect(document).toHaveBeenCalledTimes(2)
  })
  it('does not retain an unpublished visibility flag when publication leaves the version/head unchanged', async () => {
    const { loader, document } = fixture()
    document.mockResolvedValueOnce({ ...doc('w'), published: false, currentVersionId: 'v1', shareUrl: '' })
    await loader.load('w')
    expect((await loader.load('w')).published).toBe(true)
    expect(document).toHaveBeenCalledTimes(2)
  })
  it('bounds lookahead, clears on identity change, and never serves a deleted cached work', async () => {
    const { loader, document, head } = fixture()
    loader.prefetch(['w', 'x', 'y', 'z']); await Promise.resolve()
    expect(document).toHaveBeenCalledTimes(2)
    loader.clear(); await loader.load('w')
    expect(document).toHaveBeenCalledTimes(3)
    head.mockRejectedValue(new Error('work_unavailable'))
    await expect(loader.load('w')).rejects.toThrow('work_unavailable')
  })
  it('reuses a short-lived public disk entry only after online head validation, never offline or after deletion', async () => {
    const { document, head } = fixture()
    const saved = { ...doc('w'), currentVersionId: 'v1', shareUrl: '' }
    const storage = { read: vi.fn().mockResolvedValue(JSON.stringify({ at: Date.now(), documents: [saved] })), write: vi.fn().mockResolvedValue(undefined) }
    const loader = createContentDocumentLoader({ ...contentClient, document, head }, storage)
    expect((await loader.load('w')).versionId).toBe('v1')
    expect(document).not.toHaveBeenCalled()
    expect(head).toHaveBeenCalledOnce()
    head.mockRejectedValue(new Error('work_unavailable'))
    await expect(loader.load('w')).rejects.toThrow('work_unavailable')
    expect(document).not.toHaveBeenCalled()
    const staleStorage = { ...storage, read: vi.fn().mockResolvedValue(JSON.stringify({ at: Date.now() - 301000, documents: [saved] })) }
    await createContentDocumentLoader({ ...contentClient, document, head }, staleStorage).load('w')
    expect(document).toHaveBeenCalledOnce()
    expect(staleStorage.write).toHaveBeenCalledOnce()
  })
  it('does not repopulate a new identity cache with an old inflight response', async () => {
    const { loader, document } = fixture()
    let resolve!: (value: unknown) => void
    document.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    loader.prefetch(['w']); loader.clear()
    resolve({ ...doc('w'), currentVersionId: 'v1', shareUrl: '' }); await Promise.resolve()
    await loader.load('w'); expect(document).toHaveBeenCalledTimes(2)
  })
})

// @covers packages/app/src/features/interactive-content/ContentPager.tsx
describe('prepared page motion', () => {
  it('retains a stable surface on ordinary visits but replaces it after a same-version creator restore', () => {
    const document = doc('w')
    expect(contentSurfaceKey({ ...document })).toBe(contentSurfaceKey(document))
    expect(contentSurfaceKey({ ...document, headRevision: document.headRevision + 1 })).not.toBe(contentSurfaceKey(document))
    const { elements } = shell({ session: { ...emptyContentSession(), documents: [document], position: { workId: 'w', versionId: 'v1', followCurrent: true } }, canvasResetKey: 9 })
    expect(elements.find((element) => element.type === ContentPager)!.key).toBe('9')
  })
  function fixture(ready = true) {
    const frames: Array<{ to: number; finish(value: boolean): void }> = []
    const io = { extent: () => 400, ready: vi.fn((direction: -1 | 1) => ready ? direction === 1 ? 'next' : 'previous' : null),
      set: vi.fn(), stop: vi.fn(), animate: (to: number, finish: (value: boolean) => void) => { frames.push({ to, finish }) }, navigate: vi.fn().mockResolvedValue(true) }
    return { io, frames, motion: createContentSwipeController(io) }
  }
  it('moves with the finger and only navigates after a prepared neighbor has slid into place', async () => {
    const { io, frames, motion } = fixture()
    motion.begin(); motion.move(-170)
    expect(io.set).toHaveBeenLastCalledWith(-170)
    motion.finish(1)
    expect(frames[0]!.to).toBe(-400)
    expect(io.navigate).not.toHaveBeenCalled()
    motion.begin(); motion.finish(1)
    expect(frames).toHaveLength(1)
    frames[0]!.finish(true); await Promise.resolve()
    expect(io.navigate).toHaveBeenCalledExactlyOnceWith(1, 'next')
    motion.reset(); motion.begin(); motion.move(140); motion.finish(-1)
    expect(frames[1]!.to).toBe(400)
    frames[1]!.finish(true); await Promise.resolve()
    expect(io.navigate).toHaveBeenLastCalledWith(-1, 'previous')
  })
  it('resists an unpainted/missing neighbor and springs back without flashing or navigating', () => {
    const { io, frames, motion } = fixture(false)
    motion.begin(); motion.move(-100); motion.finish(1)
    expect(io.set).toHaveBeenLastCalledWith(-12)
    expect(frames[0]!.to).toBe(0)
    frames[0]!.finish(true)
    expect(io.navigate).not.toHaveBeenCalled()
  })
  it('ignores stale completion after a view/scope reset and bounces back after failed navigation', async () => {
    const first = fixture()
    first.motion.begin(); first.motion.finish(1); first.motion.reset(); first.frames[0]!.finish(true)
    expect(first.io.navigate).not.toHaveBeenCalled()
    first.motion.begin(); first.motion.finish(1); first.motion.dispose(); first.frames[1]!.finish(true)
    expect(first.io.navigate).not.toHaveBeenCalled()
    const failed = fixture()
    failed.io.navigate.mockRejectedValue(new Error('offline'))
    failed.motion.begin(); failed.motion.finish(1); failed.frames[0]!.finish(true)
    await Promise.resolve(); await Promise.resolve()
    expect(failed.frames[1]!.to).toBe(0)
    failed.frames[1]!.finish(true)
    expect(failed.io.set).toHaveBeenLastCalledWith(0)
  })
})

// @covers packages/app/src/features/interactive-content/ContentCanvas.native.tsx
import { ContentCanvas as NativeCanvas } from '../features/interactive-content/ContentCanvas.native'
it('does not grant native intent or save capability to prepared inactive WebViews', () => {
  const onIntent = vi.fn(), onSave = vi.fn()
  const render = (NativeCanvas as unknown as { render(props: { document: ContentDocument; active: boolean; onIntent: typeof onIntent; onSave: typeof onSave }, ref: null): ReactNode }).render
  const message = (active: boolean, data: object) => {
    const view = render({ document: doc('w'), active, onIntent, onSave }, null) as ReactElement<{ onMessage(event: { nativeEvent: { data: string } }): void }>
    view.props.onMessage({ nativeEvent: { data: JSON.stringify(data) } })
  }
  const save = { type: 'save', html: '<!doctype html><html><body><main>unit save</main></body></html>' }
  message(false, { type: 'intent', text: 'do not send from a neighbor' }); message(false, save)
  expect(onIntent).not.toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled()
  message(true, { type: 'intent', text: 'explicit current action' }); message(true, save)
  expect(onIntent).toHaveBeenCalledExactlyOnceWith('explicit current action')
  expect(onSave).toHaveBeenCalledExactlyOnceWith(save.html, undefined)
})

// @covers packages/app/src/features/interactive-content/GlassSurface.tsx
it('renders a readable fallback on an existing OTA shell without the glass native module', async () => {
  vi.doMock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }))
  const { GlassSurface } = await vi.importActual<typeof import('../features/interactive-content/GlassSurface')>('../features/interactive-content/GlassSurface')
  const rendered = GlassSurface({ children: 'OTA content' })
  expect(rendered.type).toBe('View')
  expect(rendered.props.children).toBe('OTA content')
  expect(rendered.props.style[0].backgroundColor).toBe('rgba(255,255,255,0.94)')
  vi.doUnmock('expo-modules-core')
})

// @covers packages/app/src/features/interactive-content/ContentPager.tsx
import { contentPageSlots } from '../features/interactive-content/ContentPager'
it('keeps the painted target and leaving WebViews at identical world positions when focus changes', () => {
  const before = contentPageSlots(new Map(), 'a', [{ id: 'a', offset: 0 }, { id: 'b', offset: 1 }])
  const after = contentPageSlots(before, 'b', [{ id: 'a', offset: -1 }, { id: 'b', offset: 0 }, { id: 'c', offset: 1 }])
  expect(after.get('a')).toBe(before.get('a'))
  expect(after.get('b')).toBe(before.get('b'))
  const width = 402
  const animationEnd = -width * (before.get('a')! + 1)
  expect(-width * after.get('b')!).toBe(animationEnd)
  const back = contentPageSlots(after, 'a', [{ id: 'a', offset: 0 }, { id: 'b', offset: 1 }])
  expect(back.get('a')).toBe(before.get('a'))
  expect(back.get('b')).toBe(before.get('b'))
})

// @covers packages/app/src/features/interactive-content/holdToTalk.ts
import { createHoldToTalk } from '../features/interactive-content/holdToTalk'
describe('input hold to talk', () => {
  function fixture(available = true) {
    let finish!: (started: boolean) => void
    const io = { available: () => available, start: vi.fn((_guard: () => boolean) => new Promise<boolean>((resolve) => { finish = resolve })),
      stop: vi.fn(), cancel: vi.fn(), focus: vi.fn() }
    return { io, hold: createHoldToTalk(io), finish: (started: boolean) => finish(started) }
  }
  it('short tap focuses typing without starting audio; a completed hold stops on release without focusing', async () => {
    const { io, hold, finish } = fixture()
    hold.arm(); hold.release(); hold.tap()
    expect(io.focus).toHaveBeenCalledOnce(); expect(io.start).not.toHaveBeenCalled()
    hold.arm(); hold.start(); hold.start()
    expect(io.start).toHaveBeenCalledOnce()
    expect(io.start.mock.calls[0][0]()).toBe(true)
    finish(true); await Promise.resolve()
    hold.release(); hold.release(); hold.tap()
    expect(io.stop).toHaveBeenCalledOnce(); expect(io.focus).toHaveBeenCalledOnce()
  })
  it('invalidates pending permission/start when released or unmounted, never submits late audio', async () => {
    for (const action of ['release', 'dispose'] as const) {
      const { io, hold, finish } = fixture()
      hold.arm(); hold.start(); hold[action]()
      expect(io.start.mock.calls[0][0]()).toBe(false)
      finish(true); await Promise.resolve()
      expect(io.cancel).toHaveBeenCalled(); expect(io.stop).not.toHaveBeenCalled()
    }
  })
  it('does not record while unavailable or after disposal', () => {
    const { io, hold } = fixture(false)
    hold.start(); hold.dispose(); hold.start()
    expect(io.start).not.toHaveBeenCalled()
  })
})

it('wires input long press and release without changing the separate microphone tap contract', async () => {
  const { elements, props } = shell({ onRecord: vi.fn().mockResolvedValue(true), onCancelRecording: vi.fn() })
  const input = elements.find((element) => element.props.testID === 'interactive-content-activate-input')!
  expect(input.props.delayLongPress).toBe(350)
  ;(input.props.onPressIn as (event: object) => void)({ nativeEvent: { pageY: 812 } })
  ;(input.props.onLongPress as () => void)()
  await Promise.resolve(); await Promise.resolve()
  ;(input.props.onPressOut as () => void)()
  expect(props.onRecord).toHaveBeenCalledOnce()
  expect(props.onStopRecording).toHaveBeenCalledOnce()
  expect(props.onSubmit).not.toHaveBeenCalled()
  const mic = elements.find((element) => element.props.accessibilityLabel === 'content_record')!
  ;(mic.props.onPress as (event: object) => void)({ nativeEvent: {} })
  expect(props.onRecord).toHaveBeenLastCalledWith()
})

it('cancels a ready hold dragged upward instead of submitting it, and reports preparation/listening feedback', async () => {
  const feedback = vi.fn(), stop = vi.fn(), cancel = vi.fn()
  const hold = createHoldToTalk({ available: () => true, start: async () => true, focus: vi.fn(), feedback, stop, cancel })
  hold.arm(); hold.start()
  expect(feedback).toHaveBeenCalledWith('preparing', false)
  await Promise.resolve()
  expect(feedback).toHaveBeenCalledWith('listening', false)
  hold.move(-70); hold.release()
  expect(feedback).toHaveBeenCalledWith('listening', true)
  expect(cancel).toHaveBeenCalledOnce(); expect(stop).not.toHaveBeenCalled()
})
it('uses reduced content insets inside the bounded host module without losing the sandbox', () => {
  const html = buildIsolatedDocument('<p>bounded</p>', [], true, { top: 68, bottom: 12 })
  expect(html).toContain('--shennian-safe-top:68px!important;--shennian-safe-bottom:12px!important')
  expect(html).toContain('sandbox="allow-scripts"')
})

it('lays out the bounded module in flex flow so keyboard padding and the complete tool area shrink its viewport', () => {
  const { elements } = shell()
  const module = elements.find((element) => element.props.testID === 'interactive-content-module')!
  const styles = module.props.style as Array<Record<string, unknown>>
  expect(styles[0].flex).toBe(1)
  expect(styles[0].position).toBeUndefined()
  expect(styles[1].marginTop).toBe(66)
  const keyboard = elements.find((element) => element.type === 'KeyboardAvoidingView')!
  expect(keyboard.props.behavior).toBe('padding')
})

// @covers packages/app/src/features/local-apps/client.ts
// @covers packages/app/src/features/local-apps/bridge.ts
// @covers open-source/packages/wire/src/local-apps.ts
import { runInNewContext } from 'node:vm'
import { localAppSdk } from '@shennian/wire'
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
import { pageServiceMessage, runtimeUrl } from '../features/local-apps/client'
import { createPageServiceBridge } from '../features/local-apps/bridge'
const app = { id: 'app', title: 'My app', port: 5173, entryPath: '/', directory: '/unit', updatedAt: '' }
const msg = (id = '1', extra = {}) => JSON.stringify({ kind: 'local-service', id, machineId: 'mine', port: app.port, method: 'GET', path: '/api', ...extra })
describe('local page capabilities', () => {
  it('binds page calls to the current app/machine/port and disallows arbitrary RPCs', () => {
    expect(pageServiceMessage(msg(), 'mine', app).input).toMatchObject({ appId: 'app', method: 'GET' })
    for (const extra of [{ machineId: 'other' }, { port: 6000 }, { method: 'PUT' }, { path: '//other' }, { kind: 'personal.apps.register' }]) expect(() => pageServiceMessage(msg('1', extra), 'mine', app)).toThrow()
    expect(runtimeUrl('https://shennian.net/api', '/local-apps/runtime/' + 'a'.repeat(48) + '/index.html')).toBe('https://shennian.net/api/local-apps/runtime/' + 'a'.repeat(48) + '/index.html')
    expect(() => runtimeUrl('https://shennian.net/api', 'https://other')).toThrow('invalid_runtime')
  })
  it('does not deliver stale results after a page reload or account switch', async () => {
    let finish!: (v: unknown) => void, alive = true
    const deliver = vi.fn(), call = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const bridge = createPageServiceBridge(app, 'mine', { alive: () => alive, deliver, call })
    const pending = bridge.receive(msg()); bridge.invalidate(); finish({ count: 1 }); await pending
    expect(deliver).not.toHaveBeenCalled()
    const next = bridge.receive(msg()); alive = false; finish({ count: 2 }); await next
    expect(deliver).not.toHaveBeenCalled()
    await bridge.receive(msg('2')); expect(call).toHaveBeenCalledTimes(2)
  })
  it('does not retry failed writes, deduplicates in-flight ids and rejects after disposal', async () => {
    const call = vi.fn().mockRejectedValue(new Error('private backend details')), deliver = vi.fn()
    const bridge = createPageServiceBridge(app, 'mine', { alive: () => true, deliver, call })
    await Promise.all([bridge.receive(msg('1', { method: 'POST' })), bridge.receive(msg('1', { method: 'POST' }))])
    expect(call).toHaveBeenCalledTimes(1); expect(deliver).toHaveBeenCalledWith('1', { error: 'local_service_unavailable' })
    bridge.dispose(); await bridge.receive(msg('2')); expect(call).toHaveBeenCalledTimes(1)
  })
  it('runs the public SDK with JSON/text responses and no account credential', async () => {
    const postMessage = vi.fn(), window: Record<string, any> = { ReactNativeWebView: { postMessage } }
    runInNewContext(localAppSdk('mine', 5173), { window, Map, Promise, setTimeout, clearTimeout, Uint8Array, TextDecoder, atob })
    const result = window.shennian.personal.service('mine', 5173, 'POST', '/api', { value: 1 })
    const request = JSON.parse(postMessage.mock.calls[0]![0]); expect(request).toMatchObject({ machineId: 'mine', method: 'POST' })
    window.__shennianLocalResult(request.id, { value: { status: 200, headers: { 'content-type': 'application/json' }, base64: Buffer.from('{"count":1}').toString('base64') } })
    expect(await result).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body: { count: 1 } })
    await expect(window.shennian.personal.service('other', 5173, 'GET', '/')).rejects.toThrow('service_target_forbidden')
  })
})

  it('responds to an invalid page method immediately instead of waiting for timeout', async () => {
    const deliver = vi.fn(), call = vi.fn()
    const bridge = createPageServiceBridge(app, 'mine', { alive: () => true, deliver, call })
    await bridge.receive(msg('10', { method: 'PUT' }))
    expect(call).not.toHaveBeenCalled()
    expect(deliver).toHaveBeenCalledWith('10', { error: 'local_service_unavailable' })
  })

// @covers packages/app/src/features/local-apps/LocalAppTile.tsx
import { LocalAppTile } from '../features/local-apps/LocalAppTile'
it('shows an AI-registered application as a one-tap launch target, without configuration inputs', () => {
  const open = vi.fn(), remove = vi.fn()
  const tree = LocalAppTile({ title: '晚餐转盘', machineName: '我的电脑', testID: 'local-app-unit', removeLabel: '移除', moreLabel: '管理', menuOpen: false, colors: { surface: '#fff', brand: '#07f', text: '#111', textMuted: '#666' }, onOpen: open, onMore: vi.fn(), onRemove: remove })
  const rendered = nodes(tree)
  expect(rendered.filter(n => n.type === 'TextInput')).toHaveLength(0)
  expect(rendered.filter(n => n.type === 'Text').map(n => n.props.children)).toEqual(['晚餐转盘', '我的电脑'])
  const launch = rendered.find(n => n.props.testID === 'local-app-unit')!
  ;(launch.props.onPress as () => void)()
  expect(open).toHaveBeenCalledTimes(1)
  expect(remove).not.toHaveBeenCalled()
})

// @covers packages/app/src/features/local-apps/errors.ts
import { localAppErrorKey } from '../features/local-apps/errors'
it('shows management actions only after opening the three-dot menu', () => {
  const more = vi.fn(), remove = vi.fn(), open = vi.fn()
  const props = { title: 'App', machineName: 'Computer', testID: 'unit-app', removeLabel: 'Remove', moreLabel: 'Manage', colors: { surface: '#fff', brand: '#07f', text: '#111', textMuted: '#666' }, onOpen: open, onMore: more, onRemove: remove }
  const closed = nodes(LocalAppTile({ ...props, menuOpen: false }))
  expect(closed.find(n => n.props.accessibilityLabel === 'Remove')).toBeUndefined()
  const menuButton = closed.find(n => n.props.accessibilityLabel === 'Manage App')!
  ;(menuButton.props.onPress as () => void)()
  expect(more).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
  const expanded = nodes(LocalAppTile({ ...props, menuOpen: true }))
  const removeButton = expanded.find(n => n.props.accessibilityLabel === 'Remove')!
  ;(removeButton.props.onPress as () => void)()
  expect(remove).toHaveBeenCalledTimes(1)
  expect(expanded.filter(n => n.type === 'Text').map(n => n.props.children)).toEqual(['App', 'Computer', 'Remove'])
})
it('maps controlled connection errors without exposing raw exceptions or configuration', () => {
  const api = (error: string) => new Error(JSON.stringify({ error }))
  expect(localAppErrorKey(api('local_machine_unavailable'))).toBe('local_computer_offline')
  expect(localAppErrorKey(api('service_unavailable'))).toBe('local_service_stopped')
  expect(localAppErrorKey(api('service_timeout'))).toBe('local_service_slow')
  expect(localAppErrorKey(api('local_client_upgrade_required'))).toBe('local_update_client')
  expect(localAppErrorKey(api('local_app_unavailable'))).toBe('local_app_missing')
  expect(localAppErrorKey({ status: 404 })).toBe('local_not_ready')
  expect(localAppErrorKey({ status: 401 })).toBe('local_session_expired')
  expect(localAppErrorKey({ status: 410 })).toBe('local_reopen')
  expect(localAppErrorKey(new Error('private port, directory, stack trace'))).toBe('local_unavailable')
  expect(localAppErrorKey(new Error('{bad json'))).toBe('local_unavailable')
})

// @covers packages/app/src/features/interactive-content/ContentEntry.tsx
import { ContentEntry } from '../features/interactive-content/ContentEntry'
import { zhInteractiveContent } from '../../../../open-source/packages/shared/src/i18n/zh-interactive-content'
import { enInteractiveContent } from '../../../../open-source/packages/shared/src/i18n/en-interactive-content'
it('labels personal app development clearly and launches from a code icon without the steward avatar', () => {
  expect(zhInteractiveContent.content_entry).toBe('应用')
  expect(enInteractiveContent.content_entry).toBe('Apps')
  const tree = ContentEntry({}), rendered = nodes(tree)
  expect(rendered.find(n => n.props.name === 'code-slash-outline')?.props).toMatchObject({ size: 25, accessible: false })
  expect(rendered.filter(n => n.type === 'Image')).toHaveLength(0)
  const button = rendered.find(n => n.props.testID === 'interactive-content-entry')!
  expect(button.props.accessibilityLabel).toBe('content_entry')
  ;(button.props.onPress as () => void)()
  expect(entryNavigate).toHaveBeenCalledWith('/(main)/content')
  expect(ContentEntry({ query: 'unrelated query' })).toBeNull()
})

// @covers packages/app/src/features/local-apps/shortcuts.ts
import { createAppShortcutRepository, parseAppShortcuts, resolveAppShortcut } from '../features/local-apps/shortcuts'
it('persists feature app shortcuts by account, deduplicates and removes only the shortcut', async () => {
  const values = new Map<string, string>()
  const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value) } }
  const repo = createAppShortcutRepository(storage), notify = vi.fn()
  repo.subscribe(notify)
  const app = { machineId: 'mac', appId: 'wheel', title: 'Dinner' }
  await Promise.all([repo.change('alice', app), repo.change('alice', { ...app, title: 'Dinner wheel' })])
  expect(await createAppShortcutRepository(storage).read('alice')).toEqual([{ ...app, title: 'Dinner wheel' }])
  expect(await repo.read('bob')).toEqual([])
  await repo.change('alice', { ...app, machineId: 'other' })
  expect(await repo.change('alice', app, true)).toEqual([{ ...app, machineId: 'other' }])
  expect(notify).toHaveBeenCalledWith('alice')
  await expect(repo.change('', app)).rejects.toThrow()
  expect(parseAppShortcuts(JSON.stringify([null, {}, { ...app, title: '' }, app]))).toEqual([app])
})
it('keeps shortcut persistence failure observable and allows retry', async () => {
  const storage = { getItem: vi.fn(async () => null), setItem: vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined) }
  const repo = createAppShortcutRepository(storage), notify = vi.fn()
  repo.subscribe(notify)
  const app = { machineId: 'mac', appId: 'wheel', title: 'Dinner' }
  await expect(repo.change('alice', app)).rejects.toThrow('disk')
  expect(notify).not.toHaveBeenCalled()
  await expect(repo.change('alice', app)).resolves.toEqual([app])
})
it('exposes the app feature shortcut action through its management menu', () => {
  const toggle = vi.fn(), open = vi.fn(), remove = vi.fn()
  const tree = nodes(LocalAppTile({ title: 'Dinner', machineName: 'Mac', testID: 'app', removeLabel: 'Remove', moreLabel: 'More', menuOpen: true, shortcutLabel: 'Show in Features', onToggleShortcut: toggle, colors: { surface: '#fff', brand: '#07f', text: '#111', textMuted: '#666' }, onOpen: open, onMore: vi.fn(), onRemove: remove }))
  ;(tree.find(n => n.props.accessibilityLabel === 'Show in Features')!.props.onPress as () => void)()
  expect(toggle).toHaveBeenCalledOnce()
  expect(open).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
})

it('opens the chosen app from fresh registry data and never opens missing or stale apps', async () => {
  const app = { id: 'dinner', title: 'Dinner' } as import('@shennian/wire').LocalApp
  const client = { apps: vi.fn(async () => ({ apps: [app] })), runtime: vi.fn(async () => ({ runtimePath: '/runtime' })) }
  expect(await resolveAppShortcut('mac', 'dinner', client, () => true)).toEqual({ app, runtimePath: '/runtime' })
  expect(client.apps).toHaveBeenCalledWith('mac')
  expect(client.runtime).toHaveBeenCalledWith('mac', 'dinner')
  client.runtime.mockClear()
  await expect(resolveAppShortcut('mac', 'missing', client, () => true)).rejects.toThrow('local_app_unavailable')
  expect(client.runtime).not.toHaveBeenCalled()
  expect(await resolveAppShortcut('mac', 'dinner', client, () => false)).toBeNull()
  expect(client.runtime).not.toHaveBeenCalled()
  let active = true
  client.runtime.mockImplementationOnce(async () => { active = false; return { runtimePath: '/old-account' } })
  expect(await resolveAppShortcut('mac', 'dinner', client, () => active)).toBeNull()
})
