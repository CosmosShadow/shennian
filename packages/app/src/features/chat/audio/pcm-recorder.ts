// @arch docs/architecture/app/chat-voice-draft.md

export type PcmFrameListener = (frame: Uint8Array) => void
export type PcmErrorListener = (error: Error) => void

export interface PcmRecorder {
  /** Whether the platform can stream raw PCM (not all platforms can). */
  isAvailable(): Promise<boolean> | boolean
  /** Ask for microphone permission. */
  requestPermission(): Promise<boolean>
  /** Start capturing PCM frames. Emits `onFrame` until `stop()` is called. */
  start(): Promise<void>
  /** Stop capturing; releases the microphone. */
  stop(): Promise<void>
  /** Subscribe to 16-bit LE mono PCM frames. Returns an unsubscribe function. */
  onFrame(listener: PcmFrameListener): () => void
  /** Subscribe to fatal errors. Returns an unsubscribe function. */
  onError(listener: PcmErrorListener): () => void
}

export interface PcmRecorderOptions {
  sampleRate: number
  frameDurationMs: number
  /** Enables platform echo cancellation and voice-call audio routing. */
  voiceChat?: boolean
}

export const DEFAULT_PCM_OPTIONS: PcmRecorderOptions = {
  sampleRate: 16_000,
  frameDurationMs: 40,
}
