// @covers src/session/deletion-sync-state.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'deletion-sync-state-'))
  vi.stubEnv('SHENNIAN_HOME', home)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(home, { recursive: true, force: true })
})

describe('deletion sync retry state', () => {
  it('persists bounded transient retry and recovers after success', async () => {
    const state = await import('../session/deletion-sync-state.js')
    expect(() => state.recordDeletionSyncFailure({
      code: 'temporary_unavailable', retryable: true, now: 1_000,
    })).toThrow(state.DeletionSyncRetryWaitError)
    expect(() => state.assertDeletionSyncRunnable(1_001)).toThrow(state.DeletionSyncRetryWaitError)
    state.clearDeletionSyncFailure()
    expect(() => state.assertDeletionSyncRunnable(1_001)).not.toThrow()
  })

  it('persists a permanent terminal state and never schedules it again', async () => {
    const state = await import('../session/deletion-sync-state.js')
    expect(() => state.recordDeletionSyncFailure({
      code: 'ownership_transferred', retryable: false,
    })).toThrow(state.DeletionSyncTerminalError)
    vi.resetModules()
    const reloaded = await import('../session/deletion-sync-state.js')
    expect(() => reloaded.assertDeletionSyncRunnable()).toThrow('ownership_transferred')
  })

  it('caps transient backoff without turning it into a permanent latch', async () => {
    const state = await import('../session/deletion-sync-state.js')
    expect(() => state.recordDeletionSyncFailure({
      code: 'temporary_unavailable', retryable: true, maxAttempts: 1,
    })).toThrow(state.DeletionSyncRetryWaitError)
    expect(() => state.assertDeletionSyncRunnable()).toThrow(state.DeletionSyncRetryWaitError)
  })

  it('self-heals legacy transient terminal latches but preserves authority stops', async () => {
    const state = await import('../session/deletion-sync-state.js')
    expect(() => state.recordDeletionSyncFailure({
      code: 'invalid_deletion_sync_response', retryable: false, now: 1_000,
    })).toThrow(state.DeletionSyncTerminalError)

    expect(() => state.assertDeletionSyncRunnable(2_000)).not.toThrow()
    expect(() => state.assertDeletionSyncRunnable(2_001)).not.toThrow()
  })
})
