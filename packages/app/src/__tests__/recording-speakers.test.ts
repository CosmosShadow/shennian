// @covers src/features/personal-modules/recordingSpeakers.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ account: 'alice', api: vi.fn(), detach: vi.fn(), listener: null as null | ((state: { user: { id: string } }) => void) }))
vi.mock('../config/api', () => ({ authApi: state.api }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => ({ user: { id: state.account } }), subscribe: (listener: (value: { user: { id: string } }) => void) => { state.listener = listener; return state.detach } } }))
vi.mock('../features/personal-modules/audioArchive', () => ({ encode: (pcm: Uint8Array) => Buffer.from(pcm).toString('base64') }))
import { enrichRecordingSpeakers } from '../features/personal-modules/recordingSpeakers'
import type { PersonalModuleStore } from '../features/personal-modules/localStore'
import type { RecognitionJob, RecognitionStorage } from '../features/personal-modules/durableRecognition'
const job: RecognitionJob = { key: 'window', sessionKey: 'session', startAt: 1, size: 32000, sealed: true, separateSpeakers: true }
const item = { key: 'window', sessionKey: 'session', revision: 1, startAt: '2026-10-25T01:00:00Z', endAt: '2026-10-25T01:00:01Z', text: '原文', day: '2026-10-25', timezone: 'Asia/Shanghai' }
const store = { userId: 'alice' } as PersonalModuleStore
const read = vi.fn(async () => new Uint8Array(32000)), deleted = vi.fn(async () => false)
const storage = { read, deleted } as unknown as RecognitionStorage
beforeEach(() => { vi.clearAllMocks(); state.account = 'alice'; deleted.mockResolvedValue(false); read.mockResolvedValue(new Uint8Array(32000)) })
afterEach(() => vi.restoreAllMocks())
describe('recording window enrichment', () => {
  it('uploads only opted-in, sealed windows and retains original transcription', async () => {
    state.api.mockResolvedValue({ speakerStatus: 'done', speakerSentences: [{ beginMs: 0, endMs: 1000, speakerId: 0, text: '分人转写' }] })
    expect(await enrichRecordingSpeakers(store, storage, job, item)).toMatchObject({ ...item, speakerStatus: 'done' })
    const request = JSON.parse(state.api.mock.calls[0]![1].body)
    expect(request).toMatchObject({ key: 'window', sessionKey: 'session', startAt: item.startAt })
    expect(Buffer.from(request.pcmBase64, 'base64').length).toBe(32000)
  })
  it('never uploads historical non-opted-in, wrong-account, or deleted audio', async () => {
    expect(await enrichRecordingSpeakers(store, storage, { ...job, separateSpeakers: false }, item)).toEqual(item)
    state.account = 'bob'
    expect(await enrichRecordingSpeakers(store, storage, job, item)).toEqual(item)
    state.account = 'alice'; deleted.mockResolvedValue(true)
    expect(await enrichRecordingSpeakers(store, storage, job, item)).toEqual(item)
    expect(state.api).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
  it('rechecks account and deletion after reading, and marks unsupported upstream results unavailable', async () => {
    read.mockImplementationOnce(async () => { state.account = 'bob'; return new Uint8Array(32000) })
    expect(await enrichRecordingSpeakers(store, storage, job, item)).toEqual(item)
    expect(state.api).not.toHaveBeenCalled()
    state.account = 'alice'; state.api.mockResolvedValue({ speakerStatus: 'unavailable' })
    expect(await enrichRecordingSpeakers(store, storage, job, item)).toEqual({ ...item, speakerStatus: 'unavailable' })
  })
  it('does not upload unsealed, oversized, or truncated files', async () => {
    await enrichRecordingSpeakers(store, storage, { ...job, sealed: false }, item)
    await enrichRecordingSpeakers(store, storage, { ...job, size: 65 * 32000 + 2 }, item)
    read.mockResolvedValueOnce(new Uint8Array(2))
    await expect(enrichRecordingSpeakers(store, storage, job, item)).rejects.toThrow('recording_local_file_missing')
    expect(state.api).not.toHaveBeenCalled()
  })
})

it('aborts audio upload on account change and releases the auth subscription', async () => {
  state.api.mockImplementationOnce(async (_path, request) => {
    state.account = 'bob'
    state.listener!({ user: { id: 'bob' } })
    expect(request.signal.aborted).toBe(true)
    throw new Error('aborted')
  })
  await expect(enrichRecordingSpeakers(store, storage, job, item)).rejects.toThrow('aborted')
  expect(state.detach).toHaveBeenCalledOnce()
})
