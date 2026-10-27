// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../../__tests__/desktop-asr-client.test.ts
import { useAuthStore } from '../../../config/auth'
import { requireDesktopVoiceBridge, type DesktopVoiceBridge, type DesktopVoiceResult } from '../../desktop-control/desktopVoiceBridge'
import type { AsrClient, AsrClientCallbacks, AsrClientPhase } from './asr-client.native'
export type { AsrClient, AsrClientCallbacks, AsrClientPhase } from './asr-client.native'

export type AsrClientOptions = { sessionId: string; lang?: string }
let serial = 0

/** Only bounded voice commands cross preload. Native's WebSocket implementation is not imported at runtime. */
export function createDesktopAsrClient(
  options: AsrClientOptions,
  callbacks: AsrClientCallbacks,
  bridge: DesktopVoiceBridge,
  accountId: string,
  currentAccount: () => string | null,
): AsrClient {
  const id = `asr-${Date.now()}-${++serial}`
  let phase: AsrClientPhase = 'connecting'
  let sequence = 0
  let terminal = false
  let pendingBytes = 0
  let unsubscribe = () => {}
  const closeMain = () => { void Promise.resolve().then(() => bridge.close({ id })).catch(() => undefined) }
  const closeLocal = () => {
    if (phase === 'closed') return
    phase = 'closed'
    unsubscribe()
    callbacks.onClose()
  }
  const fail = (code: string, message: string) => {
    if (terminal || phase === 'closed') return
    terminal = true
    callbacks.onError(code, message)
    closeMain()
    closeLocal()
  }
  const checkResult = (result: DesktopVoiceResult) => {
    if (!result.ok) fail(result.error.code, result.error.message)
  }
  const run = (operation: Promise<DesktopVoiceResult>) => {
    void operation.then(checkResult).catch(() => fail('BRIDGE_FAILED', 'Desktop voice command failed'))
  }
  unsubscribe = bridge.subscribe((event) => {
    if (event.id !== id || event.kind !== 'asr' || event.accountId !== accountId ||
      event.sequence <= sequence || phase === 'closed') return
    if (currentAccount() !== accountId) { terminal = true; closeMain(); closeLocal(); return }
    sequence = event.sequence
    if (event.type === 'connection') {
      if (event.state === 'closed') closeLocal()
      return
    }
    if (event.type !== 'frame' || terminal) return
    const frame = event.frame
    switch (frame.type) {
      case 'ready':
        if (phase === 'connecting') { phase = 'ready'; callbacks.onReady() }
        break
      case 'partial': callbacks.onPartial(frame.text); break
      case 'final': callbacks.onFinal(frame.text, frame.index); break
      case 'end':
        terminal = true
        callbacks.onEnd(frame.transcript)
        closeLocal()
        break
      case 'error': fail(frame.code, frame.message); break
    }
  })
  try { run(bridge.startAsr({ id, sessionId: options.sessionId,
    ...(options.lang === undefined ? {} : { lang: options.lang }) })) }
  catch (error) { unsubscribe(); closeMain(); throw error }
  return {
    sendAudio(frame) {
      if (phase === 'closed' || phase === 'stopping' || terminal) return
      if (currentAccount() !== accountId) { terminal = true; closeMain(); closeLocal(); return }
      const bytes = frame.byteLength
      if (!bytes || bytes > 64 * 1024 || pendingBytes + bytes > 128 * 1024) {
        fail('AUDIO_LIMIT_EXCEEDED', 'Desktop audio queue limit exceeded')
        return
      }
      const pcm = frame instanceof ArrayBuffer ? new Uint8Array(frame.slice(0)) : new Uint8Array(frame)
      pendingBytes += bytes
      try { run(bridge.sendAudio({ id, pcm }).finally(() => { pendingBytes -= bytes })) }
      catch { pendingBytes -= bytes; fail('BRIDGE_FAILED', 'Desktop voice command failed') }
    },
    finish() {
      if (phase === 'closed' || phase === 'stopping' || terminal) return
      phase = 'stopping'
      try { run(bridge.finishAsr({ id })) }
      catch { fail('BRIDGE_FAILED', 'Desktop voice command failed') }
    },
    close() { if (phase === 'closed') return; terminal = true; closeMain(); closeLocal() },
    get phase() { return phase },
  }
}

export function createAsrClient(options: AsrClientOptions, callbacks: AsrClientCallbacks): AsrClient {
  const accountId = useAuthStore.getState().user?.id
  if (!accountId) throw new Error('Desktop voice requires a signed-in account')
  return createDesktopAsrClient(options, callbacks, requireDesktopVoiceBridge(), accountId,
    () => useAuthStore.getState().user?.id ?? null)
}
