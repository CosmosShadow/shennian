// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/deletion-sync-state.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { recordPersonalSyncLocalMetric } from '../personal-sync/metrics.js'

type DeletionSyncState = {
  schemaVersion: 1
  daemonInstallationId: string
  lastAppliedRevision: number
  updatedAt: string
  retryAttempts?: number
  nextAttemptAt?: string | null
  terminalCode?: string | null
}

const LEGACY_RECOVERABLE_TERMINAL_CODES = new Set([
  'transport_unavailable',
  'temporary_unavailable',
  'invalid_deletion_sync_response',
  'unstructured_rejection',
  'deletion_sync_failed',
])

export class DeletionSyncTerminalError extends Error {
  readonly retryable = false
  constructor(readonly code: string) {
    super(`session deletion sync stopped: ${code}`)
    this.name = 'DeletionSyncTerminalError'
  }
}

export class DeletionSyncRetryWaitError extends Error {
  readonly retryable = true
  constructor(readonly retryAfterMs: number) {
    super(`session deletion sync retry delayed by ${retryAfterMs}ms`)
    this.name = 'DeletionSyncRetryWaitError'
  }
}

export function readDeletionSyncRevision(): number {
  return readState().lastAppliedRevision
}

function readState(): DeletionSyncState {
  const file = stateFile()
  if (!fs.existsSync(file)) return {
    schemaVersion: 1,
    daemonInstallationId: getDaemonInstallationId(),
    lastAppliedRevision: 0,
    updatedAt: new Date(0).toISOString(),
  }
  const state = JSON.parse(fs.readFileSync(file, 'utf8')) as DeletionSyncState
  if (
    state.schemaVersion !== 1
    || state.daemonInstallationId !== getDaemonInstallationId()
    || !Number.isSafeInteger(state.lastAppliedRevision)
    || state.lastAppliedRevision < 0
  ) throw new Error('invalid deletion sync state')
  return state
}

export function writeDeletionSyncRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid deletion sync revision')
  const current = readDeletionSyncRevision()
  if (revision < current) throw new Error('deletion sync revision cannot move backwards')
  if (revision === current) return
  atomicWriteJson(stateFile(), {
    ...readState(),
    lastAppliedRevision: revision,
    updatedAt: new Date().toISOString(),
  } satisfies DeletionSyncState)
}

export function assertDeletionSyncRunnable(now = Date.now()): void {
  const state = readState()
  if (state.terminalCode) {
    // Releases before 0.4.26 could persist transient transport or malformed
    // responses as terminal forever. Recover those legacy latches in place;
    // explicit authoritative rejections still remain durable stops.
    if (LEGACY_RECOVERABLE_TERMINAL_CODES.has(state.terminalCode)) {
      atomicWriteJson(stateFile(), {
        ...state,
        retryAttempts: 0,
        nextAttemptAt: null,
        terminalCode: null,
        updatedAt: new Date(now).toISOString(),
      } satisfies DeletionSyncState)
      return
    } else {
      throw new DeletionSyncTerminalError(state.terminalCode)
    }
  }
  if (state.nextAttemptAt) {
    const remaining = Date.parse(state.nextAttemptAt) - now
    if (remaining > 0) throw new DeletionSyncRetryWaitError(remaining)
  }
}

export function recordDeletionSyncFailure(input: {
  code: string
  retryable: boolean
  now?: number
  maxAttempts?: number
}): void {
  const state = readState()
  const attempts = Math.min((state.retryAttempts ?? 0) + 1, input.maxAttempts ?? 8)
  const now = input.now ?? Date.now()
  if (!input.retryable) {
    atomicWriteJson(stateFile(), {
      ...state, retryAttempts: attempts, nextAttemptAt: null,
      terminalCode: input.code, updatedAt: new Date(now).toISOString(),
    } satisfies DeletionSyncState)
    recordPersonalSyncLocalMetric('permanentStops')
    throw new DeletionSyncTerminalError(input.code)
  }
  // Retryable failures never become a permanent latch. The attempt count caps
  // exponential growth, while the six-hour delay cap prevents a hot loop.
  const delay = Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1_000)
  const jitter = Math.round(delay * 0.2 * (Math.random() * 2 - 1))
  const retryAfterMs = delay + jitter
  atomicWriteJson(stateFile(), {
    ...state, retryAttempts: attempts, terminalCode: null,
    nextAttemptAt: new Date(now + retryAfterMs).toISOString(),
    updatedAt: new Date(now).toISOString(),
  } satisfies DeletionSyncState)
  recordPersonalSyncLocalMetric('transientRetries')
  throw new DeletionSyncRetryWaitError(retryAfterMs)
}

export function clearDeletionSyncFailure(): void {
  const state = readState()
  if (!state.retryAttempts && !state.nextAttemptAt && !state.terminalCode) return
  atomicWriteJson(stateFile(), {
    ...state, retryAttempts: 0, nextAttemptAt: null, terminalCode: null,
    updatedAt: new Date().toISOString(),
  } satisfies DeletionSyncState)
}

function stateFile(): string {
  return resolvePersonalSyncV1Path('deletion-sync-state.json')
}

function atomicWriteJson(file: string, value: unknown): void {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  let fd: number | undefined
  try {
    fd = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    renameSyncWithRetry(temp, file)
    if (process.platform !== 'win32') {
      const directoryFd = fs.openSync(directory, 'r')
      try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(temp) } catch {}
  }
}
