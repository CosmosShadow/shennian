// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/run-recovery-journal.test.ts

import fs from 'node:fs'
import { renameSyncWithRetry } from '../../fs/atomic-rename.js'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { resolveShennianPath } from '../../config/index.js'
import {
  RUN_JOURNAL_SCHEMA_VERSION,
  isRecoverableJournalPhase,
  parseRunJournalRecord,
  type RunJournalRecord,
} from './schema.js'

type JournalInput = Omit<
  RunJournalRecord,
  'schemaVersion' | 'lastObservedEventSeq' | 'phase' | 'upgradeJobId' | 'interruptionReason'
    | 'continueDispatchState' | 'recoveryAttempts' | 'createdAt' | 'updatedAt'
    | 'recoveryReason' | 'deliveryMode' | 'externalRunId'
>

export type RunJournalLoadResult = {
  records: RunJournalRecord[]
  quarantined: string[]
}

function safeRecordName(sessionId: string, runId: string): string {
  return createHash('sha256').update(`${sessionId}\0${runId}`).digest('hex') + '.json'
}

function assertSafeExistingFile(filePath: string): void {
  try {
    const stat = fs.lstatSync(filePath)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('journal target is not a regular file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function fsyncDirectory(directory: string): void {
  if (process.platform === 'win32') return
  const fd = fs.openSync(directory, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

function ensurePrivateDirectory(directory: string): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    try {
      const stat = fs.lstatSync(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('journal directory is unsafe')
      if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || attempt === 2) throw error
    }
  }
}

export class ActiveRunJournal {
  readonly directory: string
  readonly quarantineDirectory: string

  constructor(
    readonly daemonInstallationId: string,
    options: { directory?: string } = {},
  ) {
    this.directory = options.directory ?? resolveShennianPath('runtime', 'run-recovery', 'active')
    this.quarantineDirectory = path.join(path.dirname(this.directory), 'quarantine')
    ensurePrivateDirectory(this.directory)
    ensurePrivateDirectory(this.quarantineDirectory)
  }

  begin(input: JournalInput): RunJournalRecord {
    const now = new Date().toISOString()
    const record: RunJournalRecord = {
      ...input,
      schemaVersion: RUN_JOURNAL_SCHEMA_VERSION,
      lastObservedEventSeq: -1,
      phase: 'dispatching',
      upgradeJobId: null,
      interruptionReason: null,
      continueDispatchState: 'none',
      deliveryMode: 'direct',
      externalRunId: null,
      recoveryAttempts: 0,
      recoveryReason: null,
      createdAt: now,
      updatedAt: now,
    }
    this.write(record)
    return record
  }

  update(
    sessionId: string,
    runId: string,
    patch: Partial<Omit<RunJournalRecord, 'schemaVersion' | 'daemonInstallationId' | 'sessionId' | 'runId' | 'createdAt'>>,
  ): RunJournalRecord | null {
    const current = this.get(sessionId, runId)
    if (!current) return null
    const next = parseRunJournalRecord({ ...current, ...patch, updatedAt: new Date().toISOString() })
    this.write(next)
    return next
  }

  get(sessionId: string, runId: string): RunJournalRecord | null {
    const filePath = this.recordPath(sessionId, runId)
    try {
      assertSafeExistingFile(filePath)
      const parsed = parseRunJournalRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')))
      if (parsed.sessionId !== sessionId || parsed.runId !== runId) throw new Error('journal identity mismatch')
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      this.quarantine(filePath)
      return null
    }
  }

  loadRecoverable(): RunJournalLoadResult {
    return this.load((record) => isRecoverableJournalPhase(record.phase))
  }

  /** Records that still require either provider recovery or terminal cleanup. */
  loadPendingReconciliation(): RunJournalLoadResult {
    return this.load((record) =>
      isRecoverableJournalPhase(record.phase) ||
      record.phase === 'interrupted_by_upgrade' ||
      record.phase === 'recovery_failed' ||
      record.phase === 'aborted',
    )
  }

  private load(include: (record: RunJournalRecord) => boolean): RunJournalLoadResult {
    const records: RunJournalRecord[] = []
    const quarantined: string[] = []
    for (const name of fs.readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue
      const filePath = path.join(this.directory, name)
      try {
        assertSafeExistingFile(filePath)
        const record = parseRunJournalRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')))
        if (record.daemonInstallationId !== this.daemonInstallationId) {
          throw new Error('daemon installation identity mismatch')
        }
        if (safeRecordName(record.sessionId, record.runId) !== name) {
          throw new Error('journal filename identity mismatch')
        }
        if (include(record)) records.push(record)
      } catch {
        quarantined.push(this.quarantine(filePath))
      }
    }
    records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return { records, quarantined }
  }

  markPlannedUpgrade(upgradeJobId: string): number {
    const { records } = this.loadRecoverable()
    for (const record of records) {
      this.update(record.sessionId, record.runId, {
        upgradeJobId,
        interruptionReason: 'planned_upgrade',
      })
    }
    fsyncDirectory(this.directory)
    return records.length
  }

  markAborted(sessionId: string, runId: string): void {
    this.update(sessionId, runId, { phase: 'aborted' })
  }

  markSessionAborted(sessionId: string): number {
    const records = this.loadRecoverable().records.filter((record) => record.sessionId === sessionId)
    for (const record of records) this.markAborted(record.sessionId, record.runId)
    this.sync()
    return records.length
  }

  remove(sessionId: string, runId: string): void {
    const filePath = this.recordPath(sessionId, runId)
    assertSafeExistingFile(filePath)
    try { fs.unlinkSync(filePath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    fsyncDirectory(this.directory)
  }

  sync(): void {
    for (const name of fs.readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue
      const filePath = path.join(this.directory, name)
      assertSafeExistingFile(filePath)
      const fd = fs.openSync(filePath, process.platform === 'win32' ? 'r+' : 'r')
      try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    }
    fsyncDirectory(this.directory)
  }

  private recordPath(sessionId: string, runId: string): string {
    return path.join(this.directory, safeRecordName(sessionId, runId))
  }

  private write(record: RunJournalRecord): void {
    if (record.daemonInstallationId !== this.daemonInstallationId) {
      throw new Error('daemon installation identity mismatch')
    }
    const validated = parseRunJournalRecord(record)
    const target = this.recordPath(validated.sessionId, validated.runId)
    assertSafeExistingFile(target)
    const temp = `${target}.tmp-${process.pid}-${randomUUID()}`
    try {
      fs.writeFileSync(temp, `${JSON.stringify(validated, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
      if (process.platform !== 'win32') fs.chmodSync(temp, 0o600)
      const fd = fs.openSync(temp, process.platform === 'win32' ? 'r+' : 'r')
      try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      renameSyncWithRetry(temp, target)
      fsyncDirectory(this.directory)
    } finally {
      try { fs.unlinkSync(temp) } catch {}
    }
  }

  private quarantine(filePath: string): string {
    const target = path.join(
      this.quarantineDirectory,
      `${path.basename(filePath)}.${Date.now()}.${randomUUID()}.invalid`,
    )
    try {
      assertSafeExistingFile(filePath)
      renameSyncWithRetry(filePath, target)
      if (process.platform !== 'win32') fs.chmodSync(target, 0o600)
      fsyncDirectory(this.quarantineDirectory)
      return target
    } catch {
      return filePath
    }
  }
}
