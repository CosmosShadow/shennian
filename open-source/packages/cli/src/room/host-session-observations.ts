// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-host-session-observations.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { isRoomRuntimeAdapter, type RoomRuntimeAdapter } from '@shennian/wire'
import { resolveRoomStateFile } from './runtime-state-path.js'

export type RoomHostSessionLifecycle = 'active' | 'idle' | 'closed'

export type RoomHostSessionObservation = {
  schemaVersion: 1
  observationKey: string
  machineId: string
  runtimeAdapter: RoomRuntimeAdapter
  sourceSessionKey: string
  hostContextHash: string
  workspaceHash: string | null
  workspacePath: string | null
  lifecycleState: RoomHostSessionLifecycle
  registrationEpoch: number
  lastEventName: string
  observedAt: string
  lastSeenAt: string
  lastActiveAt: string | null
  lastIdleAt: string | null
  closedAt: string | null
}

type ObservationFile = {
  schemaVersion: 1
  records: Record<string, RoomHostSessionObservation>
}

export type ObserveRoomHostSessionInput = {
  machineId: string
  runtimeAdapter: RoomRuntimeAdapter
  sourceSessionKey: string
  hostContextHash: string
  workspaceHash?: string | null
  workspacePath?: string | null
  lifecycleState: RoomHostSessionLifecycle
  eventName: string
  now?: Date
}

const HASH = /^[a-f0-9]{64}$/
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/

export class RoomHostSessionObservationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomHostSessionObservationError'
  }
}

export class RoomHostSessionObservationStore {
  readonly filePath: string
  private state: ObservationFile

  constructor(filePath = resolveRoomStateFile('room-host-session-observations.json')) {
    this.filePath = filePath
    this.state = this.load()
  }

  observe(input: ObserveRoomHostSessionInput): RoomHostSessionObservation {
    validateInput(input)
    const observationKey = buildRoomHostSessionObservationKey(input)
    const existing = this.state.records[observationKey]
    const now = (input.now ?? new Date()).toISOString()
    const startsNewEpoch = Boolean(
      existing &&
      input.eventName === 'SessionStart' &&
      (existing.lifecycleState === 'closed' || existing.hostContextHash !== input.hostContextHash),
    )
    const lifecycleState =
      existing?.lifecycleState === 'closed' && input.eventName !== 'SessionStart'
        ? 'closed'
        : input.lifecycleState
    const previousActiveAt = startsNewEpoch ? null : (existing?.lastActiveAt ?? null)
    const previousIdleAt = startsNewEpoch ? null : (existing?.lastIdleAt ?? null)
    const record: RoomHostSessionObservation = {
      schemaVersion: 1,
      observationKey,
      machineId: input.machineId,
      runtimeAdapter: input.runtimeAdapter,
      sourceSessionKey: input.sourceSessionKey,
      hostContextHash: input.hostContextHash,
      workspaceHash: input.workspaceHash ?? existing?.workspaceHash ?? null,
      workspacePath: input.workspacePath ?? existing?.workspacePath ?? null,
      lifecycleState,
      registrationEpoch: existing ? existing.registrationEpoch + (startsNewEpoch ? 1 : 0) : 1,
      lastEventName: input.eventName,
      observedAt: existing?.observedAt ?? now,
      lastSeenAt: now,
      lastActiveAt: lifecycleState === 'active' ? now : previousActiveAt,
      lastIdleAt: lifecycleState === 'idle' ? now : previousIdleAt,
      closedAt: lifecycleState === 'closed' ? (existing?.closedAt ?? now) : null,
    }
    this.state.records[observationKey] = record
    this.persist()
    return clone(record)
  }

  getBySource(input: {
    machineId: string
    runtimeAdapter: RoomRuntimeAdapter
    sourceSessionKey: string
  }): RoomHostSessionObservation | null {
    const record = this.state.records[buildRoomHostSessionObservationKey(input)]
    return record ? clone(record) : null
  }

  list(): RoomHostSessionObservation[] {
    return Object.values(this.state.records)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .map(clone)
  }

  private load(): ObservationFile {
    try {
      const stat = fs.lstatSync(this.filePath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw unsafeStore()
      if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        fs.chmodSync(this.filePath, 0o600)
      return validateFile(JSON.parse(fs.readFileSync(this.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, records: {} }
      if (error instanceof RoomHostSessionObservationError) throw error
      throw new RoomHostSessionObservationError(
        'corrupt_observation_store',
        'Room host Session observations are corrupt.',
      )
    }
  }

  private persist(): void {
    const directory = path.dirname(this.filePath)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
    const temp = `${this.filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
    try {
      fs.writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
      if (process.platform !== 'win32') fs.chmodSync(temp, 0o600)
      if (process.platform === 'win32' && fs.existsSync(this.filePath)) {
        const existing = fs.lstatSync(this.filePath)
        if (!existing.isFile() || existing.isSymbolicLink()) throw unsafeStore()
        fs.unlinkSync(this.filePath)
      }
      renameSyncWithRetry(temp, this.filePath)
      if (process.platform !== 'win32') fs.chmodSync(this.filePath, 0o600)
    } finally {
      try {
        fs.unlinkSync(temp)
      } catch {}
    }
  }
}

export function buildRoomHostSessionObservationKey(input: {
  machineId: string
  runtimeAdapter: RoomRuntimeAdapter
  sourceSessionKey: string
}): string {
  validateMachineId(input.machineId)
  validateAdapter(input.runtimeAdapter)
  validateSourceSessionKey(input.sourceSessionKey)
  return crypto
    .createHash('sha256')
    .update(`${input.machineId}\0${input.runtimeAdapter}\0${input.sourceSessionKey}`, 'utf8')
    .digest('hex')
}

function validateInput(input: ObserveRoomHostSessionInput): void {
  validateMachineId(input.machineId)
  validateAdapter(input.runtimeAdapter)
  validateSourceSessionKey(input.sourceSessionKey)
  if (!HASH.test(input.hostContextHash)) invalid('host_context_hash')
  if (input.workspaceHash != null && !HASH.test(input.workspaceHash)) invalid('workspace_hash')
  if (input.workspacePath != null) validateWorkspacePath(input.workspacePath)
  if (!['active', 'idle', 'closed'].includes(input.lifecycleState)) invalid('lifecycle_state')
  if (!EVENT_NAME.test(input.eventName)) invalid('event_name')
}

function validateMachineId(value: string): void {
  if (!/^[A-Za-z0-9_.:@/-]{1,512}$/.test(value)) invalid('machine_id')
}

function validateAdapter(value: string): asserts value is RoomRuntimeAdapter {
  if (!isRoomRuntimeAdapter(value)) invalid('runtime_adapter')
}

function validateSourceSessionKey(value: string): void {
  if (!value || value.length > 1024 || /[\0\r\n]/.test(value)) invalid('source_session_key')
}

function validateFile(value: unknown): ObservationFile {
  if (!value || typeof value !== 'object' || (value as ObservationFile).schemaVersion !== 1) {
    throw new RoomHostSessionObservationError(
      'corrupt_observation_store',
      'Unsupported observation store.',
    )
  }
  const records = (value as ObservationFile).records
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    throw new RoomHostSessionObservationError(
      'corrupt_observation_store',
      'Invalid observation records.',
    )
  }
  const validated: Record<string, RoomHostSessionObservation> = {}
  for (const [key, record] of Object.entries(records)) {
    validateObservation(record)
    if (key !== record.observationKey || key !== buildRoomHostSessionObservationKey(record)) {
      throw new RoomHostSessionObservationError(
        'corrupt_observation_store',
        'Observation key mismatch.',
      )
    }
    validated[key] = {
      ...record,
      workspacePath: record.workspacePath ?? null,
      lastActiveAt:
        record.lastActiveAt ?? (record.lifecycleState === 'active' ? record.lastSeenAt : null),
      lastIdleAt:
        record.lastIdleAt ?? (record.lifecycleState === 'idle' ? record.lastSeenAt : null),
    }
  }
  return { schemaVersion: 1, records: validated }
}

function validateObservation(record: RoomHostSessionObservation): void {
  if (!record || record.schemaVersion !== 1) invalid('observation')
  validateInput({
    machineId: record.machineId,
    runtimeAdapter: record.runtimeAdapter,
    sourceSessionKey: record.sourceSessionKey,
    hostContextHash: record.hostContextHash,
    workspaceHash: record.workspaceHash,
    workspacePath: record.workspacePath ?? null,
    lifecycleState: record.lifecycleState,
    eventName: record.lastEventName,
  })
  if (!HASH.test(record.observationKey)) invalid('observation_key')
  if (!Number.isInteger(record.registrationEpoch) || record.registrationEpoch < 1)
    invalid('registration_epoch')
  for (const timestamp of [record.observedAt, record.lastSeenAt]) {
    if (!Number.isFinite(Date.parse(timestamp))) invalid('observation_time')
  }
  for (const timestamp of [record.lastActiveAt, record.lastIdleAt]) {
    if (timestamp != null && !Number.isFinite(Date.parse(timestamp))) invalid('transition_time')
  }
  if (record.closedAt != null && !Number.isFinite(Date.parse(record.closedAt))) invalid('closed_at')
  if (record.workspacePath != null) validateWorkspacePath(record.workspacePath)
}

function validateWorkspacePath(value: string): void {
  if (!path.isAbsolute(value) || value.length > 4096 || /[\0\r\n]/.test(value)) {
    invalid('workspace_path')
  }
}

function invalid(field: string): never {
  throw new RoomHostSessionObservationError(`invalid_${field}`, `Invalid ${field}.`)
}

function unsafeStore(): RoomHostSessionObservationError {
  return new RoomHostSessionObservationError(
    'unsafe_observation_store',
    'Room host Session observation store is not a regular file.',
  )
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
