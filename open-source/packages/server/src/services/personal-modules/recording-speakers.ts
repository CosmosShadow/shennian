// @arch open-source/docs/server-runtime.md
// @test src/__tests__/recording-speakers.test.ts
import { createHash } from 'node:crypto'
import { object, text, instant, dayKey } from './domain.js'
import { get, put, records, keyWhere } from './store.js'
import { withDistributedLease } from '../distributed-lease.js'
import { speakerMetadata } from './speaker-metadata.js'
export const MAX_SPEAKER_PCM = 65 * 32000
export function speakerWav(pcm: Buffer) {
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_SPEAKER_PCM) throw new Error('invalid_speaker_audio')
  const wav = Buffer.alloc(44 + pcm.length)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44)
  return wav
}
export function parseSpeakerResult(raw: unknown, durationMs: number) {
  const output = object(object(raw).output)
  if (!Array.isArray(output.sentences)) throw new Error('speakers_unavailable')
  return speakerMetadata({ speakerStatus: 'done', speakerSentences: output.sentences.map(rawSentence => {
    const s = object(rawSentence)
    if (s.sentence_end !== true) throw new Error('speakers_unavailable')
    return { beginMs: s.begin_time, endMs: s.end_time, speakerId: s.speaker_id, text: s.text }
  }) }, durationMs)
}
export async function recognizeSpeakers(pcm: Buffer) {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) throw new Error('speakers_unavailable')
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'disable' },
    body: JSON.stringify({ model: 'qwen-audio-3.1-asr-flash', input: { messages: [{ role: 'user', content: [{
      type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${speakerWav(pcm).toString('base64')}` },
    }] }] }, parameters: { format: 'wav', sample_rate: '16000', speaker_diarization_enabled: true } }),
  })
  if (!response.ok) throw new Error('speakers_unavailable')
  return parseSpeakerResult(await response.json(), pcm.length / 32)
}
/** Short, authenticated recording windows. Never accept remote URLs or keep audio.
 * A persisted pending marker prevents blind re-billing after a timed-out call.
 * Speaker numbers are scoped to this window, NOT linked across windows/days.
 */
export async function recordingSpeakers(userId: string, raw: unknown) {
  const b = object(raw), key = text(b.key), sessionKey = text(b.sessionKey), startAt = instant(b.startAt)
  const timezone = text(b.timezone, 100), day = dayKey(startAt, timezone)
  if (typeof b.pcmBase64 !== 'string' || !b.pcmBase64.length || b.pcmBase64.length > Math.ceil(MAX_SPEAKER_PCM / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.pcmBase64))
    throw new Error('invalid_speaker_audio')
  const pcm = Buffer.from(b.pcmBase64, 'base64')
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_SPEAKER_PCM) throw new Error('invalid_speaker_audio')
  if (!(await get(userId, 'recording-session', sessionKey))) throw new Error('invalid_session')
  if (await get(userId, 'deleted-day', day)) throw new Error('invalid_deleted_day')
  const digest = createHash('sha256').update(JSON.stringify([sessionKey, startAt, timezone])).update(pcm).digest('hex')
  const lease = await withDistributedLease({ name: `personal-speakers:${userId}`, ttlMs: 110000, run: async () => {
    const old = await get(userId, 'recording-diarization', key)
    if (old) {
      const p = object(old.payload)
      if (p.digest !== digest) throw new Error('identity_conflict')
      return p.result ?? { speakerStatus: 'unavailable' }
    }
    const clock = await get(userId, 'analysis-clock', 'speakers')
    if (clock && Number(object(clock.payload).at) > Date.now() - 10000) throw new Error('speakers_busy')
    await put(userId, 'analysis-clock', 'speakers', { at: Date.now() })
    await records.create({ data: { userId, kind: 'recording-diarization', key, sessionKey, day, payload: { digest } } })
    let result: ReturnType<typeof speakerMetadata>
    try { result = await recognizeSpeakers(pcm) }
    catch { result = { speakerStatus: 'unavailable' } }
    // Deletion may race the provider call. Never recreate its cache afterwards.
    if (await get(userId, 'deleted-day', day)) throw new Error('invalid_deleted_day')
    await records.updateMany({ where: { ...keyWhere(userId, 'recording-diarization', key).userId_kind_key }, data: { payload: { digest, result } } })
    return result
  } })
  if (!lease.acquired) throw new Error('speakers_busy')
  return lease.result
}
