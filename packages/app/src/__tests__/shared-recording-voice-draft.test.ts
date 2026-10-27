// @vitest-environment happy-dom
// @covers src/features/chat/hooks/useVoiceDraft.native.ts
// @covers src/features/chat/audio/shared-recording-source.ts
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callbacks: null as any,
  context: null as any,
  audio: { getStatus: () => ({ isRecording: false }), stop: vi.fn() },
  sendAudio: vi.fn(), close: vi.fn(), hardware: vi.fn(), preview: vi.fn(), ready: vi.fn(),
  finalize: vi.fn(),
  t: (key: string) => key,
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }))
vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  useAudioRecorder: () => mocks.audio,
  useAudioRecorderState: () => ({}),
  requestRecordingPermissionsAsync: vi.fn(), setAudioModeAsync: vi.fn(),
}))
vi.mock('../config/auth', () => ({
  useAuthStore: Object.assign((select: any) => select({ user: { id: 'unit' } }), {
    getState: () => ({ user: { id: 'unit' }, token: 'unit-token' }),
  }),
}))
vi.mock('../config/log', () => ({ reportLog: vi.fn() }))
vi.mock('../features/privacy/aiDataConsent', () => ({ requestAiDataConsent: async () => true }))
vi.mock('../features/voice/voiceCaptureFeedback', () => ({
  createVoiceCaptureFeedback: () => ({ start: () => {}, end: () => {} }),
}))
vi.mock('../features/voice/voiceAccountClient', () => ({ voiceAccountClient: { finalizeText: mocks.finalize } }))
vi.mock('../features/chat/audio/create-pcm-recorder.native', () => ({ createPcmRecorder: mocks.hardware }))
vi.mock('../features/chat/audio/asr-client', () => ({
  createAsrClient: (context: any, callbacks: any) => {
    mocks.context = context
    mocks.callbacks = callbacks
    return { sendAudio: mocks.sendAudio, close: mocks.close, finish: () => callbacks.onEnd('新口述') }
  },
}))
import { useVoiceDraft } from '../features/chat/hooks/useVoiceDraft.native'
import { createSharedRecordingSource, hasSharedRecordingSource } from '../features/chat/audio/shared-recording-source'
import { acquirePcmLease, releasePcmLease } from '../features/chat/audio/pcm-lease'

let voice: ReturnType<typeof useVoiceDraft>
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
let source: ReturnType<typeof createSharedRecordingSource>
const owner = Symbol('continuous-owner')
function Harness({ sessionId = 'project-session', sessionDraftEnabled = true }: { sessionId?: string; sessionDraftEnabled?: boolean }) {
  voice = useVoiceDraft({ sessionId, sessionDraftEnabled, currentDraft: '草稿',
    onListeningTextChange: mocks.preview, onDraftReady: mocks.ready })
  return null
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  root = createRoot(host)
  source = createSharedRecordingSource()
  acquirePcmLease(owner)
  mocks.finalize.mockResolvedValue({ transcript: '新口述', draft: '草稿 新口述', intent: 'append', model: 'unit' })
})
afterEach(async () => {
  await act(async () => root.unmount())
  source.close()
  releasePcmLease(owner)
  vi.unstubAllGlobals()
})
describe('mobile dictation borrows the continuous microphone', () => {
  it('routes only future frames to the current project and returns a draft without stopping the owner', async () => {
    source.publish(new Uint8Array([1, 0])) // Historical audio must not be replayed.
    await act(async () => root.render(React.createElement(Harness)))
    await act(async () => expect(await voice.startRecording()).toBe(true))
    expect(mocks.hardware).not.toHaveBeenCalled()
    expect(mocks.context.sessionId).toBe('project-session')
    expect(mocks.sendAudio).not.toHaveBeenCalled()
    const frame = new Uint8Array([2, 0])
    await act(async () => { source.publish(frame); mocks.callbacks.onPartial('新口述') })
    expect(mocks.sendAudio).toHaveBeenCalledExactlyOnceWith(frame)
    expect(mocks.preview).toHaveBeenLastCalledWith(expect.stringContaining('新口述'))
    await act(async () => { await voice.stopRecording() })
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'project-session', transcript: '新口述' }))
    expect(mocks.ready).toHaveBeenCalledOnce()
    expect(source.borrowed).toBe(false)
    expect(hasSharedRecordingSource()).toBe(true)
    source.publish(frame)
    expect(mocks.sendAudio).toHaveBeenCalledTimes(1)
  })
  it('supports coordination draft-only contexts, cancellation and owner interruption', async () => {
    await act(async () => root.render(React.createElement(Harness, { sessionId: 'project-coordination:unit:machine:directory', sessionDraftEnabled: false })))
    await act(async () => expect(await voice.startRecording()).toBe(true))
    await act(async () => { await voice.stopRecording({ skipRefine: true }) })
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.ready).toHaveBeenCalledWith(expect.objectContaining({ transcript: '新口述', draft: expect.stringContaining('新口述') }))
    await act(async () => expect(await voice.startRecording()).toBe(true))
    await act(async () => voice.cancelRecording())
    expect(source.borrowed).toBe(false)
    expect(hasSharedRecordingSource()).toBe(true)
    await act(async () => expect(await voice.startRecording()).toBe(true))
    await act(async () => { source.close() })
    expect(voice.phase).toBe('error')
    expect(mocks.ready).toHaveBeenCalledTimes(1)
  })
})
