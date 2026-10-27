// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
import { normalizeSpeechPcm } from './speechLoudness'
import type { PcmStreamPlayer } from '../voice-chief/audio/pcm-player'
export type SpeechAudio = { sampleRate: number; pcmBase64: string; text?: string }
/** Owns only this feedback playback; stopping also invalidates async startup. */
export function createCloudSpeechPlayer(createPlayer: () => PcmStreamPlayer) {
  let epoch = 0
  let player: PcmStreamPlayer | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let detach: Array<() => void> = []
  const stop = async () => {
    epoch++
    if (timer) clearTimeout(timer)
    timer = null
    detach.forEach(fn => fn())
    detach = []
    const previous = player
    player = null
    await previous?.stop()
  }
  return {
    stop,
    async play(audio: SpeechAudio, done: () => void, failed: () => void, started?: () => void) {
      const stopping = stop(), generation = epoch
      await stopping
      if (generation !== epoch) return
      const current = createPlayer(), id = `recording-feedback:${generation}`
      player = current
      const complete = (success: boolean) => {
        if (generation !== epoch) return
        void stop().catch(() => {}).finally(() => success ? done() : failed())
      }
      try {
        const raw = globalThis.atob(audio.pcmBase64)
        if (!raw.length || raw.length % 2 || raw.length > 6 * 1024 * 1024 || ![16000, 24000, 48000].includes(audio.sampleRate)) throw new Error('invalid_audio')
        const bytes = normalizeSpeechPcm(Uint8Array.from(raw, c => c.charCodeAt(0)))
        detach = [current.onComplete(responseId => { if (responseId === id) complete(true) }), current.onError(() => complete(false))]
        timer = setTimeout(() => complete(false), bytes.length / (audio.sampleRate * 2) * 1000 + 10000)
        await current.start(audio.sampleRate)
        if (generation !== epoch) return
        for (let at = 0; at < bytes.length; at += 4800) {
          if (generation !== epoch) return
          await current.enqueue(id, bytes.subarray(at, at + 4800))
          if (at === 0 && generation === epoch) started?.()
        }
        if (generation === epoch) await current.finish(id)
      } catch { complete(false) }
    },
  }
}
