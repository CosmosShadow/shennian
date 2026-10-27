// @covers src/personal-workspace/recordings.ts
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureRecordingDirectory, receivePersonalRecording } from '../personal-workspace/recordings.js'
let root: string
const previous = { home: process.env.SHENNIAN_HOME, recordings: process.env.SHENNIAN_RECORDINGS_DIR }
const digest = (b64: string) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')
beforeEach(() => {
  const unit = path.join(os.tmpdir(), 'shennian-tests/unit')
  fs.mkdirSync(unit, { recursive: true })
  root = fs.realpathSync(fs.mkdtempSync(path.join(unit, 'personal-recordings-')))
  process.env.SHENNIAN_HOME = path.join(root, 'credentials')
  process.env.SHENNIAN_RECORDINGS_DIR = path.join(root, 'recordings')
})
afterEach(() => {
  if (previous.home === undefined) delete process.env.SHENNIAN_HOME; else process.env.SHENNIAN_HOME = previous.home
  if (previous.recordings === undefined) delete process.env.SHENNIAN_RECORDINGS_DIR; else process.env.SHENNIAN_RECORDINGS_DIR = previous.recordings
  fs.rmSync(root, { recursive: true, force: true })
})
const chunk = (raw: string) => { const base64 = Buffer.from(raw).toString('base64'); return { action: 'chunk' as const, userId: 'alice', sessionKey: 'session-1', batchKey: 'batch-1', initialMachineId: 'main', initialPrimaryRevision: 3, confirmedPrimaryRevision: null, index: 0, base64, size: Buffer.byteLength(raw), sha256: digest(base64) } }
describe('personal recording durable receiver', () => {
  it('verifies chunk hash/size, replay identity, assembles original audio and transcript', () => {
    const c = chunk('original audio')
    expect(() => receivePersonalRecording({ ...c, size: c.size + 1 })).toThrow('recording_chunk_mismatch')
    expect(() => receivePersonalRecording({ ...c, sha256: '0'.repeat(64) })).toThrow('recording_chunk_mismatch')
    expect(receivePersonalRecording(c)).toEqual({ persisted: true, complete: false })
    expect(receivePersonalRecording(c)).toEqual({ persisted: true, complete: false })
    expect(() => receivePersonalRecording({ ...c, initialMachineId: '' })).toThrow('recording_invalid_request')
    expect(() => receivePersonalRecording({ ...c, base64: Buffer.from('other').toString('base64'), size: 5, sha256: digest(Buffer.from('other').toString('base64')) })).toThrow('recording_chunk_conflict')
    const commit = { action: 'commit' as const, userId: c.userId, sessionKey: c.sessionKey, batchKey: c.batchKey, initialMachineId: c.initialMachineId, initialPrimaryRevision: c.initialPrimaryRevision, confirmedPrimaryRevision: null, chunks: [{ size: c.size, sha256: c.sha256 }], transcript: [{ text: '原始转写', revision: 1 }], startedAt: '2026-10-23T00:00:00Z', endedAt: '2026-10-23T00:05:00Z' }
    expect(receivePersonalRecording(commit)).toEqual({ persisted: true, complete: true })
    expect(receivePersonalRecording(commit)).toEqual({ persisted: true, complete: true })
    expect(() => receivePersonalRecording({ ...commit, transcript: [{ text: 'different' }] })).toThrow('recording_batch_conflict')
    expect(() => receivePersonalRecording({ ...commit, initialPrimaryRevision: 4 })).toThrow('recording_batch_conflict')
    expect(() => receivePersonalRecording({ ...c, initialMachineId: 'other' })).toThrow('recording_chunk_conflict')
    expect(receivePersonalRecording(c)).toEqual({ persisted: true, complete: true })
    const dir = path.join(root, 'recordings/alice/session-1/batch-1')
    expect(fs.existsSync(path.join(dir, '0.chunk'))).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'audio.pcm'), 'utf8')).toBe('original audio')
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).transcript).toEqual(commit.transcript)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))).toMatchObject({ initialMachineId: 'main', initialPrimaryRevision: 3 })
    expect(() => receivePersonalRecording({ ...commit, chunks: [{ size: c.size, sha256: '0'.repeat(64) }] })).toThrow('recording_batch_conflict')
    fs.unlinkSync(path.join(dir, 'audio.pcm'))
    expect(() => receivePersonalRecording(commit)).toThrow('recording_batch_conflict')
    expect(() => receivePersonalRecording(c)).toThrow('recording_chunk_conflict')
  })
  it('isolates account/session and refuses path traversal or symbolic links', () => {
    expect(() => receivePersonalRecording({ ...chunk('x'), batchKey: '../escape' })).toThrow('recording_invalid_id')
    receivePersonalRecording(chunk('x'))
    const link = path.join(root, 'recordings/alice/linked')
    fs.symlinkSync(path.join(root, 'credentials'), link)
    expect(() => receivePersonalRecording({ ...chunk('y'), sessionKey: 'linked' })).toThrow('recording_path_forbidden')
    expect(() => receivePersonalRecording({ ...chunk('y'), userId: 'bob', action: 'commit', chunks: [{ size: 1, sha256: digest(Buffer.from('y').toString('base64')) }], transcript: [{ text: '' }], startedAt: '', endedAt: '' })).toThrow('recording_missing_chunk')
  })
  it('configures a private directory outside credentials without following symlinks', () => {
    delete process.env.SHENNIAN_RECORDINGS_DIR
    expect(() => configureRecordingDirectory(path.join(root, 'credentials/inside'))).toThrow()
    const link = path.join(root, 'link')
    fs.symlinkSync(path.join(root, 'elsewhere'), link)
    expect(() => configureRecordingDirectory(path.join(link, 'recordings'))).toThrow('recording_path_forbidden')
    const selected = path.join(root, 'selected')
    expect(configureRecordingDirectory(selected)).toBe(selected)
    expect(JSON.parse(fs.readFileSync(path.join(root, 'credentials/personal-recordings.json'), 'utf8'))).toEqual({ directory: selected })
  })
})
