// @covers src/services/personal-modules/recording-speakers.ts
// @covers src/services/personal-modules/speaker-metadata.ts
// @covers src/services/personal-modules/domain.ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ rows: new Map<string, any>(), busy: false }))
const id = (user: string, kind: string, key: string) => `${user}:${kind}:${key}`
vi.mock('../services/personal-modules/store.js', () => ({
  get: async (u: string, k: string, key: string) => state.rows.get(id(u, k, key)) ?? null,
  put: async (u: string, k: string, key: string, payload: unknown) => state.rows.set(id(u, k, key), { payload }),
  keyWhere: (userId: string, kind: string, key: string) => ({ userId_kind_key: { userId, kind, key } }),
  records: {
    create: async ({ data }: any) => { state.rows.set(id(data.userId, data.kind, data.key), data) },
    updateMany: async ({ where, data }: any) => { const old = state.rows.get(id(where.userId, where.kind, where.key)); if (old) Object.assign(old, data) },
  },
}))
vi.mock('../services/distributed-lease.js', () => ({ withDistributedLease: async ({ run }: any) => state.busy ? { acquired: false } : { acquired: true, result: await run() } }))
import { MAX_SPEAKER_PCM, parseSpeakerResult, recordingSpeakers, speakerWav } from '../services/personal-modules/recording-speakers.js'
import { transcript } from '../services/personal-modules/domain.js'
const sentence = { begin_time: 0, end_time: 500, speaker_id: 0, sentence_end: true, text: '你好。' }
const provider = () => ({ output: { sentences: [sentence, { ...sentence, begin_time: 500, end_time: 1000, speaker_id: 1, text: '好的。' }] } })
const input = () => ({ key: 'window', sessionKey: 'session', startAt: '2026-10-25T01:00:00Z', timezone: 'Asia/Shanghai', pcmBase64: Buffer.alloc(32000).toString('base64') })
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  state.rows.clear(); state.busy = false
  state.rows.set(id('alice', 'recording-session', 'session'), { payload: {} })
  vi.stubEnv('DASHSCOPE_API_KEY', 'unit-only-not-a-real-key')
  fetcher = vi.fn(async () => new Response(JSON.stringify(provider()), { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('automatic bounded speaker separation', () => {
  it('wraps mono 16kHz PCM with exact WAV sizes and rejects invalid lengths', () => {
    const wav = speakerWav(Buffer.alloc(32000))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readUInt32LE(40)).toBe(32000)
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
    for (const n of [0, 1, MAX_SPEAKER_PCM + 2]) expect(() => speakerWav(Buffer.alloc(n))).toThrow()
  })
  it('calls documented inline API and caches one result per account/window/audio', async () => {
    const result = await recordingSpeakers('alice', input())
    expect(result).toMatchObject({ speakerStatus: 'done', speakerSentences: [{ speakerId: 0 }, { speakerId: 1 }] })
    const body = JSON.parse(fetcher.mock.calls[0]![1].body)
    expect(body.model).toBe('qwen-audio-3.1-asr-flash')
    expect(body.parameters.speaker_diarization_enabled).toBe(true)
    expect(body.input.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/wav;base64,/)
    expect(await recordingSpeakers('alice', input())).toEqual(result)
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(recordingSpeakers('alice', { ...input(), pcmBase64: Buffer.alloc(32000, 1).toString('base64') })).rejects.toThrow('identity_conflict')
  })
  it('requires session ownership and an undeleted day before any cloud call', async () => {
    await expect(recordingSpeakers('bob', input())).rejects.toThrow('invalid_session')
    state.rows.set(id('alice', 'deleted-day', '2026-10-25'), { payload: {} })
    await expect(recordingSpeakers('alice', input())).rejects.toThrow('invalid_deleted_day')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects malformed/oversized audio and prevents concurrent or rapid paid requests', async () => {
    for (const pcmBase64 of ['https://example.org/audio', 'AA==', Buffer.alloc(MAX_SPEAKER_PCM + 2).toString('base64')])
      await expect(recordingSpeakers('alice', { ...input(), pcmBase64 })).rejects.toThrow('invalid_speaker_audio')
    state.busy = true
    await expect(recordingSpeakers('alice', input())).rejects.toThrow('speakers_busy')
    state.busy = false
    await recordingSpeakers('alice', input())
    await expect(recordingSpeakers('alice', { ...input(), key: 'new-window' })).rejects.toThrow('speakers_busy')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('retains an unavailable marker after timeout/failure instead of blindly rebilling', async () => {
    fetcher.mockRejectedValueOnce(new Error('upstream timeout with private details'))
    expect(await recordingSpeakers('alice', input())).toEqual({ speakerStatus: 'unavailable' })
    expect(await recordingSpeakers('alice', input())).toEqual({ speakerStatus: 'unavailable' })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('does not recreate metadata deleted while the request is in flight', async () => {
    fetcher.mockImplementationOnce(async () => {
      state.rows.set(id('alice', 'deleted-day', '2026-10-25'), { payload: {} })
      state.rows.delete(id('alice', 'recording-diarization', 'window'))
      return new Response(JSON.stringify(provider()))
    })
    await expect(recordingSpeakers('alice', input())).rejects.toThrow('invalid_deleted_day')
    expect(state.rows.has(id('alice', 'recording-diarization', 'window'))).toBe(false)
  })
  it('validates annotations, preserves zero IDs, and round-trips additive transcript fields', () => {
    const result = parseSpeakerResult(provider(), 1000)
    const item = transcript({ ...input(), endAt: '2026-10-25T01:00:01Z', revision: 1, text: '原转写', ...result })
    expect(item.text).toBe('原转写')
    expect(item.speakerSentences?.map(s => s.speakerId)).toEqual([0, 1])
    expect(transcript({ ...item, speakerStatus: undefined, speakerSentences: undefined })).not.toHaveProperty('speakerStatus')
    for (const patch of [{ begin_time: -1 }, { end_time: 1001 }, { speaker_id: '0' }, { speaker_id: -1 }, { sentence_end: false }, { text: '' }])
      expect(() => parseSpeakerResult({ output: { sentences: [{ ...sentence, ...patch }] } }, 1000)).toThrow()
    expect(() => parseSpeakerResult({ output: { text: 'No timestamps' } }, 1000)).toThrow()
    expect(parseSpeakerResult({ output: { sentences: [{ ...sentence, speaker_id: null }] } }, 1000).speakerSentences![0]!.speakerId).toBeNull()
  })
})
