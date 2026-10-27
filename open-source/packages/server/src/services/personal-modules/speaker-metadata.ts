// @arch open-source/docs/server-runtime.md
// @test src/__tests__/recording-speakers.test.ts
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_speaker_metadata')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('invalid_speaker_metadata')
  return value.trim()
}
export type SpeakerSentence = { beginMs: number; endMs: number; speakerId: number | null; text: string }
/** Untrusted client/provider metadata is annotation, never identity or authority. */
export function speakerMetadata(input: Record<string, unknown>, durationMs: number): {
  speakerStatus?: 'done' | 'unavailable'; speakerSentences?: SpeakerSentence[]
} {
  if (input.speakerStatus === undefined && input.speakerSentences === undefined) return {}
  if (input.speakerStatus === 'unavailable' && input.speakerSentences === undefined)
    return { speakerStatus: 'unavailable' }
  if (input.speakerStatus !== 'done' || !Array.isArray(input.speakerSentences) ||
      !input.speakerSentences.length || input.speakerSentences.length > 500)
    throw new Error('invalid_speaker_metadata')
  let previous = -1, budget = 20000
  const speakerSentences = input.speakerSentences.map(raw => {
    const s = object(raw), beginMs = Number(s.beginMs), endMs = Number(s.endMs)
    if (typeof s.beginMs !== 'number' || typeof s.endMs !== 'number' ||
        !Number.isSafeInteger(beginMs) || !Number.isSafeInteger(endMs) ||
        beginMs < 0 || beginMs < previous || endMs < beginMs || endMs > durationMs ||
        (s.speakerId !== null && (!Number.isSafeInteger(s.speakerId) || Number(s.speakerId) < 0 || Number(s.speakerId) > 999)))
      throw new Error('invalid_speaker_metadata')
    previous = beginMs
    const content = text(s.text, Math.min(20000, budget))
    budget -= content.length
    return { beginMs, endMs, speakerId: s.speakerId as number | null, text: content }
  })
  return { speakerStatus: 'done', speakerSentences }
}
