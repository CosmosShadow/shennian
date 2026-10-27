// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-source-deletions.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'

const SCHEMA_VERSION = 1 as const

export type LocalNativeSourceDeletion = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  deletionRevision: number
  sessionId: string
  agentType: string
  sourceSessionKey: string
  sourceSessionKeyHash: string
  deletedAt: string
}

export type LocalSessionDeletion = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  deletionRevision: number
  sessionId: string
  deletedAt: string
}

type DeletionFile = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  deletions: Record<string, LocalNativeSourceDeletion>
  sessions: Record<string, LocalSessionDeletion>
}

export class NativeSourceDeletionStore {
  constructor(private options: { rootDir?: string; daemonInstallationId?: string } = {}) {}

  record(input: {
    sessionId: string
    agentType: string
    sourceSessionKey: string
    deletionRevision: number
    deletedAt?: string
  }): LocalNativeSourceDeletion {
    validateInput(input)
    const sessionDeletion = this.recordSession(input)
    const file = this.read()
    const key = this.key(input.agentType, input.sourceSessionKey)
    const existing = file.deletions[key]
    if (existing && existing.sessionId !== input.sessionId) {
      throw new Error('native source deletion identity conflict')
    }
    if (existing && existing.deletionRevision >= input.deletionRevision) return existing
    const deletion: LocalNativeSourceDeletion = {
      schemaVersion: SCHEMA_VERSION,
      daemonInstallationId: this.installationId(),
      deletionRevision: Math.max(input.deletionRevision, sessionDeletion.deletionRevision),
      sessionId: input.sessionId,
      agentType: input.agentType,
      sourceSessionKey: input.sourceSessionKey,
      sourceSessionKeyHash: hashSource(input.agentType, input.sourceSessionKey),
      deletedAt: input.deletedAt ?? new Date().toISOString(),
    }
    file.deletions[key] = deletion
    atomicWriteJson(this.filePath(), file)
    return deletion
  }

  recordSession(input: {
    sessionId: string
    deletionRevision: number
    deletedAt?: string
  }): LocalSessionDeletion {
    if (!input.sessionId || !Number.isSafeInteger(input.deletionRevision) || input.deletionRevision < 1) {
      throw new Error('invalid local session deletion')
    }
    const file = this.read()
    const existing = file.sessions[input.sessionId]
    if (existing && existing.deletionRevision >= input.deletionRevision) return existing
    const deletion: LocalSessionDeletion = {
      schemaVersion: SCHEMA_VERSION,
      daemonInstallationId: this.installationId(),
      sessionId: input.sessionId,
      deletionRevision: input.deletionRevision,
      deletedAt: input.deletedAt ?? new Date().toISOString(),
    }
    file.sessions[input.sessionId] = deletion
    atomicWriteJson(this.filePath(), file)
    return deletion
  }

  hasSession(sessionId: string): boolean {
    return Boolean(sessionId && this.read().sessions[sessionId])
  }

  find(agentType: string, sourceSessionKey: string): LocalNativeSourceDeletion | null {
    if (!agentType || !sourceSessionKey) return null
    return this.read().deletions[this.key(agentType, sourceSessionKey)] ?? null
  }

  has(agentType: string, sourceSessionKey: string): boolean {
    return this.find(agentType, sourceSessionKey) !== null
  }

  list(): LocalNativeSourceDeletion[] {
    return Object.values(this.read().deletions)
      .sort((left, right) => left.deletionRevision - right.deletionRevision)
  }

  private read(): DeletionFile {
    const daemonInstallationId = this.installationId()
    const file = this.filePath()
    if (!fs.existsSync(file)) {
      return { schemaVersion: SCHEMA_VERSION, daemonInstallationId, deletions: {}, sessions: {} }
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as DeletionFile
    if (
      parsed.schemaVersion !== SCHEMA_VERSION
      || parsed.daemonInstallationId !== daemonInstallationId
      || !parsed.deletions
      || typeof parsed.deletions !== 'object'
      || Array.isArray(parsed.deletions)
    ) throw new Error('invalid native source deletion store')
    parsed.sessions ??= {}
    for (const deletion of Object.values(parsed.deletions)) {
      if (
        deletion.schemaVersion !== SCHEMA_VERSION
        || deletion.daemonInstallationId !== daemonInstallationId
        || !deletion.sessionId
        || !deletion.agentType
        || !deletion.sourceSessionKey
        || deletion.sourceSessionKeyHash !== hashSource(deletion.agentType, deletion.sourceSessionKey)
        || !Number.isSafeInteger(deletion.deletionRevision)
        || deletion.deletionRevision < 1
      ) throw new Error('invalid native source deletion record')
    }
    for (const deletion of Object.values(parsed.sessions)) {
      if (
        deletion.schemaVersion !== SCHEMA_VERSION
        || deletion.daemonInstallationId !== daemonInstallationId
        || !deletion.sessionId
        || !Number.isSafeInteger(deletion.deletionRevision)
        || deletion.deletionRevision < 1
      ) throw new Error('invalid local session deletion record')
    }
    return parsed
  }

  private installationId(): string {
    return this.options.daemonInstallationId ?? getDaemonInstallationId()
  }

  private filePath(): string {
    return path.join(this.options.rootDir ?? resolvePersonalSyncV1Path(), 'native-source-deletions.json')
  }

  private key(agentType: string, sourceSessionKey: string): string {
    return crypto.createHash('sha256')
      .update(`${this.installationId()}\0${agentType}\0${sourceSessionKey}`)
      .digest('hex')
  }
}

export function hashSource(agentType: string, sourceSessionKey: string): string {
  return crypto.createHash('sha256').update(`${agentType}\0${sourceSessionKey}`).digest('hex')
}

function validateInput(input: {
  sessionId: string
  agentType: string
  sourceSessionKey: string
  deletionRevision: number
}): void {
  if (!input.sessionId || !input.agentType || !input.sourceSessionKey) {
    throw new Error('invalid native source deletion identity')
  }
  if (!Number.isSafeInteger(input.deletionRevision) || input.deletionRevision < 1) {
    throw new Error('invalid native source deletion revision')
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
      try { fs.fsyncSync(directoryDescriptor) } finally { fs.closeSync(directoryDescriptor) }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { fs.unlinkSync(temp) } catch {}
  }
}
