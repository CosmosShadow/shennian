// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-recordings.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getShennianDir } from '../config/index.js'
import { assertPathsSeparate } from '../steward/workspace.js'

const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) throw new Error('recording_invalid_id')
  return value
}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const existingFile = (target: string): Buffer | null => {
  if (!fs.existsSync(target)) return null
  if (fs.lstatSync(target).isSymbolicLink()) return fail('path_forbidden')
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    if (!fs.fstatSync(fd).isFile()) return fail('path_forbidden')
    return fs.readFileSync(fd)
  } finally { fs.closeSync(fd) }
}
const fail = (code: string): never => { throw new Error(`recording_${code}`) }
const configPath = () => path.join(getShennianDir(), 'personal-recordings.json')
let processDirectory: string | null = null
const rootPath = () => {
  if (process.env.SHENNIAN_RECORDINGS_DIR) return process.env.SHENNIAN_RECORDINGS_DIR
  if (processDirectory) return processDirectory
  try {
    const value = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as { directory?: unknown }
    if (typeof value.directory !== 'string' || !path.isAbsolute(value.directory)) return fail('directory_invalid')
    processDirectory = value.directory
    return processDirectory
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { processDirectory = path.join(os.homedir(), 'shennian_recordings'); return processDirectory }
    throw error
  }
}
export function recordingDirectory(): string { return root() }
export function configureRecordingDirectory(directory: string): string {
  if (process.env.SHENNIAN_RECORDINGS_DIR) return fail('directory_env_override')
  if (!path.isAbsolute(directory) || /[\u0000-\u001f]/.test(directory)) return fail('directory_invalid')
  const configured = path.resolve(directory)
  assertPathsSeparate(configured, getShennianDir())
  const prior = process.env.SHENNIAN_RECORDINGS_DIR
  try {
    process.env.SHENNIAN_RECORDINGS_DIR = configured
    root() // Validate parents, symlinks, privacy boundary and create directory.
  } finally {
    if (prior === undefined) delete process.env.SHENNIAN_RECORDINGS_DIR
    else process.env.SHENNIAN_RECORDINGS_DIR = prior
  }
  fs.mkdirSync(getShennianDir(), { recursive: true, mode: 0o700 })
  const tmp = `${configPath()}.${randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, JSON.stringify({ directory: configured }), { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, configPath()) }
  finally { try { fs.unlinkSync(tmp) } catch { /* renamed */ } }
  return configured
}
function root(): string {
  const selected = rootPath()
  if (!path.isAbsolute(selected)) return fail('directory_invalid')
  const configured = path.resolve(selected)
  assertPathsSeparate(configured, getShennianDir())
  let cursor = configured
  while (true) {
    try { if (fs.lstatSync(cursor).isSymbolicLink()) return fail('path_forbidden') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const next = path.dirname(cursor)
    if (next === cursor) break
    cursor = next
  }
  fs.mkdirSync(configured, { recursive: true, mode: 0o700 })
  const real = fs.realpathSync(configured)
  const stat = fs.statSync(real)
  if (!stat.isDirectory()) return fail('directory_invalid')
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return fail('directory_owner')
    if (stat.mode & 0o077) fs.chmodSync(real, 0o700)
  }
  assertPathsSeparate(real, fs.existsSync(getShennianDir()) ? fs.realpathSync(getShennianDir()) : getShennianDir())
  return real
}
function safeDir(parts: string[]): string {
  let dir = root()
  for (const part of parts) {
    dir = path.join(dir, id(part))
    let stat: fs.Stats | null = null
    try { stat = fs.lstatSync(dir) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (stat?.isSymbolicLink()) return fail('path_forbidden')
    if (!stat) fs.mkdirSync(dir, { mode: 0o700 })
    const actual = fs.lstatSync(dir)
    if (!actual.isDirectory()) return fail('path_forbidden')
    if (process.platform !== 'win32') {
      if (typeof process.getuid === 'function' && actual.uid !== process.getuid()) return fail('directory_owner')
      if (actual.mode & 0o077) fs.chmodSync(dir, 0o700)
    }
  }
  return dir
}
function durableWrite(dir: string, name: string, data: Buffer): void {
  const tmp = path.join(dir, `${randomUUID()}.tmp`)
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600)
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, path.join(dir, name))
    // fsync the directory so acknowledgement means durable rename on supported systems.
    if (process.platform !== 'win32') {
      const dfd = fs.openSync(dir, 'r')
      try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) }
    }
  } finally { try { fs.unlinkSync(tmp) } catch { /* renamed */ } }
}
export type RecordingRequest = {
  action: 'chunk' | 'commit'
  userId: string
  sessionKey: string
  batchKey: string
  initialMachineId: string
  initialPrimaryRevision: number
  confirmedPrimaryRevision: number | null
  index?: number
  base64?: string
  size?: number
  sha256?: string
  chunks?: Array<{ size: number; sha256: string }>
  transcript?: unknown[]
  startedAt?: string
  endedAt?: string
}
export function receivePersonalRecording(raw: RecordingRequest): { persisted: true; complete: boolean } {
  try {
    if (!raw || !['chunk', 'commit'].includes(raw.action) || typeof raw.initialMachineId !== 'string' || !/^[\w-]{1,100}$/.test(raw.initialMachineId) || !Number.isSafeInteger(raw.initialPrimaryRevision) || raw.initialPrimaryRevision < 0 || !(raw.confirmedPrimaryRevision === null || Number.isSafeInteger(raw.confirmedPrimaryRevision) && raw.confirmedPrimaryRevision >= 0)) return fail('invalid_request')
    const dir = safeDir([raw.userId, raw.sessionKey, raw.batchKey])
    const completed = path.join(dir, 'manifest.json')
    if (raw.action === 'chunk') {
      if (!Number.isInteger(raw.index) || raw.index! < 0 || raw.index! >= 400 || typeof raw.base64 !== 'string' || raw.base64.length > 180000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw.base64) || !Number.isInteger(raw.size) || raw.size! < 1 || raw.size! > 128000 || !/^[a-f0-9]{64}$/.test(raw.sha256 ?? '')) return fail('invalid_chunk')
      const bytes = Buffer.from(raw.base64, 'base64')
      if (bytes.length !== raw.size || sha(bytes) !== raw.sha256) return fail('chunk_mismatch')
      const name = `${raw.index}.chunk`, target = path.join(dir, name)
      const existing = existingFile(target)
      if (existing) {
        if (!existing.equals(bytes)) return fail('chunk_conflict')
      } else {
        const committed = existingFile(completed)
        if (committed) {
          const previous = JSON.parse(committed.toString('utf8')) as { chunks: Array<{ size: number; sha256: string }>; initialMachineId: string; initialPrimaryRevision: number; audioSize: number; audioSha256: string }
          const storedAudio = existingFile(path.join(dir, 'audio.pcm'))
          if (previous.initialMachineId !== raw.initialMachineId || previous.initialPrimaryRevision !== raw.initialPrimaryRevision || previous.chunks[raw.index!]?.size !== raw.size || previous.chunks[raw.index!]?.sha256 !== raw.sha256 || !storedAudio || storedAudio.length !== previous.audioSize || sha(storedAudio) !== previous.audioSha256) return fail('chunk_conflict')
          return { persisted: true, complete: true }
        }
        durableWrite(dir, name, bytes)
      }
      return { persisted: true, complete: fs.existsSync(completed) }
    }
    if (!Array.isArray(raw.chunks) || raw.chunks.length < 1 || raw.chunks.length > 400 || !Array.isArray(raw.transcript) || raw.transcript.length > 1000 || JSON.stringify(raw.transcript).length > 200000 || typeof raw.startedAt !== 'string' || typeof raw.endedAt !== 'string') return fail('invalid_request')
    if (raw.chunks.some(x => !Number.isInteger(x.size) || x.size < 1 || x.size > 128000 || !/^[a-f0-9]{64}$/.test(x.sha256))) return fail('invalid_request')
    const transcript = raw.transcript
    if (transcript.some(x => !x || typeof x !== 'object' || typeof (x as { text?: unknown }).text !== 'string')) return fail('invalid_request')
    const buffers: Buffer[] = []
    for (let i = 0; i < raw.chunks.length; i++) {
      const bytes = existingFile(path.join(dir, `${i}.chunk`))
      if (bytes) buffers.push(bytes)
      else if (!fs.existsSync(completed)) return fail('missing_chunk')
    }
    const audio = buffers.length === raw.chunks.length ? Buffer.concat(buffers) : null
    const manifest = { sessionKey: raw.sessionKey, batchKey: raw.batchKey, initialMachineId: raw.initialMachineId, initialPrimaryRevision: raw.initialPrimaryRevision, startedAt: raw.startedAt, endedAt: raw.endedAt, audioFormat: { encoding: 'pcm16le', sampleRate: 16000, channels: 1 }, chunks: raw.chunks, audioSize: audio?.length ?? raw.chunks.reduce((n, x) => n + x.size, 0), audioSha256: audio ? sha(audio) : null, transcript }
    const serialized = JSON.stringify(manifest)
    const prior = existingFile(completed)
    if (prior) {
      const old = JSON.parse(prior.toString('utf8')) as typeof manifest
      const storedAudio = existingFile(path.join(dir, 'audio.pcm'))
      if (old.sessionKey !== manifest.sessionKey || old.batchKey !== manifest.batchKey || old.initialMachineId !== manifest.initialMachineId || old.initialPrimaryRevision !== manifest.initialPrimaryRevision || old.startedAt !== manifest.startedAt || old.endedAt !== manifest.endedAt || JSON.stringify(old.chunks) !== JSON.stringify(manifest.chunks) || JSON.stringify(old.transcript) !== JSON.stringify(manifest.transcript) || !storedAudio || storedAudio.length !== old.audioSize || sha(storedAudio) !== old.audioSha256) return fail('batch_conflict')
      return { persisted: true, complete: true }
    }
    for (let i = 0; i < raw.chunks.length; i++) {
      const target = path.join(dir, `${i}.chunk`)
      const bytes = existingFile(target)
      if (!bytes) return fail('missing_chunk')
      if (bytes.length !== raw.chunks[i]!.size || sha(bytes) !== raw.chunks[i]!.sha256) return fail('chunk_mismatch')
    }
    if (!audio) return fail('missing_chunk')
    durableWrite(dir, 'audio.pcm', audio)
    durableWrite(dir, 'manifest.json', Buffer.from(serialized))
    for (let i = 0; i < raw.chunks.length; i++) fs.unlinkSync(path.join(dir, `${i}.chunk`))
    return { persisted: true, complete: true }
  } catch (error) {
    if (['ENOSPC', 'EDQUOT'].includes((error as NodeJS.ErrnoException).code ?? '')) return fail('storage_full')
    throw error
  }
}
