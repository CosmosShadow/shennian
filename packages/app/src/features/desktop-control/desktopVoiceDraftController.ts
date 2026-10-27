// @arch docs/architecture/app/chat-voice-draft.md
// @test ../../__tests__/desktop-voice-draft.test.ts
import type { AsrClient, AsrClientCallbacks } from '../chat/audio/asr-client.native'
import type { PcmRecorder } from '../chat/audio/pcm-recorder'
import type { VoiceAccountClient, VoiceDraftResponse } from '../voice/voiceAccountClient.types'
import { mergeVoiceTranscriptIntoDraft, type VoiceComposerPhase } from '../chat/utils/voice'

export type DesktopVoiceDraftContext = { accountId: string | null; sessionId: string | null | undefined;
  sessionDraftEnabled?: boolean; currentDraft: string }
type Ports = {
  context(): DesktopVoiceDraftContext
  createRecorder(): PcmRecorder
  createAsr(sessionId: string, callbacks: AsrClientCallbacks): AsrClient
  finalize: VoiceAccountClient['finalizeText']
  onListeningTextChange(text: string): void
  onDraftReady(result: VoiceDraftResponse): void
}
type State = { phase: VoiceComposerPhase; error: string; transcript: string; startedAt: number; meterLevel: number }

/** Desktop capture/view lifecycle. Network state and retries belong exclusively to main. */
export class DesktopVoiceDraftController {
  private state: State = { phase: 'idle', error: '', transcript: '', startedAt: 0, meterLevel: 0 }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private recorder: PcmRecorder | null = null
  private client: AsrClient | null = null
  private unsubs: Array<() => void> = []
  private terminal = false
  private stopping = false
  private skipRefine = false
  private segments: string[] = []
  private active: DesktopVoiceDraftContext | null = null
  private startResolve: ((started: boolean) => void) | null = null
  private stopPromise: Promise<VoiceDraftResponse | null> | null = null
  private stopResolve: ((result: VoiceDraftResponse | null) => void) | null = null
  constructor(private readonly ports: Ports) {}
  getState = (): State => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  private current(generation: number): boolean {
    const context = this.ports.context()
    return generation === this.generation && this.active?.accountId === context.accountId &&
      this.active?.sessionId === context.sessionId
  }
  private releaseAudio(): Promise<void> {
    for (const unsubscribe of this.unsubs.splice(0)) unsubscribe()
    const client = this.client; this.client = null; client?.close()
    const recorder = this.recorder; this.recorder = null
    return recorder ? recorder.stop().catch(() => undefined) : Promise.resolve()
  }
  private settle(result: VoiceDraftResponse | null) {
    this.startResolve?.(false); this.startResolve = null
    this.stopResolve?.(result); this.stopResolve = null; this.stopPromise = null
  }
  cancel = async (): Promise<void> => {
    this.generation++
    this.terminal = true
    this.stopping = false
    this.settle(null)
    const release = this.releaseAudio()
    this.active = null
    this.update({ phase: 'idle', error: '', transcript: '', startedAt: 0, meterLevel: 0 })
    await release
  }
  clearError = () => { if (this.state.phase === 'error') this.update({ phase: 'idle', error: '' }) }
  private fail(generation: number, error: string) {
    if (!this.current(generation) || this.terminal) return
    this.terminal = true
    this.settle(null)
    void this.releaseAudio()
    this.update({ phase: 'error', error, startedAt: 0, meterLevel: 0 })
  }
  private preview(generation: number, transcript: string) {
    if (!this.current(generation) || this.terminal) return
    this.update({ transcript })
    this.ports.onListeningTextChange(mergeVoiceTranscriptIntoDraft(this.active!.currentDraft, transcript))
  }
  startRecording = async (): Promise<boolean> => {
    if (this.state.phase === 'listening') return false
    if (this.state.phase === 'refining') await this.cancel()
    const context = this.ports.context()
    if (!context.accountId || !context.sessionId) return false
    const generation = ++this.generation
    this.active = { ...context }; this.terminal = false; this.stopping = false; this.skipRefine = false; this.segments = []
    this.update({ phase: 'listening', error: '', transcript: '', startedAt: 0, meterLevel: 0 })
    const started = new Promise<boolean>((resolve) => { this.startResolve = resolve })
    try {
      const recorder = this.ports.createRecorder()
      this.recorder = recorder
      if (!(await recorder.isAvailable())) throw new Error('voice_recording_failed')
      if (!this.current(generation) || this.terminal) { await recorder.stop(); return false }
      if (!(await recorder.requestPermission())) throw new Error('voice_permission_denied')
      if (!this.current(generation) || this.terminal) { await recorder.stop(); return false }
      this.unsubs.push(recorder.onFrame((frame) => {
        if (!this.current(generation) || this.terminal || this.stopping) return
        this.client?.sendAudio(frame)
        this.update({ meterLevel: pcmLevel(frame) })
      }), recorder.onError(() => this.fail(generation, 'voice_recording_failed')))
      const client = this.ports.createAsr(context.sessionId, {
        onReady: () => {
          if (!this.current(generation) || this.terminal || this.stopping) return
          void recorder.start().then(async () => {
            if (!this.current(generation) || this.terminal || this.stopping) { await recorder.stop(); return }
            this.update({ startedAt: Date.now() })
            this.startResolve?.(true); this.startResolve = null
          }).catch(() => this.fail(generation, 'voice_recording_failed'))
        },
        onPartial: (text) => this.preview(generation, this.segments.join('') + text),
        onFinal: (text, index) => {
          if (!this.current(generation) || this.terminal) return
          if (!Number.isInteger(index) || index < 0 || index > 10_000) { this.fail(generation, 'voice_asr_failed'); return }
          this.segments[index] = text
          this.preview(generation, this.segments.join(''))
        },
        onEnd: (text) => { void this.finishTranscript(generation, text) },
        onError: () => this.fail(generation, 'voice_asr_failed'),
        onClose: () => this.fail(generation, 'voice_asr_failed'),
      })
      if (!this.current(generation) || this.terminal) client.close()
      else {
        this.client = client
        if (this.stopping) client.finish()
      }
    } catch (error) {
      this.fail(generation, error instanceof Error && error.message === 'voice_permission_denied'
        ? 'voice_permission_denied' : 'voice_recording_failed')
    }
    return started
  }
  stopRecording = (options?: { skipRefine?: boolean }): Promise<VoiceDraftResponse | null> => {
    if (this.stopPromise) return this.stopPromise
    if (this.state.phase !== 'listening' || this.terminal) return Promise.resolve(null)
    this.stopping = true; this.skipRefine = Boolean(options?.skipRefine)
    this.stopPromise = new Promise((resolve) => { this.stopResolve = resolve })
    const pending = this.stopPromise
    this.startResolve?.(false); this.startResolve = null
    if (!this.client) void this.cancel()
    else {
      void this.recorder?.stop().catch(() => undefined)
      this.client.finish()
    }
    return pending
  }
  private async finishTranscript(generation: number, rawTranscript: string): Promise<void> {
    if (!this.current(generation) || this.terminal) return
    this.terminal = true
    const context = this.active!
    const transcript = rawTranscript.trim()
    await this.releaseAudio()
    if (!this.current(generation)) return
    if (!transcript) { this.update({ phase: 'idle', startedAt: 0, meterLevel: 0 }); this.settle(null); return }
    const draft = mergeVoiceTranscriptIntoDraft(context.currentDraft, transcript)
    this.ports.onListeningTextChange(draft)
    this.update({ phase: 'refining', transcript, startedAt: 0, meterLevel: 0 })
    try {
      const result: VoiceDraftResponse = context.sessionDraftEnabled === false
        ? { transcript, draft, intent: context.currentDraft.trim() ? 'append' : 'new', model: 'client-transcript' }
        : await this.ports.finalize({ sessionId: context.sessionId!, currentDraft: context.currentDraft,
          transcript, cleanup: !this.skipRefine })
      if (!this.current(generation)) return
      this.update({ phase: 'idle', transcript: result.transcript })
      this.ports.onDraftReady(result)
      this.settle(result)
    } catch {
      if (!this.current(generation)) return
      this.update({ phase: 'error', error: 'voice_processing_failed' })
      this.settle(null)
    }
  }
}

function pcmLevel(frame: Uint8Array): number {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const count = Math.min(Math.floor(frame.byteLength / 2), 320)
  if (!count) return 0
  let squares = 0
  for (let i = 0; i < count; i++) squares += (view.getInt16(i * 2, true) / 32768) ** 2
  return Math.min(1, Math.sqrt(squares / count) * 4)
}
