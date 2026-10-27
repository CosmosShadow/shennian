// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-session-registry.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import {
  isRoomRuntimeAdapter,
  type RoomActivationMode,
  type RoomBindingStatus,
  type RoomRuntimeAdapter,
} from '@shennian/wire'
import { resolveRoomStateFile } from './runtime-state-path.js'

export type RoomSessionCapabilities = {
  canIdentifySession: boolean
  canBindAutomatically: boolean
  canOpenEmbeddedRoomPage: boolean
  canResumeIdleSession: boolean
  canActivateWhileHostOpen: boolean
}

export type RoomSessionBindingState = {
  bindingId: string
  roomId: string
  agentIdentityId: string
  agentMembershipId: string | null
  status: RoomBindingStatus
  activationMode: RoomActivationMode
  lastDeliveredSequence: string
  lastActivatedSequence: string
  /** @deprecated read only for one-time migration into the Session queue. */
  activationQueue: RoomActivationQueueItem[]
  /** @deprecated read only for clearing pre-unified-scheduler state. */
  activeActivation: RoomActivationQueueItem | null
  mentionContext?: RoomMentionContextItem[]
  loopBreaker: {
    claimedMessageIds?: string[]
    windowStartedAt: string | null
    activationCount: number
    pausedUntil: string | null
  }
}

export type RoomMentionContextItem = {
  sequence: string
  deliveryText: string
}

export type RoomActivationQueueItem = {
  causeMessageId: string
  rootCauseMessageId: string
  sequence: string
  hopCount: number
  enqueuedAt: string
  attempts: number
  deliveryText?: string
  /** @deprecated compatibility-read only; new activations keep prompt bodies in daemon memory. */
  systemPrompt?: string
  promptSnapshot?: {
    managedRoomPolicyVersion: string
    sessionModeInstructionsHash: string | null
    agentSystemPromptHash: string | null
    trustedRoomContextHash: string
  }
  dispatchState?: 'dispatching' | 'interrupted'
  dispatchedAt?: string
  interruptedAt?: string
}

export type RoomSessionRegistration = {
  schemaVersion: 1
  registryKey: string
  machineId: string
  runtimeAdapter: RoomRuntimeAdapter
  sourceSessionKey: string
  nianSessionId: string
  panelContextKey: string
  hostProcessIdentity: string
  registrationEpoch: number
  lifecycleState: 'active' | 'inactive' | 'closed'
  capabilities: RoomSessionCapabilities
  binding: RoomSessionBindingState | null
  registeredAt: string
  lastSeenAt: string
  updatedAt: string
}

type RegistryFile = {
  schemaVersion: 1
  records: Record<string, RoomSessionRegistration>
}

type RegisterInput = {
  machineId: string
  runtimeAdapter: RoomRuntimeAdapter
  sourceSessionKey: string
  nianSessionId: string
  hostProcessIdentity: string
  capabilities: RoomSessionCapabilities
  now?: Date
}

const MAX_ACTIVATION_QUEUE = 500
const MAX_MENTION_CONTEXT = 20
const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,512}$/
const BINDING_STATUSES = new Set<RoomBindingStatus>([
  'pending_approval',
  'active',
  'paused',
  'detached',
])
const ACTIVATION_MODES = new Set<RoomActivationMode>(['auto_follow', 'mention_only', 'paused'])

export class RoomSessionRegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomSessionRegistryError'
  }
}

export class RoomSessionRegistry {
  readonly filePath: string
  private state: RegistryFile
  private readonly mutexTails = new Map<string, Promise<void>>()

  constructor(
    filePath = resolveRoomStateFile('room-session-registry.json'),
    now = new Date(),
  ) {
    this.filePath = filePath
    this.state = this.load()
    if (this.markPersistedActivationsInterrupted(now)) this.persist()
  }

  register(input: RegisterInput): RoomSessionRegistration {
    validateSafeId(input.machineId, 'machine_id')
    validateAdapter(input.runtimeAdapter)
    validateSourceSessionKey(input.sourceSessionKey)
    validateSafeId(input.nianSessionId, 'nian_session_id')
    validateSafeId(input.hostProcessIdentity, 'host_process_identity')
    validateCapabilities(input.capabilities)
    const registryKey = buildRoomSessionRegistryKey(input)
    const now = (input.now ?? new Date()).toISOString()
    const existing = this.state.records[registryKey]
    if (existing?.lifecycleState === 'closed') {
      throw new RoomSessionRegistryError('session_registration_closed', 'A retired session cannot be registered again.')
    }

    const nianConflict = Object.values(this.state.records).find(
      (record) =>
        record.registryKey !== registryKey &&
        record.nianSessionId === input.nianSessionId &&
        record.lifecycleState !== 'closed',
    )
    if (nianConflict) {
      throw new RoomSessionRegistryError(
        'nian_session_already_registered',
        'This Shennian session is already registered to another native Agent session.',
      )
    }

    const processChanged = Boolean(
      existing && existing.hostProcessIdentity !== input.hostProcessIdentity,
    )
    const record: RoomSessionRegistration = {
      schemaVersion: 1,
      registryKey,
      machineId: input.machineId,
      runtimeAdapter: input.runtimeAdapter,
      sourceSessionKey: input.sourceSessionKey,
      nianSessionId: input.nianSessionId,
      panelContextKey: input.nianSessionId,
      hostProcessIdentity: input.hostProcessIdentity,
      registrationEpoch: existing ? existing.registrationEpoch + (processChanged ? 1 : 0) : 1,
      lifecycleState: 'active',
      capabilities: { ...input.capabilities },
      binding: existing?.binding ?? null,
      registeredAt: existing?.registeredAt ?? now,
      lastSeenAt: now,
      updatedAt: now,
    }
    this.state.records[registryKey] = record
    this.persist()
    return clone(record)
  }

  getBySource(
    input: Pick<RegisterInput, 'machineId' | 'runtimeAdapter' | 'sourceSessionKey'>,
  ): RoomSessionRegistration | null {
    const record = this.state.records[buildRoomSessionRegistryKey(input)]
    return record ? clone(record) : null
  }

  getByNianSessionId(nianSessionId: string): RoomSessionRegistration | null {
    validateSafeId(nianSessionId, 'nian_session_id')
    const record = Object.values(this.state.records).find(
      (candidate) =>
        candidate.nianSessionId === nianSessionId && candidate.lifecycleState !== 'closed',
    )
    return record ? clone(record) : null
  }

  getByRegistryKey(registryKey: string): RoomSessionRegistration | null {
    if (!/^[a-f0-9]{64}$/.test(registryKey)) {
      throw new RoomSessionRegistryError(
        'invalid_registry_key',
        'Invalid Room session registry key.',
      )
    }
    const record = this.state.records[registryKey]
    return record ? clone(record) : null
  }

  list(): RoomSessionRegistration[] {
    return Object.values(this.state.records)
      .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt))
      .map(clone)
  }

  setBinding(input: {
    registryKey: string
    bindingId: string
    roomId: string
    agentIdentityId: string
    agentMembershipId: string | null
    status: RoomBindingStatus
    activationMode?: RoomActivationMode
    /** Only a successful authoritative bind/restart may replace the owner. */
    replaceOwner?: boolean
    initialSequence?: string
    now?: Date
  }): RoomSessionRegistration {
    const record = this.requireRecord(input.registryKey)
    for (const [field, value] of Object.entries({
      binding_id: input.bindingId,
      room_id: input.roomId,
      agent_identity_id: input.agentIdentityId,
    }))
      validateSafeId(value, field)
    if (!BINDING_STATUSES.has(input.status))
      throw new RoomSessionRegistryError('invalid_binding_status', 'Invalid binding status.')
    if (
      (input.status === 'pending_approval' && input.agentMembershipId !== null) ||
      ((input.status === 'active' || input.status === 'paused') && input.agentMembershipId === null)
    ) {
      throw new RoomSessionRegistryError(
        'invalid_agent_membership_id',
        'Pending Room bindings cannot claim an Agent membership.',
      )
    }
    if (input.agentMembershipId !== null) {
      validateSafeId(input.agentMembershipId, 'agent_membership_id')
    }
    const activationMode = input.activationMode ?? 'auto_follow'
    if (!ACTIVATION_MODES.has(activationMode))
      throw new RoomSessionRegistryError('invalid_activation_mode', 'Invalid activation mode.')
    if (
      record.binding &&
      record.binding.status !== 'detached' &&
      (record.binding.bindingId !== input.bindingId || record.binding.roomId !== input.roomId)
    ) {
      throw new RoomSessionRegistryError(
        'session_already_bound',
        'An Agent session can have only one active Room binding.',
      )
    }
    if (record.lifecycleState === 'closed') {
      throw new RoomSessionRegistryError('session_registration_closed', 'A retired session cannot be rebound.')
    }
    if (input.initialSequence !== undefined) validateSequence(input.initialSequence)
    const conflicts = Object.values(this.state.records).filter((candidate) =>
      candidate.registryKey !== record.registryKey &&
      candidate.lifecycleState !== 'closed' &&
      candidate.binding?.bindingId === input.bindingId &&
      candidate.binding.status !== 'detached',
    )
    if (input.status !== 'detached' && conflicts.length && !input.replaceOwner) {
      throw new RoomSessionRegistryError('binding_already_owned', 'A Room binding can have only one live session.')
    }
    if (input.replaceOwner) {
      // Update both halves in memory before ONE atomic rename. In-flight readers
      // carry the old registration epoch and cannot reactivate these records.
      for (const previous of Object.values(this.state.records)) {
        if (previous.registryKey === record.registryKey || previous.binding?.bindingId !== input.bindingId) continue
        previous.lifecycleState = 'closed'
        previous.registrationEpoch += 1
        previous.binding.status = 'detached'
        previous.binding.activationMode = 'paused'
        previous.binding.activationQueue = []
        previous.binding.activeActivation = null
        previous.binding.mentionContext = []
        previous.updatedAt = (input.now ?? new Date()).toISOString()
      }
    }
    const previousActivationMode = record.binding?.activationMode
    record.binding = {
      bindingId: input.bindingId,
      roomId: input.roomId,
      agentIdentityId: input.agentIdentityId,
      agentMembershipId: input.agentMembershipId,
      status: input.status,
      activationMode,
      lastDeliveredSequence: record.binding?.lastDeliveredSequence ?? input.initialSequence ?? '0',
      lastActivatedSequence: record.binding?.lastActivatedSequence ?? input.initialSequence ?? '0',
      activationQueue: record.binding?.activationQueue ?? [],
      activeActivation: record.binding?.activeActivation ?? null,
      mentionContext:
        previousActivationMode === 'mention_only' && activationMode === 'mention_only'
          ? (record.binding?.mentionContext ?? [])
          : [],
      loopBreaker: record.binding?.loopBreaker ?? {
        windowStartedAt: null,
        activationCount: 0,
        pausedUntil: null,
      },
    }
    this.touchAndPersist(record, input.now)
    return clone(record)
  }

  detachBinding(registryKey: string, now = new Date()): RoomSessionRegistration {
    const record = this.requireRecord(registryKey)
    if (record.binding) {
      record.binding.status = 'detached'
      record.binding.activationMode = 'paused'
      record.binding.activationQueue = []
      record.binding.activeActivation = null
      record.binding.mentionContext = []
    }
    this.touchAndPersist(record, now)
    return clone(record)
  }

  advanceCursor(input: {
    registryKey: string
    cursor: 'delivered' | 'activated'
    sequence: string
    now?: Date
  }): RoomSessionRegistration {
    const record = this.requireBoundRecord(input.registryKey)
    validateSequence(input.sequence)
    const field = input.cursor === 'delivered' ? 'lastDeliveredSequence' : 'lastActivatedSequence'
    if (BigInt(input.sequence) < BigInt(record.binding![field])) {
      throw new RoomSessionRegistryError('cursor_regression', 'Room cursor cannot move backwards.')
    }
    record.binding![field] = input.sequence
    this.touchAndPersist(record, input.now)
    return clone(record)
  }

  enqueueActivation(
    registryKey: string,
    item: RoomActivationQueueItem,
    now = new Date(),
    clearMentionContext = false,
  ): RoomSessionRegistration {
    const record = this.requireBoundRecord(registryKey)
    validateQueueItem(item)
    const queue = record.binding!.activationQueue
    if (!queue.some((candidate) => candidate.causeMessageId === item.causeMessageId)) {
      if (queue.length >= MAX_ACTIVATION_QUEUE) {
        throw new RoomSessionRegistryError(
          'activation_queue_full',
          'Agent activation queue is full.',
        )
      }
      queue.push(clone(item))
    }
    if (clearMentionContext) record.binding!.mentionContext = []
    this.touchAndPersist(record, now)
    return clone(record)
  }

  appendMentionContext(
    registryKey: string,
    item: RoomMentionContextItem,
    now = new Date(),
  ): RoomSessionRegistration {
    const record = this.requireBoundRecord(registryKey)
    validateMentionContextItem(item)
    const context = record.binding!.mentionContext ?? []
    if (!context.some((candidate) => candidate.sequence === item.sequence)) {
      context.push(clone(item))
      record.binding!.mentionContext = context.slice(-MAX_MENTION_CONTEXT)
    }
    this.touchAndPersist(record, now)
    return clone(record)
  }

  replaceMentionContext(
    registryKey: string,
    items: RoomMentionContextItem[],
    now = new Date(),
  ): RoomSessionRegistration {
    const record = this.requireBoundRecord(registryKey)
    for (const item of items) validateMentionContextItem(item)
    record.binding!.mentionContext = items.slice(-MAX_MENTION_CONTEXT).map(clone)
    this.touchAndPersist(record, now)
    return clone(record)
  }

  retireLegacyActivationState(registryKey: string, now = new Date()): RoomSessionRegistration {
    const record = this.requireBoundRecord(registryKey)
    record.binding!.activationQueue = []
    record.binding!.activeActivation = null
    this.touchAndPersist(record, now)
    return clone(record)
  }

  dequeueActivation(
    registryKey: string,
    causeMessageId: string,
    now = new Date(),
  ): RoomSessionRegistration {
    const record = this.requireBoundRecord(registryKey)
    record.binding!.activationQueue = record.binding!.activationQueue.filter(
      (item) => item.causeMessageId !== causeMessageId,
    )
    this.touchAndPersist(record, now)
    return clone(record)
  }

  markActivationDispatching(
    registryKey: string,
    causeMessageId: string,
    now = new Date(),
  ): RoomSessionRegistration {
    const record = this.requireBoundRecord(registryKey)
    const item = record.binding!.activationQueue.find(
      (candidate) => candidate.causeMessageId === causeMessageId,
    )
    if (!item)
      throw new RoomSessionRegistryError('activation_not_found', 'Agent activation is unavailable.')
    record.binding!.activeActivation = {
      ...clone(item),
      dispatchState: 'dispatching',
      dispatchedAt: now.toISOString(),
      interruptedAt: undefined,
    }
    record.binding!.activationQueue = record.binding!.activationQueue.filter(
      (candidate) => candidate.causeMessageId !== causeMessageId,
    )
    this.touchAndPersist(record, now)
    return clone(record)
  }

  clearActiveActivation(registryKey: string, now = new Date()): RoomSessionRegistration {
    const record = this.requireBoundRecord(registryKey)
    record.binding!.activeActivation = null
    this.touchAndPersist(record, now)
    return clone(record)
  }

  retryActiveActivation(input: {
    registryKey: string
    maxAttempts: number
    pauseMs: number
    now?: Date
  }): { queued: boolean; attempts: number } {
    const record = this.requireBoundRecord(input.registryKey)
    const active = record.binding!.activeActivation
    if (!active) return { queued: false, attempts: 0 }
    if (isInterruptedRoomActivation(active)) {
      throw new RoomSessionRegistryError(
        'activation_interrupted_requires_explicit_retry',
        'Interrupted Agent activation requires an explicit retry.',
      )
    }
    return this.requeueActiveActivation(record, input)
  }

  private requeueActiveActivation(
    record: RoomSessionRegistration,
    input: { maxAttempts: number; pauseMs: number; now?: Date },
  ): { queued: boolean; attempts: number } {
    const active = record.binding!.activeActivation!
    const now = input.now ?? new Date()
    const {
      dispatchState: _dispatchState,
      dispatchedAt: _dispatchedAt,
      interruptedAt: _interruptedAt,
      ...queuedItem
    } = active
    const retry = { ...queuedItem, attempts: active.attempts + 1 }
    record.binding!.activeActivation = null
    if (retry.attempts < input.maxAttempts) {
      if (
        !record.binding!.activationQueue.some(
          (item) => item.causeMessageId === retry.causeMessageId,
        )
      ) {
        record.binding!.activationQueue.unshift(retry)
      }
      this.touchAndPersist(record, now)
      return { queued: true, attempts: retry.attempts }
    }
    record.binding!.loopBreaker.pausedUntil = new Date(now.getTime() + input.pauseMs).toISOString()
    this.touchAndPersist(record, now)
    return { queued: false, attempts: retry.attempts }
  }

  private markPersistedActivationsInterrupted(now: Date): boolean {
    const interruptedAt = now.toISOString()
    let changed = false
    for (const record of Object.values(this.state.records)) {
      const active = record.binding?.activeActivation
      if (!active || isInterruptedRoomActivation(active)) continue
      active.dispatchState = 'interrupted'
      active.interruptedAt = interruptedAt
      record.updatedAt = interruptedAt
      changed = true
    }
    return changed
  }

  claimActivation(input: {
    causeMessageId?: string
    registryKey: string
    windowMs: number
    maxActivations: number
    pauseMs: number
    now?: Date
  }): { allowed: boolean; pausedUntil: string | null; newlyPaused?: boolean } {
    const record = this.requireBoundRecord(input.registryKey)
    const now = input.now ?? new Date()
    const breaker = record.binding!.loopBreaker
    if (input.causeMessageId && breaker.claimedMessageIds?.includes(input.causeMessageId)) {
      return { allowed: true, pausedUntil: null }
    }
    if (breaker.pausedUntil && Date.parse(breaker.pausedUntil) > now.getTime()) {
      return { allowed: false, pausedUntil: breaker.pausedUntil, newlyPaused: false }
    }
    const windowExpired =
      !breaker.windowStartedAt ||
      now.getTime() - Date.parse(breaker.windowStartedAt) >= input.windowMs
    if (windowExpired) {
      breaker.windowStartedAt = now.toISOString()
      breaker.activationCount = 0
      breaker.pausedUntil = null
    }
    if (breaker.activationCount >= input.maxActivations) {
      breaker.pausedUntil = new Date(now.getTime() + input.pauseMs).toISOString()
      this.touchAndPersist(record, now)
      return { allowed: false, pausedUntil: breaker.pausedUntil, newlyPaused: true }
    }
    breaker.activationCount += 1
    if (input.causeMessageId) {
      breaker.claimedMessageIds = [...(breaker.claimedMessageIds ?? []), input.causeMessageId].slice(-MAX_ACTIVATION_QUEUE)
    }
    this.touchAndPersist(record, now)
    return { allowed: true, pausedUntil: null }
  }

  updateLifecycle(
    registryKey: string,
    lifecycleState: 'active' | 'inactive' | 'closed',
    now = new Date(),
  ): RoomSessionRegistration {
    const record = this.requireRecord(registryKey)
    if (record.lifecycleState === 'closed' && lifecycleState !== 'closed') {
      throw new RoomSessionRegistryError('session_registration_closed', 'A retired session cannot be reopened.')
    }
    if (record.lifecycleState !== lifecycleState) record.registrationEpoch += 1
    record.lifecycleState = lifecycleState
    if (lifecycleState === 'closed' && record.binding) {
      record.binding.status = 'detached'
      record.binding.activationMode = 'paused'
      record.binding.activationQueue = []
      record.binding.activeActivation = null
      record.binding.mentionContext = []
    }
    this.touchAndPersist(record, now)
    return clone(record)
  }

  async runExclusive<T>(registryKey: string, operation: () => Promise<T>): Promise<T> {
    this.requireRecord(registryKey)
    const previous = this.mutexTails.get(registryKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => gate)
    this.mutexTails.set(registryKey, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.mutexTails.get(registryKey) === tail) this.mutexTails.delete(registryKey)
    }
  }

  private requireRecord(registryKey: string): RoomSessionRegistration {
    const record = this.state.records[registryKey]
    if (!record)
      throw new RoomSessionRegistryError(
        'session_registration_not_found',
        'Agent session is not registered.',
      )
    return record
  }

  private requireBoundRecord(registryKey: string): RoomSessionRegistration {
    const record = this.requireRecord(registryKey)
    if (
      !record.binding ||
      (record.binding.status !== 'active' && record.binding.status !== 'paused')
    ) {
      throw new RoomSessionRegistryError(
        'session_not_bound',
        'Agent session has no active Room binding.',
      )
    }
    return record
  }

  private touchAndPersist(record: RoomSessionRegistration, now = new Date()): void {
    record.updatedAt = now.toISOString()
    this.persist()
  }

  private load(): RegistryFile {
    try {
      const stat = fs.lstatSync(this.filePath)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new RoomSessionRegistryError(
          'unsafe_session_registry',
          'Room session registry is not a regular file.',
        )
      }
      if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        fs.chmodSync(this.filePath, 0o600)
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown
      return validateRegistryFile(parsed)
    } catch (error) {
      if (isNotFound(error)) return { schemaVersion: 1, records: {} }
      if (error instanceof RoomSessionRegistryError) throw error
      throw new RoomSessionRegistryError(
        'corrupt_session_registry',
        'Room Agent session registry is corrupt.',
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
        if (!existing.isFile() || existing.isSymbolicLink()) {
          throw new RoomSessionRegistryError(
            'unsafe_session_registry',
            'Refusing to replace an unsafe Room session registry.',
          )
        }
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

export function buildRoomSessionRegistryKey(input: {
  machineId: string
  runtimeAdapter: RoomRuntimeAdapter
  sourceSessionKey: string
}): string {
  validateSafeId(input.machineId, 'machine_id')
  validateAdapter(input.runtimeAdapter)
  validateSourceSessionKey(input.sourceSessionKey)
  return crypto
    .createHash('sha256')
    .update(`${input.machineId}\0${input.runtimeAdapter}\0${input.sourceSessionKey}`, 'utf8')
    .digest('hex')
}

function validateRegistryFile(value: unknown): RegistryFile {
  if (!value || typeof value !== 'object' || (value as RegistryFile).schemaVersion !== 1) {
    throw new RoomSessionRegistryError(
      'corrupt_session_registry',
      'Unsupported Room session registry.',
    )
  }
  const records = (value as RegistryFile).records
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    throw new RoomSessionRegistryError(
      'corrupt_session_registry',
      'Room session records are invalid.',
    )
  }
  const validated: Record<string, RoomSessionRegistration> = {}
  for (const [key, record] of Object.entries(records)) {
    validateRegistration(record)
    if (key !== record.registryKey || key !== buildRoomSessionRegistryKey(record)) {
      throw new RoomSessionRegistryError(
        'corrupt_session_registry',
        'Room session registry key mismatch.',
      )
    }
    validated[key] = {
      ...record,
      binding: record.binding
        ? {
            ...record.binding,
            activeActivation: record.binding.activeActivation ?? null,
            mentionContext: record.binding.mentionContext ?? [],
          }
        : null,
    }
  }
  return { schemaVersion: 1, records: validated }
}

function validateRegistration(record: RoomSessionRegistration): void {
  if (!record || record.schemaVersion !== 1)
    throw new RoomSessionRegistryError('corrupt_session_registry', 'Invalid registration.')
  validateSafeId(record.machineId, 'machine_id')
  validateAdapter(record.runtimeAdapter)
  validateSourceSessionKey(record.sourceSessionKey)
  validateSafeId(record.nianSessionId, 'nian_session_id')
  validateSafeId(record.hostProcessIdentity, 'host_process_identity')
  if (record.panelContextKey !== record.nianSessionId)
    throw new RoomSessionRegistryError('corrupt_session_registry', 'Invalid panel context.')
  if (!Number.isInteger(record.registrationEpoch) || record.registrationEpoch < 1)
    throw new RoomSessionRegistryError('corrupt_session_registry', 'Invalid registration epoch.')
  validateCapabilities(record.capabilities)
  if (record.binding) validateBinding(record.binding)
}

function validateBinding(binding: RoomSessionBindingState): void {
  validateSafeId(binding.bindingId, 'binding_id')
  validateSafeId(binding.roomId, 'room_id')
  validateSafeId(binding.agentIdentityId, 'agent_identity_id')
  if (!BINDING_STATUSES.has(binding.status))
    throw new RoomSessionRegistryError('corrupt_session_registry', 'Invalid binding status.')
  if (
    (binding.status === 'pending_approval' && binding.agentMembershipId !== null) ||
    ((binding.status === 'active' || binding.status === 'paused') &&
      binding.agentMembershipId === null)
  ) {
    throw new RoomSessionRegistryError('corrupt_session_registry', 'Invalid Agent membership.')
  }
  if (binding.agentMembershipId !== null) {
    validateSafeId(binding.agentMembershipId, 'agent_membership_id')
  }
  if (!ACTIVATION_MODES.has(binding.activationMode))
    throw new RoomSessionRegistryError('corrupt_session_registry', 'Invalid activation mode.')
  validateSequence(binding.lastDeliveredSequence)
  validateSequence(binding.lastActivatedSequence)
  if (
    !Array.isArray(binding.activationQueue) ||
    binding.activationQueue.length > MAX_ACTIVATION_QUEUE
  ) {
    throw new RoomSessionRegistryError('corrupt_session_registry', 'Invalid activation queue.')
  }
  binding.activationQueue.forEach(validateQueueItem)
  if (binding.activeActivation != null) validateQueueItem(binding.activeActivation)
  if (
    binding.mentionContext !== undefined &&
    (!Array.isArray(binding.mentionContext) || binding.mentionContext.length > MAX_MENTION_CONTEXT)
  ) {
    throw new RoomSessionRegistryError('corrupt_session_registry', 'Invalid mention context.')
  }
  binding.mentionContext?.forEach(validateMentionContextItem)
}

function validateMentionContextItem(item: RoomMentionContextItem): void {
  validateSequence(item.sequence)
  if (
    typeof item.deliveryText !== 'string' ||
    !item.deliveryText.trim() ||
    item.deliveryText.length > 24_000
  ) {
    throw new RoomSessionRegistryError('invalid_mention_context', 'Invalid mention context.')
  }
}

function validateQueueItem(item: RoomActivationQueueItem): void {
  validateSafeId(item.causeMessageId, 'cause_message_id')
  validateSafeId(item.rootCauseMessageId, 'root_cause_message_id')
  validateSequence(item.sequence)
  if (!Number.isInteger(item.hopCount) || item.hopCount < 0 || item.hopCount > 32) {
    throw new RoomSessionRegistryError('invalid_hop_count', 'Invalid Agent activation hop count.')
  }
  if (!Number.isInteger(item.attempts) || item.attempts < 0 || item.attempts > 100) {
    throw new RoomSessionRegistryError(
      'invalid_activation_attempts',
      'Invalid Agent activation attempts.',
    )
  }
  if (!Number.isFinite(new Date(item.enqueuedAt).getTime())) {
    throw new RoomSessionRegistryError('invalid_activation_time', 'Invalid Agent activation time.')
  }
  if (
    item.deliveryText !== undefined &&
    (typeof item.deliveryText !== 'string' ||
      !item.deliveryText.trim() ||
      item.deliveryText.length > 24_000)
  ) {
    throw new RoomSessionRegistryError('invalid_activation_text', 'Invalid Agent activation text.')
  }
  if (
    item.systemPrompt !== undefined &&
    (typeof item.systemPrompt !== 'string' ||
      !item.systemPrompt.trim() ||
      item.systemPrompt.length > 24_000)
  ) {
    throw new RoomSessionRegistryError(
      'invalid_activation_prompt',
      'Invalid Agent activation prompt.',
    )
  }
  if (item.promptSnapshot !== undefined && !isPromptSnapshot(item.promptSnapshot)) {
    throw new RoomSessionRegistryError(
      'invalid_activation_prompt_snapshot',
      'Invalid Agent activation prompt snapshot.',
    )
  }
  if (
    item.dispatchState !== undefined &&
    item.dispatchState !== 'dispatching' &&
    item.dispatchState !== 'interrupted'
  ) {
    throw new RoomSessionRegistryError(
      'invalid_activation_state',
      'Invalid Agent activation state.',
    )
  }
  if (item.dispatchedAt !== undefined && !Number.isFinite(new Date(item.dispatchedAt).getTime())) {
    throw new RoomSessionRegistryError(
      'invalid_activation_dispatch_time',
      'Invalid Agent activation dispatch time.',
    )
  }
  if (item.dispatchState === undefined && item.dispatchedAt !== undefined) {
    throw new RoomSessionRegistryError(
      'invalid_activation_dispatch_time',
      'Queued Agent activation cannot have a dispatch time.',
    )
  }
  if (
    item.dispatchState === 'interrupted' &&
    (item.interruptedAt === undefined || !Number.isFinite(new Date(item.interruptedAt).getTime()))
  ) {
    throw new RoomSessionRegistryError(
      'invalid_activation_interrupted_time',
      'Invalid Agent activation interruption time.',
    )
  }
  if (item.dispatchState !== 'interrupted' && item.interruptedAt !== undefined) {
    throw new RoomSessionRegistryError(
      'invalid_activation_interrupted_time',
      'Unexpected Agent activation interruption time.',
    )
  }
}

function isPromptSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const nullableHash = (candidate: unknown) =>
    candidate === null || (typeof candidate === 'string' && /^[a-f0-9]{64}$/.test(candidate))
  return (
    typeof item.managedRoomPolicyVersion === 'string' &&
    item.managedRoomPolicyVersion.length <= 64 &&
    nullableHash(item.sessionModeInstructionsHash) &&
    nullableHash(item.agentSystemPromptHash) &&
    typeof item.trustedRoomContextHash === 'string' &&
    /^[a-f0-9]{64}$/.test(item.trustedRoomContextHash)
  )
}

export function isInterruptedRoomActivation(item: RoomActivationQueueItem): boolean {
  return item.dispatchState === 'interrupted'
}

function validateCapabilities(value: RoomSessionCapabilities): void {
  const fields: Array<keyof RoomSessionCapabilities> = [
    'canIdentifySession',
    'canBindAutomatically',
    'canOpenEmbeddedRoomPage',
    'canResumeIdleSession',
    'canActivateWhileHostOpen',
  ]
  if (!value || fields.some((field) => typeof value[field] !== 'boolean')) {
    throw new RoomSessionRegistryError(
      'invalid_session_capabilities',
      'Invalid Agent session capabilities.',
    )
  }
}

function validateAdapter(value: string): asserts value is RoomRuntimeAdapter {
  if (!isRoomRuntimeAdapter(value)) {
    throw new RoomSessionRegistryError(
      'invalid_runtime_adapter',
      'Unsupported Room runtime adapter.',
    )
  }
}

function validateSourceSessionKey(value: string): void {
  if (!value || value.length > 1024 || /[\0\r\n]/.test(value)) {
    throw new RoomSessionRegistryError(
      'invalid_source_session_key',
      'Invalid native Agent session key.',
    )
  }
}

function validateSafeId(value: string, field: string): void {
  if (!SAFE_ID.test(value))
    throw new RoomSessionRegistryError(`invalid_${field}`, `Invalid ${field}.`)
}

function validateSequence(value: string): void {
  if (!/^(0|[1-9]\d{0,19})$/.test(value)) {
    throw new RoomSessionRegistryError('invalid_room_sequence', 'Invalid Room sequence.')
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
