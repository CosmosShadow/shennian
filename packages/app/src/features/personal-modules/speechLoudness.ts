// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
/** Boost quiet synthesized PCM only; never alter capture or the device volume.
 * One gain per utterance avoids pumping between chunks. Peak headroom prevents
 * clipping, and a 12 dB cap keeps exceptionally quiet output from jumping loud.
 */
export function normalizeSpeechPcm(pcm: Uint8Array): Uint8Array {
  if (!pcm.length || pcm.length % 2) return pcm
  const input = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let peak = 0, energy = 0
  for (let at = 0; at < pcm.length; at += 2) {
    const sample = input.getInt16(at, true) / 32768
    peak = Math.max(peak, Math.abs(sample))
    energy += sample * sample
  }
  const rms = Math.sqrt(energy / (pcm.length / 2))
  // Silence/tiny noise and already loud audio are left alone.
  if (rms < 0.005 || !peak) return pcm
  const gain = Math.min(4, 0.125 / rms, 0.89 / peak)
  if (gain <= 1) return pcm
  const result = new Uint8Array(pcm.length), output = new DataView(result.buffer)
  for (let at = 0; at < pcm.length; at += 2)
    output.setInt16(at, Math.round(input.getInt16(at, true) * gain), true)
  return result
}
