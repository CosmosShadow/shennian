// @vitest-environment happy-dom
// @covers packages/app/src/features/steward/components/StewardComposerInput.tsx
// @covers packages/app/src/features/steward/components/StewardStandbyComposer.tsx
// @covers packages/app/src/features/steward/useComposerFileHandoff.ts
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  presses: {} as Record<string, any>,
  insetBottom: 0, dockBottom: 0,
  keyboard: new Map<string, () => void>(),
  text: {} as any,
  notify: vi.fn(),
  navigate: vi.fn(),
  start: vi.fn(async () => true),
  stop: vi.fn(async () => ({ draft: 'spoken words' })),
  cancel: vi.fn(),
  phase: 'idle',
  recordingActive: false,
  pick: vi.fn(async () => [
    { uri: 'file://unit-only', name: 'notes.txt', size: 4, mimeType: 'text/plain' },
  ]),
}))
vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    Platform: { OS: 'ios' },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    ActivityIndicator: () => null,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Keyboard: { dismiss: vi.fn(), addListener: (event: string, listener: () => void) => { state.keyboard.set(event, listener); return { remove: () => state.keyboard.delete(event) } } },
    Alert: { alert: state.notify },
    View: ({ children, testID, style }: any) => { const merged = Array.isArray(style) ? Object.assign({}, ...style) : style; if (testID === 'composer-dock') state.dockBottom = merged.paddingBottom; return React.createElement('div', { 'data-testid': testID, 'data-height': merged?.height, 'data-width': merged?.width }, children) },
    Text: ({ children }: any) => React.createElement('span', null, children),
    Pressable: (props: any) => {
      if (props.testID) state.presses[props.testID] = props
      return React.createElement(
        'button',
        {
          onClick: props.onPress,
          'data-testid': props.testID,
          'aria-label': props.accessibilityLabel,
        },
        props.children,
      )
    },
    TextInput: React.forwardRef((props: any, ref: any) => {
      state.text = props
      return React.createElement('textarea', {
        ref,
        'data-testid': props.testID,
        value: props.value,
        onChange: (event) => props.onChangeText((event.target as HTMLTextAreaElement).value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') props.onSubmitEditing()
        },
      })
    }),
  }
})
vi.mock('expo-router', () => ({ useRouter: () => ({ navigate: state.navigate }), router: { navigate: state.navigate } }))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }))
vi.mock('../components/AppPageHeader', () => ({ HeaderIconButton: () => null }))
vi.mock('../components/ActionIcon', () => ({ ActionIcon: () => null }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('@expo/vector-icons/Feather', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => {
  const useAuthStore = Object.assign((select: any) => select({ user: { id: 'unit' } }), {
    getState: () => ({ user: { id: 'unit' } }),
  })
  return { useAuthStore }
})
vi.mock('../features/personal-modules/runtime', () => ({
  useRecordingState: (select: any) => select({ active: state.recordingActive }),
  stopRecording: vi.fn(),
}))
vi.mock('../features/personal-modules/confirmRecordingStart', () => ({
  confirmRecordingStart: vi.fn(),
}))
vi.mock('../features/steward/standbyFiles', () => ({ pickStandbyFiles: state.pick }))
vi.mock('../features/steward/useStewardInspiration', () => ({
  useStewardInspiration: (options: any) => ({
    openInspiration: vi.fn(),
    inspirationUi: options.enabled ? React.createElement(
      'button',
      { 'data-testid': 'steward-inspiration-open' },
      'inspiration_title',
    ) : null,
  }),
}))
vi.mock('../features/chat/hooks/useVoiceDraft', () => ({
  useVoiceDraft: () => ({
    phase: state.phase,
    startRecording: state.start,
    stopRecording: state.stop,
    cancelRecording: state.cancel,
  }),
}))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: state.insetBottom, left: 0, right: 0 }) }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unit-only' }))
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
vi.mock('../features/personal-modules/createCloudReminder', () => ({ createCloudReminder: vi.fn() }))
import { ScheduleComposer } from '../features/personal-modules/ScheduleComposer'
import { StewardComposerInput } from '../features/steward/components/StewardComposerInput'
import { StewardStandbyComposer } from '../features/steward/components/StewardStandbyComposer'
import { mergeComposerDrafts, useComposerDraft } from '../features/steward/useComposerDraft'
import { useComposerFileHandoff } from '../features/steward/useComposerFileHandoff'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined, host: HTMLDivElement
const render = async (element: React.ReactNode) => {
  if (!root) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  await act(async () => root!.render(element))
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  state.recordingActive = false
  state.phase = 'idle'
  state.presses = {}
  vi.clearAllMocks()
})
const props = () => ({
  input: '',
  onChange: vi.fn(),
  inputRef: React.createRef<any>(),
  onFocus: vi.fn(),
  onBlur: vi.fn(),
  actions: React.createElement('span', null, '+'),
  colors: {} as any,
  phase: 'idle' as const,
  disabled: false,
  canSend: true,
  sending: false,
  onSend: vi.fn(),
  onStart: vi.fn(async () => true),
  onRelease: vi.fn(async () => {}),
  onDictationStop: vi.fn(async () => {}),
  onCancel: vi.fn(),
})

describe('shared floating mobile input', () => {
  it('removes both inspiration entries on contextual pages keeps files and moves recording control to its dedicated page', async () => {
    await render(React.createElement(StewardStandbyComposer, { input: '', onChange() {}, onFiles() {}, reason: 'unit-only', inspirationEnabled: false }))
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).toBeNull()
    await act(async () => state.presses['composer-more-btn'].onPress())
    expect(host.textContent).not.toContain('inspiration_title')
    expect(host.textContent).not.toContain('personal_recording')
    expect(host.textContent).toContain('composer_menu_file')
  })

  it('uses the same contextual hint before readiness and while editing without writing it into the draft', async () => {
    const onChange = vi.fn()
    await render(React.createElement(StewardStandbyComposer, { input: '', onChange, onFiles() {}, reason: 'not ready', placeholder: 'Calendar: add, edit or delete' }))
    expect(host.textContent).toContain('Calendar: add, edit or delete')
    await act(async () => state.presses['steward-hold-input'].onPress())
    expect(state.text.placeholder).toBe('Calendar: add, edit or delete')
    expect(state.text.value).toBe('')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses the same bottom gap before readiness and puts the no-Tab input at the device safe edge', async () => {
    const element = React.createElement(StewardStandbyComposer, { input: '', onChange() {}, onFiles() {}, reason: 'unit-only' })
    state.insetBottom = 0
    await render(element); expect(state.dockBottom).toBe(8)
    state.insetBottom = 34
    await render(React.createElement(StewardStandbyComposer, { input: '', onChange() {}, onFiles() {}, reason: 'unit-only' }))
    expect(state.dockBottom).toBe(34)
    state.insetBottom = 0
  })

  it('gives Calendar the same 8pt Tab gap, preserves a standalone safe inset, and removes it above the keyboard', async () => {
    state.insetBottom = 0
    const created = async () => {}
    await render(React.createElement(ScheduleComposer, { onCreated: created }))
    expect(state.dockBottom).toBe(8)
    state.insetBottom = 34
    await render(React.createElement(ScheduleComposer, { onCreated: created }))
    expect(state.dockBottom).toBe(34)
    await act(async () => state.keyboard.get('keyboardWillShow')!())
    expect(state.dockBottom).toBe(8)
    state.insetBottom = 0
  })
  it('merges only the first sender hydration, then lets normal send clear the draft', async () => {
    let restore!: React.Dispatch<React.SetStateAction<string>>
    function Probe() {
      const [text, , hydrate] = useComposerDraft(undefined, 'before ready')
      restore = hydrate
      return React.createElement('span', null, text)
    }
    await render(React.createElement(Probe))
    await act(async () => restore('saved draft'))
    expect(host.textContent).toBe('saved draft\nbefore ready')
    await act(async () => restore(''))
    expect(host.textContent).toBe('')
  })

  it('preserves standby input across real-session draft hydration without duplicating it', () => {
    expect(mergeComposerDrafts('', 'before ready')).toBe('before ready')
    expect(mergeComposerDrafts('saved draft', 'before ready')).toBe('saved draft\nbefore ready')
    expect(mergeComposerDrafts('same', 'same')).toBe('same')
  })
  it('keeps the plus inside the pill, the direct dictation mic, and system Send / Enter', async () => {
    const options = props()
    await render(React.createElement(StewardComposerInput, options))
    expect(host.querySelector('[data-testid="floating-composer-pill"]')?.textContent).toMatch(/^\+/)
    expect(host.querySelector('[data-testid="send-btn"]')).toBeNull()
    expect(host.querySelector('[data-testid="voice-btn"]')).not.toBeNull()
    await act(async () => state.presses['steward-hold-input'].onPress())
    expect(state.text.returnKeyType).toBe('send')
    expect(state.text.submitBehavior).toBe('submit')
    expect(state.text.multiline).toBe(false)
    expect(state.text.style[0].height).toBe(44)
    expect(state.text.style[0].maxHeight).toBe(44)
    await act(async () =>
      host
        .querySelector('textarea')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    )
    expect(options.onSend).toHaveBeenCalledOnce()
  })
  it('does not crowd the input with continuous-recording status and keeps typing available', async () => {
    state.recordingActive = true
    const options = props()
    await render(React.createElement(StewardComposerInput, options))
    expect(host.querySelector('[data-testid="composer-recording-status"]')).toBeNull()
    expect(host.textContent).not.toContain('personal_recording_active')
    await act(async () => state.presses['steward-hold-input'].onPress())
    expect(host.querySelector('textarea')).not.toBeNull()
  })
  it('tap microphone stops into the draft without invoking hold-send or message send', async () => {
    const options = props()
    await render(React.createElement(StewardComposerInput, options))
    await act(async () => state.presses['voice-btn'].onPress())
    expect(options.onStart).toHaveBeenCalledOnce()
    await render(React.createElement(StewardComposerInput, { ...options, phase: 'listening' }))
    await act(async () => state.presses['voice-listening-indicator'].onPress())
    expect(options.onDictationStop).toHaveBeenCalledOnce()
    expect(options.onRelease).not.toHaveBeenCalled()
    expect(options.onSend).not.toHaveBeenCalled()
  })
  it('shows live dictation text and the same audio-reactive wave used by project input', async () => {
    const options = props()
    await render(React.createElement(StewardComposerInput, options))
    await act(async () => state.presses['voice-btn'].onPress())
    await render(React.createElement(StewardComposerInput, { ...options, phase: 'listening', input: 'live recognized words', meterLevel: 0 }))
    expect(host.textContent).toContain('live recognized words')
    const quiet = Number(host.querySelector('[data-width="4"]')?.getAttribute('data-height'))
    await render(React.createElement(StewardComposerInput, { ...options, phase: 'listening', input: 'new live words', meterLevel: 1 }))
    expect(host.textContent).toContain('new live words')
    expect(Number(host.querySelector('[data-width="4"]')?.getAttribute('data-height'))).toBeGreaterThan(quiet)
    expect(host.querySelectorAll('[data-width="4"]')).toHaveLength(12)
  })
  it('can restart tap dictation after an error, and cancels a running tap session on unmount', async () => {
    const options = props()
    await render(React.createElement(StewardComposerInput, options))
    await act(async () => state.presses['voice-btn'].onPress())
    await render(React.createElement(StewardComposerInput, { ...options, phase: 'listening' }))
    await render(React.createElement(StewardComposerInput, { ...options, phase: 'error' }))
    await act(async () => state.presses['voice-btn'].onPress())
    expect(options.onStart).toHaveBeenCalledTimes(2)
    await render(null)
    expect(options.onCancel).toHaveBeenCalledOnce()
    expect(options.onSend).not.toHaveBeenCalled()
  })
  it('ignores repeated mic taps while permission/start is pending and allows retry after rejection', async () => {
    const options = props()
    let complete!: (started: boolean) => void
    options.onStart.mockImplementationOnce(() => new Promise<boolean>(resolve => { complete = resolve }))
    await render(React.createElement(StewardComposerInput, options))
    let pending!: Promise<unknown>
    await act(async () => { pending = state.presses['voice-btn'].onPress() })
    await act(async () => state.presses['voice-btn'].onPress())
    expect(options.onStart).toHaveBeenCalledOnce()
    await act(async () => { complete(false); await pending })
    await act(async () => state.presses['voice-btn'].onPress())
    expect(options.onStart).toHaveBeenCalledTimes(2)
  })
  it('does not replace the hold target with a text editor while ASR previews arrive; release still ends the gesture', async () => {
    const options = props()
    await render(React.createElement(StewardComposerInput, options))
    await act(async () => state.presses['steward-hold-input'].onLongPress())
    await render(
      React.createElement(StewardComposerInput, {
        ...options,
        phase: 'listening',
        input: 'speech preview',
      }),
    )
    expect(host.querySelector('textarea')).toBeNull()
    await act(async () => state.presses['steward-hold-input'].onPressOut())
    expect(options.onRelease).toHaveBeenCalledOnce()
  })
  it('keeps the complete input, default inspiration and local file menu available before an Agent/session is ready', async () => {
    const onFiles = vi.fn()
    await render(
      React.createElement(StewardStandbyComposer, {
        input: 'draft',
        onChange: vi.fn(),
        onFiles,
        reason: 'not ready',
      }),
    )
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).not.toBeNull()
    await act(async () => state.presses['composer-more-btn'].onPress())
    const file = host.querySelector('button[aria-label="composer_menu_files"]') as HTMLButtonElement
    await act(async () => file.click())
    expect(onFiles.mock.calls[0][0].files[0].name).toBe('notes.txt')
    await act(async () => state.presses['steward-hold-input'].onPress())
    await act(async () => state.text.onSubmitEditing())
    expect(state.notify).toHaveBeenCalledWith('steward_title', 'not ready')
  })
  it('keeps pending files until the real target can accept them and hands each batch over only once', async () => {
    const batch = {
      id: 4,
      files: [{ uri: 'file://unit-only', name: 'draft.txt', size: 4, mimeType: 'text/plain' }],
    }
    const accepted = vi.fn(),
      unavailable = vi.fn(() => false),
      ready = vi.fn(() => true)
    function Handoff({ upload }: { upload: typeof ready }) {
      useComposerFileHandoff(batch, upload, accepted)
      return null
    }
    await render(React.createElement(Handoff, { upload: unavailable }))
    expect(accepted).not.toHaveBeenCalled()
    await render(React.createElement(Handoff, { upload: ready }))
    await render(React.createElement(Handoff, { upload: ready }))
    expect(ready).toHaveBeenCalledOnce()
    expect(accepted).toHaveBeenCalledOnce()
  })
})
