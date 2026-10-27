// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-voice-bridge.test.ts

export type DesktopAsrFrame =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; index: number }
  | { type: 'end'; transcript: string }
  | { type: 'error'; code: string; message: string }
export type DesktopVoiceResult = { ok: true; value: undefined }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }
type Scope = { id: string; accountId: string; sequence: number }
export type DesktopVoiceEvent = Scope & (
  | { kind: 'asr'; type: 'frame'; frame: DesktopAsrFrame }
  | { kind: 'asr'; type: 'connection'; state: 'connecting' | 'closed' }
)
export type DesktopVoiceBridge = {
  startAsr(input: { id: string; sessionId: string; lang?: string }): Promise<DesktopVoiceResult>
  sendAudio(input: { id: string; pcm: Uint8Array }): Promise<DesktopVoiceResult>
  finishAsr(input: { id: string }): Promise<DesktopVoiceResult>
  close(input: { id: string }): Promise<DesktopVoiceResult>
  subscribe(listener: (event: DesktopVoiceEvent) => void): () => void
}

export function requireDesktopVoiceBridge(): DesktopVoiceBridge {
  const bridge = (globalThis as typeof globalThis & { shennianDesktop?: { voice?: DesktopVoiceBridge } }).shennianDesktop?.voice
  if (!bridge || ['startAsr', 'sendAudio', 'finishAsr', 'close', 'subscribe']
    .some((method) => typeof bridge[method as keyof DesktopVoiceBridge] !== 'function')) {
    throw new Error('Desktop voice bridge is unavailable')
  }
  return bridge
}
