// @covers src/session/native-cleanup-outbox.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionDeletionCommand } from '@shennian/wire'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
import { NativeSessionCleanupOutbox } from '../session/native-cleanup-outbox.js'

const installation = 'daemon-installation-test'
const command: SessionDeletionCommand = {
  sessionId: 'session-1',
  deletionRevision: 7,
  deletedAt: '2026-09-02T12:00:00.000Z',
  workDir: process.cwd(),
  nativeCleanupPolicy: 'auto',
  sources: [
    { agentType: 'codex', sourceSessionKey: '00000000-0000-4000-8000-000000000001' },
    { agentType: 'opencode', sourceSessionKey: 'ses_unit_00000000' },
  ],
}

describe('native session cleanup outbox', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-native-cleanup-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('durably deduplicates jobs and does not enqueue policy none', () => {
    const outbox = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: installation,
      sourceGuard: () => true,
    })
    expect(outbox.enqueue({ ...command, nativeCleanupPolicy: 'none' })).toEqual([])
    const first = outbox.enqueue(command)
    const second = outbox.enqueue(command)
    expect(first).toHaveLength(2)
    expect(second.map((job) => job.jobId)).toEqual(first.map((job) => job.jobId))
    expect(outbox.listJobs()).toHaveLength(2)
    expect(outbox.listJobs()[0].workDir).toBe(process.cwd())
  })

  it('processes one Provider at a time and records terminal archive/delete results', async () => {
    let active = 0
    let maxActive = 0
    const execute = vi.fn(async (agentType: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      return agentType === 'codex'
        ? ({ outcome: 'archived' } as const)
        : ({ outcome: 'deleted' } as const)
    })
    const outbox = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: installation,
      lifecycle: { execute: execute as never },
      sourceGuard: () => true,
    })
    outbox.enqueue(command)
    await outbox.drain()

    expect(maxActive).toBe(1)
    expect(new Set(outbox.listJobs().map((job) => job.state))).toEqual(new Set([
      'succeeded_archived',
      'succeeded_deleted',
    ]))
  })

  it('recovers a running job after restart and converges without duplicating it', async () => {
    const first = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: installation,
      sourceGuard: () => true,
    })
    const [job] = first.enqueue({ ...command, sources: [command.sources[0]] })
    const filePath = path.join(root, 'native-session-cleanup-outbox.json')
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      jobs: Record<string, { state: string }>
    }
    persisted.jobs[job.jobId].state = 'running'
    fs.writeFileSync(filePath, `${JSON.stringify(persisted)}\n`)

    const execute = vi.fn(async () => ({ outcome: 'already_absent' as const }))
    const restarted = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: installation,
      lifecycle: { execute },
      sourceGuard: () => true,
    })
    expect(restarted.listJobs()[0].state).toBe('pending')
    await restarted.drain()
    expect(restarted.listJobs()).toHaveLength(1)
    expect(restarted.listJobs()[0].state).toBe('succeeded_already_absent')
  })

  it('retries transient failures with bounded backoff and then succeeds', async () => {
    let now = new Date('2026-09-02T12:00:00.000Z')
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'transient', errorCode: 'native_busy' })
      .mockResolvedValueOnce({ outcome: 'deleted' })
    const outbox = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: installation,
      lifecycle: { execute },
      sourceGuard: () => true,
      now: () => now,
      retryBaseMs: 1_000,
    })
    outbox.enqueue({ ...command, sources: [command.sources[1]] })
    await outbox.drain()
    expect(outbox.listJobs()[0]).toMatchObject({
      state: 'retry_wait',
      attempts: 1,
      lastErrorCode: 'native_busy',
    })
    now = new Date(now.getTime() + 1_000)
    await outbox.drain()
    expect(outbox.listJobs()[0]).toMatchObject({ state: 'succeeded_deleted', attempts: 2 })
  })

  it('turns an identity mismatch and exhausted retry into explicit terminal states', async () => {
    const invalid = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: installation,
      lifecycle: { execute: vi.fn() },
      sourceGuard: () => false,
    })
    invalid.enqueue({ ...command, sources: [command.sources[0]] })
    await invalid.drain()
    expect(invalid.listJobs()[0].state).toBe('skipped_invalid_identity')

    const retryRoot = path.join(root, 'retry')
    const exhausted = new NativeSessionCleanupOutbox({
      rootDir: retryRoot,
      daemonInstallationId: installation,
      lifecycle: {
        execute: vi.fn(async () => ({
          outcome: 'transient' as const,
          errorCode: 'command_timeout',
        })),
      },
      sourceGuard: () => true,
      maxAttempts: 1,
    })
    exhausted.enqueue({ ...command, sources: [command.sources[1]] })
    await exhausted.drain()
    expect(exhausted.listJobs()[0]).toMatchObject({
      state: 'failed_permanent',
      lastErrorCode: 'command_timeout',
    })
  })

  it('requires the local source tombstone to match the exact deletion revision', async () => {
    new NativeSourceDeletionStore({
      rootDir: root,
      daemonInstallationId: installation,
    }).record({
      sessionId: command.sessionId,
      agentType: command.sources[0].agentType,
      sourceSessionKey: command.sources[0].sourceSessionKey,
      deletionRevision: command.deletionRevision + 1,
    })
    const execute = vi.fn(async () => ({ outcome: 'archived' as const }))
    const outbox = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: installation,
      lifecycle: { execute },
    })
    outbox.enqueue({ ...command, sources: [command.sources[0]] })

    await outbox.drain()

    expect(execute).not.toHaveBeenCalled()
    expect(outbox.listJobs()[0].state).toBe('skipped_invalid_identity')
  })

  it('rejects another installation namespace and never logs the native source ID', async () => {
    const logs: Array<Record<string, string | number>> = []
    const outbox = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: installation,
      lifecycle: { execute: vi.fn(async () => ({ outcome: 'unsupported' as const })) },
      sourceGuard: () => true,
      logger: (_message, metadata) => logs.push(metadata),
    })
    outbox.enqueue({ ...command, sources: [command.sources[0]] })
    await outbox.drain()
    expect(JSON.stringify(logs)).not.toContain(command.sources[0].sourceSessionKey)

    const other = new NativeSessionCleanupOutbox({
      rootDir: root,
      daemonInstallationId: 'different-installation',
    })
    expect(() => other.listJobs()).toThrow('invalid native cleanup outbox')
  })

  it('fails enqueue before acknowledgement when the durable path cannot be committed', () => {
    const blockedRoot = path.join(root, 'not-a-directory')
    fs.writeFileSync(blockedRoot, 'occupied')
    const outbox = new NativeSessionCleanupOutbox({
      rootDir: blockedRoot,
      daemonInstallationId: installation,
      sourceGuard: () => true,
    })
    expect(() => outbox.enqueue(command)).toThrow()
  })
})
