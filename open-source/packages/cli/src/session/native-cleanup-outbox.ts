// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-cleanup-outbox.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import type { AgentType, SessionDeletionCommand } from '@shennian/wire'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
import {
  NativeSessionLifecycleRegistry,
  type NativeLifecycleResult,
} from './native-session-lifecycle.js'

const SCHEMA_VERSION = 1 as const
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_DRAIN_INTERVAL_MS = 60_000
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1_000

export type NativeCleanupTerminalState =
  | 'succeeded_archived'
  | 'succeeded_deleted'
  | 'succeeded_already_absent'
  | 'skipped_unsupported'
  | 'skipped_invalid_identity'
  | 'failed_permanent'

export type NativeCleanupJobState =
  | 'pending'
  | 'running'
  | 'retry_wait'
  | NativeCleanupTerminalState

export type NativeSessionCleanupJob = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  jobId: string
  sessionId: string
  deletionRevision: number
  agentType: AgentType
  sourceSessionKey: string
  workDir?: string
  codexHome?: string
  requestedAt: string
  state: NativeCleanupJobState
  attempts: number
  nextAttemptAt?: string
  lastErrorCode?: string
  completedAt?: string
}

type OutboxFile = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  jobs: Record<string, NativeSessionCleanupJob>
}

type SourceGuard = (input: {
  sessionId: string
  deletionRevision: number
  agentType: AgentType
  sourceSessionKey: string
}) => boolean

type OutboxOptions = {
  rootDir?: string
  daemonInstallationId?: string
  lifecycle?: Pick<NativeSessionLifecycleRegistry, 'execute'>
  sourceGuard?: SourceGuard
  now?: () => Date
  maxAttempts?: number
  drainIntervalMs?: number
  retryBaseMs?: number
  logger?: (message: string, metadata: Record<string, string | number>) => void
}

const TERMINAL_STATES = new Set<NativeCleanupJobState>([
  'succeeded_archived',
  'succeeded_deleted',
  'succeeded_already_absent',
  'skipped_unsupported',
  'skipped_invalid_identity',
  'failed_permanent',
])

export class NativeSessionCleanupOutbox {
  private lifecycle: Pick<NativeSessionLifecycleRegistry, 'execute'>
  private timer: ReturnType<typeof setInterval> | null = null
  private drainPromise: Promise<void> | null = null

  constructor(private options: OutboxOptions = {}) {
    this.lifecycle = options.lifecycle ?? new NativeSessionLifecycleRegistry()
  }

  start(): void {
    if (this.timer) return
    void this.drain()
    this.timer = setInterval(
      () => void this.drain(),
      this.options.drainIntervalMs ?? DEFAULT_DRAIN_INTERVAL_MS,
    )
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  enqueue(deletion: SessionDeletionCommand, codexHome?: string | null): NativeSessionCleanupJob[] {
    if ((deletion.nativeCleanupPolicy ?? 'none') !== 'auto') return []
    const file = this.read(true)
    const created: NativeSessionCleanupJob[] = []
    for (const source of deletion.sources) {
      const jobId = this.jobId(deletion, source.agentType, source.sourceSessionKey)
      const existing = file.jobs[jobId]
      if (existing) {
        created.push(existing)
        continue
      }
      const job: NativeSessionCleanupJob = {
        schemaVersion: SCHEMA_VERSION,
        daemonInstallationId: this.installationId(),
        jobId,
        sessionId: deletion.sessionId,
        deletionRevision: deletion.deletionRevision,
        agentType: source.agentType,
        sourceSessionKey: source.sourceSessionKey,
        ...(deletion.workDir ? { workDir: deletion.workDir } : {}),
        ...(source.agentType === 'codex' && codexHome ? { codexHome } : {}),
        requestedAt: deletion.deletedAt,
        state: 'pending',
        attempts: 0,
      }
      file.jobs[jobId] = job
      created.push(job)
    }
    if (created.some((job) => job.state === 'pending')) this.write(file)
    return created
  }

  kick(): void {
    void this.drain()
  }

  async drain(): Promise<void> {
    if (this.drainPromise) return await this.drainPromise
    this.drainPromise = this.drainOnce().finally(() => {
      this.drainPromise = null
    })
    return await this.drainPromise
  }

  listJobs(): NativeSessionCleanupJob[] {
    return Object.values(this.read(true).jobs).sort((left, right) =>
      left.deletionRevision - right.deletionRevision || left.jobId.localeCompare(right.jobId),
    )
  }

  private async drainOnce(): Promise<void> {
    // One global worker is an intentional upper bound. It also guarantees that
    // every Provider is serialized without a second lock hierarchy.
    while (true) {
      const file = this.read(true)
      const now = this.now()
      const job = Object.values(file.jobs)
        .filter((candidate) =>
          candidate.state === 'pending' ||
          (candidate.state === 'retry_wait' &&
            (!candidate.nextAttemptAt || Date.parse(candidate.nextAttemptAt) <= now.getTime())),
        )
        .sort((left, right) =>
          left.deletionRevision - right.deletionRevision || left.jobId.localeCompare(right.jobId),
        )[0]
      if (!job) return

      job.state = 'running'
      job.attempts += 1
      delete job.nextAttemptAt
      this.write(file)

      let result: NativeLifecycleResult
      if (!this.sourceGuard(job)) {
        result = { outcome: 'invalid_identity' }
      } else {
        try {
          result = await this.lifecycle.execute(job.agentType, job.sourceSessionKey, {
            workDir: job.workDir,
            ...(job.codexHome ? { codexHome: job.codexHome } : {}),
          })
        } catch {
          result = { outcome: 'transient', errorCode: 'lifecycle_unexpected_failure' }
        }
      }
      this.applyResult(job.jobId, result)
    }
  }

  private applyResult(jobId: string, result: NativeLifecycleResult): void {
    const file = this.read(false)
    const job = file.jobs[jobId]
    if (!job || TERMINAL_STATES.has(job.state)) return
    const completedAt = this.now().toISOString()
    switch (result.outcome) {
      case 'archived':
        job.state = 'succeeded_archived'
        break
      case 'deleted':
        job.state = 'succeeded_deleted'
        break
      case 'already_absent':
        job.state = 'succeeded_already_absent'
        break
      case 'unsupported':
        job.state = 'skipped_unsupported'
        break
      case 'invalid_identity':
        job.state = 'skipped_invalid_identity'
        break
      case 'permanent':
        job.state = 'failed_permanent'
        job.lastErrorCode = result.errorCode
        break
      case 'transient': {
        job.lastErrorCode = result.errorCode
        if (job.attempts >= (this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
          job.state = 'failed_permanent'
          break
        }
        job.state = 'retry_wait'
        const delay = Math.min(
          (this.options.retryBaseMs ?? 5_000) * 2 ** Math.max(0, job.attempts - 1),
          MAX_BACKOFF_MS,
        )
        job.nextAttemptAt = new Date(this.now().getTime() + delay).toISOString()
        delete job.completedAt
        this.write(file)
        this.log(job, result.errorCode)
        return
      }
    }
    job.completedAt = completedAt
    delete job.nextAttemptAt
    this.write(file)
    this.log(job, job.lastErrorCode ?? result.outcome)
  }

  private sourceGuard(job: NativeSessionCleanupJob): boolean {
    if (this.options.sourceGuard) return this.options.sourceGuard(job)
    const deletion = new NativeSourceDeletionStore({
      rootDir: this.rootDir(),
      daemonInstallationId: this.installationId(),
    }).find(job.agentType, job.sourceSessionKey)
    return Boolean(
      deletion &&
        deletion.sessionId === job.sessionId &&
        deletion.deletionRevision === job.deletionRevision,
    )
  }

  private log(job: NativeSessionCleanupJob, result: string): void {
    this.options.logger?.('[native-cleanup] job state changed', {
      job: job.jobId.slice(0, 12),
      provider: job.agentType,
      state: job.state,
      result,
      attempts: job.attempts,
    })
  }

  private read(recoverRunning: boolean): OutboxFile {
    const filePath = this.filePath()
    if (!fs.existsSync(filePath)) return this.emptyFile()
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OutboxFile
    if (
      parsed.schemaVersion !== SCHEMA_VERSION ||
      parsed.daemonInstallationId !== this.installationId() ||
      !parsed.jobs ||
      typeof parsed.jobs !== 'object' ||
      Array.isArray(parsed.jobs)
    ) {
      throw new Error('invalid native cleanup outbox')
    }
    let recovered = false
    for (const [key, job] of Object.entries(parsed.jobs)) {
      if (
        key !== job.jobId ||
        job.schemaVersion !== SCHEMA_VERSION ||
        job.daemonInstallationId !== this.installationId() ||
        !job.sessionId ||
        !job.agentType ||
        !job.sourceSessionKey ||
        !Number.isSafeInteger(job.deletionRevision) ||
        job.deletionRevision < 1 ||
        !Number.isSafeInteger(job.attempts) ||
        job.attempts < 0 ||
        (!TERMINAL_STATES.has(job.state) &&
          job.state !== 'pending' &&
          job.state !== 'running' &&
          job.state !== 'retry_wait')
      ) {
        throw new Error('invalid native cleanup job')
      }
      if (recoverRunning && job.state === 'running') {
        job.state = 'pending'
        recovered = true
      }
    }
    if (recovered) this.write(parsed)
    return parsed
  }

  private write(file: OutboxFile): void {
    atomicWriteJson(this.filePath(), file)
  }

  private emptyFile(): OutboxFile {
    return {
      schemaVersion: SCHEMA_VERSION,
      daemonInstallationId: this.installationId(),
      jobs: {},
    }
  }

  private jobId(
    deletion: SessionDeletionCommand,
    agentType: AgentType,
    sourceSessionKey: string,
  ): string {
    return crypto
      .createHash('sha256')
      .update(
        `${this.installationId()}\0${deletion.deletionRevision}\0${agentType}\0${sourceSessionKey}`,
      )
      .digest('hex')
  }

  private installationId(): string {
    return this.options.daemonInstallationId ?? getDaemonInstallationId()
  }

  private rootDir(): string {
    return this.options.rootDir ?? resolvePersonalSyncV1Path()
  }

  private filePath(): string {
    return path.join(this.rootDir(), 'native-session-cleanup-outbox.json')
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }
}

function atomicWriteJson(file: string, value: unknown): void {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    renameSyncWithRetry(temp, file)
    if (process.platform !== 'win32') {
      const directoryDescriptor = fs.openSync(directory, 'r')
      try {
        fs.fsyncSync(directoryDescriptor)
      } finally {
        fs.closeSync(directoryDescriptor)
      }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try {
      fs.unlinkSync(temp)
    } catch {}
  }
}
