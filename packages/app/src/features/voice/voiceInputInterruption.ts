// @arch docs/features/voice-shennian.md
// @test packages/app/src/__tests__/voice-input-interruption.test.ts

export type VoiceInputInterruptionReason = 'voice-chief-call-starting'

type VoiceInputInterruptionListener = (reason: VoiceInputInterruptionReason) => void

const listeners = new Set<VoiceInputInterruptionListener>()

export function subscribeVoiceInputInterruption(listener: VoiceInputInterruptionListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyVoiceInputInterruption(reason: VoiceInputInterruptionReason): void {
  for (const listener of [...listeners]) {
    listener(reason)
  }
}

export function getVoiceInputInterruptionListenerCountForTest(): number {
  return listeners.size
}
