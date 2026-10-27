// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
import * as FileSystem from 'expo-file-system/legacy'
import * as Crypto from 'expo-crypto'
import { authApi } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { primaryMachineClient } from '../personal-workspace/client'
import type { AudioBatch, PersonalModuleStore } from './localStore'

const CHUNK_BYTES = 96000 // 3 seconds of 16 kHz mono PCM16; below relay payload cap.
const FIVE_MINUTES = 300000
const safeId = (value: string) => { if (!/^[\w-]{1,100}$/.test(value)) throw new Error('recording_invalid_id'); return value }
const base = (userId: string, sessionKey: string) => {
  if (!FileSystem.documentDirectory) throw new Error('recording_storage_unavailable')
  return `${FileSystem.documentDirectory}personal-recordings/${safeId(userId)}/${safeId(sessionKey)}/`
}
const file = (userId: string, batch: AudioBatch | { key: string; sessionKey: string }) => `${base(userId, batch.sessionKey)}${safeId(batch.key)}.pcm`
export function encode(bytes: Uint8Array): string {
  const btoaImpl = (globalThis as typeof globalThis & { btoa?: (v: string) => string }).btoa
  if (btoaImpl) {
    let raw = ''
    for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]!)
    return btoaImpl(raw)
  }
  const buffer = (globalThis as typeof globalThis & { Buffer?: { from: (v: Uint8Array) => { toString: (encoding: string) => string } } }).Buffer
  if (buffer) return buffer.from(bytes).toString('base64')
  throw new Error('recording_base64_unavailable')
}
export function decode(value: string): Uint8Array {
  const atobImpl = (globalThis as typeof globalThis & { atob?: (v: string) => string }).atob
  if (atobImpl) {
    const raw = atobImpl(value), bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return bytes
  }
  const buffer = (globalThis as typeof globalThis & { Buffer?: { from: (v: string, encoding: string) => Uint8Array } }).Buffer
  if (buffer) return new Uint8Array(buffer.from(value, 'base64'))
  throw new Error('recording_base64_unavailable')
}
const hash = async (base64: string) => {
  const bytes = decode(base64)
  const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes)))
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export type Target = { machineId: string; revision: number }
export async function currentRecordingTarget(): Promise<Target | null> {
  const result = await primaryMachineClient.get()
  return result.machine ? { machineId: safeId(result.machine.id), revision: result.revision } : null
}
export async function startAudioBatch(store: PersonalModuleStore, sessionKey: string, target: Target, key: string, startAt: string) {
  await FileSystem.makeDirectoryAsync(base(store.userId, sessionKey), { intermediates: true })
  await store.beginAudioBatch({ key, sessionKey, machineId: target.machineId, targetRevision: target.revision, startAt })
  return { key, sessionKey, startAt, bytes: 0 }
}
export async function appendAudio(store: PersonalModuleStore, batch: { key: string; sessionKey: string; bytes: number }, frames: Uint8Array[]) {
  const size = frames.reduce((n, f) => n + f.byteLength, 0)
  const combined = new Uint8Array(size)
  let pos = 0
  for (const frame of frames) { combined.set(frame, pos); pos += frame.byteLength }
  // SDK 55 legacy WritingOptions.append is a native append on both iOS and Android;
  // base64 decodes to PCM bytes before writing (not a 5-minute JS memory buffer).
  await FileSystem.writeAsStringAsync(file(store.userId, batch), encode(combined), { encoding: FileSystem.EncodingType.Base64, append: batch.bytes > 0 })
  batch.bytes += size
}
export async function finishAudioBatch(store: PersonalModuleStore, batch: { key: string; sessionKey: string; bytes: number }, endAt: string) {
  if (batch.bytes > 0) await store.finishAudioBatch(batch.key, endAt, batch.bytes)
  else await store.removeEmptyAudioBatch(batch.key)
}
export async function recoverAudioBatches(store: PersonalModuleStore) {
  for (const batch of await store.audioBatches()) {
    if (batch.endAt) continue
    const info = await FileSystem.getInfoAsync(file(store.userId, batch))
    if (info.exists && 'size' in info && info.size > 0) await store.finishAudioBatch(batch.key, new Date().toISOString(), info.size)
    else await store.removeEmptyAudioBatch(batch.key)
  }
}
export async function syncAudioBatches(store: PersonalModuleStore, current: Target | null): Promise<'ok' | 'target_changed'> {
  let changed = false
  for (const batch of await store.audioBatches()) {
    if (!batch.endAt || batch.synced) continue
    if (batch.failed) throw new Error('recording_local_save_failed')
    // ASR finals can arrive after the microphone segment ends. Do not freeze an empty
    // transcript into the immutable receiver manifest immediately at the boundary.
    if (Date.now() - Date.parse(batch.endAt) < 75000) continue
    if (useAuthStore.getState().user?.id !== store.userId) return changed ? 'target_changed' : 'ok'
    if (!current || (current.machineId !== batch.machineId || current.revision !== batch.targetRevision) && batch.confirmedRevision !== current.revision) { changed = true; continue }
    // A delayed transcript must not be frozen out of the immutable manifest.
    if (await store.hasPendingRecognition(batch.sessionKey, batch.startAt, batch.endAt)) continue
    const uri = file(store.userId, batch)
    const info = await FileSystem.getInfoAsync(uri)
    if (!info.exists || !('size' in info) || info.size !== batch.size) throw new Error('recording_local_file_missing')
    const chunks: Array<{ size: number; sha256: string }> = []
    for (let index = 0, offset = 0; offset < batch.size; index++, offset += CHUNK_BYTES) {
      if (useAuthStore.getState().user?.id !== store.userId) return changed ? 'target_changed' : 'ok'
      const size = Math.min(CHUNK_BYTES, batch.size - offset)
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: offset, length: size })
      const sha256 = await hash(base64)
      const result = await authApi<{ persisted: boolean }>(`/personal-recordings/machines/${batch.machineId}`, { method: 'POST', body: JSON.stringify({ action: 'chunk', sessionKey: batch.sessionKey, batchKey: batch.key, initialMachineId: batch.machineId, initialPrimaryRevision: batch.targetRevision, confirmedPrimaryRevision: batch.confirmedRevision, index, size, sha256, base64 }) }, { timeoutMs: 25000 })
      if (!result.persisted) throw new Error('recording_ack_invalid')
      chunks.push({ size, sha256 })
    }
    if (useAuthStore.getState().user?.id !== store.userId) return changed ? 'target_changed' : 'ok'
    const latestTarget = await currentRecordingTarget()
    if (useAuthStore.getState().user?.id !== store.userId) return changed ? 'target_changed' : 'ok'
    if (!latestTarget || (latestTarget.machineId !== batch.machineId || latestTarget.revision !== batch.targetRevision) && batch.confirmedRevision !== latestTarget.revision) { changed = true; continue }
    const transcript = await store.transcriptsForBatch(batch.sessionKey, batch.startAt, batch.endAt)
    const result = await authApi<{ persisted: boolean; complete: boolean }>(`/personal-recordings/machines/${batch.machineId}`, { method: 'POST', body: JSON.stringify({ action: 'commit', sessionKey: batch.sessionKey, batchKey: batch.key, initialMachineId: batch.machineId, initialPrimaryRevision: batch.targetRevision, confirmedPrimaryRevision: batch.confirmedRevision, chunks, transcript, startedAt: batch.startAt, endedAt: batch.endAt }) }, { timeoutMs: 25000 })
    if (!result.persisted || !result.complete) throw new Error('recording_ack_invalid')
    await store.markAudioSynced(batch.key)
  }
  return changed ? 'target_changed' : 'ok'
}
export const audioBatchMs = FIVE_MINUTES
