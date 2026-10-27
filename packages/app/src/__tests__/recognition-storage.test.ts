// @covers src/features/personal-modules/recognitionStorage.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecognitionJob } from '../features/personal-modules/durableRecognition'
const memory = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), failDelete: false }))
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'unit-memory://documents/', EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: vi.fn(async () => {}),
  writeAsStringAsync: vi.fn(async (path: string, data: string, options: { append?: boolean }) => {
    const before = options.append ? memory.files.get(path) ?? new Uint8Array() : new Uint8Array()
    memory.files.set(path, new Uint8Array([...before, ...Buffer.from(data, 'base64')]))
  }),
  readAsStringAsync: vi.fn(async (path: string, options: { position: number; length: number }) => Buffer.from(memory.files.get(path)!.slice(options.position, options.position + options.length)).toString('base64')),
  getInfoAsync: vi.fn(async (path: string) => memory.files.has(path) ? { exists: true, size: memory.files.get(path)!.length } : { exists: false }),
  deleteAsync: vi.fn(async (path: string) => { if (memory.failDelete) throw new Error('cleanup failed'); memory.files.delete(path) }),
}))
vi.mock('expo-crypto', () => ({}))
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => ({}) } }))
vi.mock('../features/personal-workspace/client', () => ({ primaryMachineClient: {} }))
import { recognitionStorage } from '../features/personal-modules/recognitionStorage'
import type { PersonalModuleStore } from '../features/personal-modules/localStore'
function setup() {
  const docs = new Map<string, RecognitionJob>(), saveTranscript = vi.fn(async (_transcript: unknown, key: string) => { docs.delete(key) })
  const store = {
    userId: 'alice', values: async () => [...docs.values()].map(job => ({ ...job })),
    saveValue: async (_kind: string, key: string, job: RecognitionJob) => { docs.set(key, { ...job }) },
    removeValue: async (_kind: string, key: string) => { docs.delete(key) }, saveTranscript,
    isDayDeleted: vi.fn(async () => false),
  } as unknown as PersonalModuleStore
  return { storage: recognitionStorage(store), docs, saveTranscript }
}
const job = (): RecognitionJob => ({ key: 'unit-key', sessionKey: 'unit-session', startAt: Date.parse('2026-10-24T00:00:00Z'), size: 0, sealed: false })
beforeEach(() => { memory.files.clear(); memory.failDelete = false })
describe('native ASR disk journal adapter', () => {
  it('appends PCM bytes and recovers the real unsealed size rather than stale metadata', async () => {
    const test = setup(), item = job()
    await test.storage.create(item)
    await test.storage.append(item, new Uint8Array([1, 2, 3, 4]))
    item.size = 4
    await test.storage.append(item, new Uint8Array([5, 6]))
    const recovered = await test.storage.recover()
    expect(recovered).toEqual([{ ...item, sealed: true, size: 6 }])
    expect(await test.storage.read(recovered[0]!, 2, 4)).toEqual(new Uint8Array([3, 4, 5, 6]))
  })
  it('commits transcript before cleanup; failed commit keeps the job and all bytes', async () => {
    const test = setup(), item = job()
    await test.storage.create(item)
    await test.storage.append(item, new Uint8Array([1, 2]))
    test.saveTranscript.mockRejectedValueOnce(new Error('storage full'))
    const transcript = { key: item.key, sessionKey: item.sessionKey, revision: 1, text: 'fixture', startAt: '2026-10-24T00:00:00Z', endAt: '2026-10-24T00:00:01Z', day: '2026-10-24', timezone: 'UTC' }
    await expect(test.storage.complete(item, transcript)).rejects.toThrow('storage full')
    expect(test.docs.size).toBe(1)
    expect(memory.files.size).toBe(1)
    memory.failDelete = true
    await test.storage.complete(item, transcript)
    expect(test.docs.size).toBe(0)
    expect(test.saveTranscript).toHaveBeenLastCalledWith(transcript, item.key)
  })
  it('reports missing acknowledged-size files without deleting their metadata', async () => {
    const test = setup(), item = { ...job(), size: 1280, sealed: true }
    await test.storage.create(item)
    await expect(test.storage.recover()).rejects.toThrow('recording_local_file_missing')
    expect(test.docs.size).toBe(1)
  })
})
