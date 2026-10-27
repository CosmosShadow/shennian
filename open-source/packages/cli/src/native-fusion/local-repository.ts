// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-local-repository.test.ts

import {
  isToolPayload,
  sessionPreviewFromPayload,
  type Envelope,
  type SessionDeliveryState,
} from '@shennian/wire'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { recordPersonalSyncLocalMetric } from '../personal-sync/metrics.js'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import type { CanonicalSessionStore } from '../session/canonical-store.js'
import {
  getCanonicalSessionStore,
  getDaemonInstallationId,
  listSessionRecords,
  recordSession,
} from '../session/store.js'
import {
  readToolDetail,
  writeToolDetail,
  type LocalToolDetail,
} from '../session/tool-detail-store.js'
import { NativeSourceDeletionStore } from './native-source-deletions.js'
import type { ManagedSuppressionWindow, ParsedNativeEvent, PendingManagedClaim } from './types.js'

import { isInternalNativeSource } from './source-visibility.js'
import { isNativeTestWorkspace } from './test-workspace.js'

const SCHEMA_VERSION = 1 as const

export class MissingUserBoundaryError extends Error {
  readonly code = 'missing_user_boundary'
  constructor(sourceSessionKey: string) {
    super(`native source ${sourceSessionKey} does not start at a visible user boundary`)
    this.name = 'MissingUserBoundaryError'
  }
}

export class InternalNativeSourceError extends Error {
  readonly code = 'internal_native_source'
  constructor() {
    super('internal native source cannot be imported as a personal session')
    this.name = 'InternalNativeSourceError'
  }
}

export class NativeSourceDeletedError extends Error {
  readonly code = 'native_source_deleted'
  constructor(sourceSessionKey: string) {
    super(`native source ${sourceSessionKey} is blocked by a durable deletion tombstone`)
    this.name = 'NativeSourceDeletedError'
  }
}

export class NativeEventIdentityConflictError extends Error {
  readonly code = 'native_event_identity_conflict'
  constructor(readonly sourceEventKey: string) {
    super(`native event identity conflict: ${sourceEventKey}`)
    this.name = 'NativeEventIdentityConflictError'
  }
}

type SourceBinding = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  sessionId: string
  agentType: ParsedNativeEvent['agentType']
  sourceSessionKey: string
  sourceMode: ParsedNativeEvent['sourceMode']
  lastCursor: string | null
  bodyRevision: number
  createdAt: string
  updatedAt: string
}
type SourceBindingFile = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  sources: Record<string, SourceBinding>
}
type NativeLedgerEntry = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  sessionId: string
  agentType: ParsedNativeEvent['agentType']
  sourceSessionKey: string
  sourceEventKey: string
  eventFingerprint: string
  canonicalMessageId: string | null
  canonicalRevision: number
  cursor: string | null
  mappedBy: ParsedNativeEvent['sourceMode'] | 'managed_echo_claim' | 'managed_echo_suppressed'
  eventTs: number
  createdAt: string
}
export type NativeLocalCommitResult = {
  sessionId: string
  messageId: string | null
  bodyRevision: number
  duplicate: boolean
  claimed: boolean
  suppressed: boolean
}
type ManagedEchoStateFile = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  claims: Record<string, PendingManagedClaim>
  suppressions: Record<string, ManagedSuppressionWindow>
}
type RecordSessionInput = Parameters<typeof recordSession>[0]

export class NativeFusionLocalRepository {
  constructor(private options: {
    rootDir?: string
    daemonInstallationId?: string
    canonicalStore?: CanonicalSessionStore
    recordLocalSession?: (input: RecordSessionInput) => unknown
    listLocalSessions?: typeof listSessionRecords
    writeLocalToolDetail?: (detail: Omit<LocalToolDetail, 'schemaVersion'>) => void
    readLocalToolDetail?: (sessionId: string, toolCallId: string) => LocalToolDetail | null
    deletionStore?: Pick<NativeSourceDeletionStore, 'has'>
  } = {}) {}

  commitEvents(events: readonly ParsedNativeEvent[]): NativeLocalCommitResult[] {
    return [...events]
      .filter((event) => !this.isSourceInternal(event.agentType, event.sourceSessionKey)
        && !isNativeTestWorkspace(event.workDir ?? ''))
      .sort((left, right) => left.ts - right.ts)
      .map((event) => this.commitEvent(event))
  }

  updateMessageDeliveryState(
    sessionId: string,
    messageId: string,
    deliveryState: SessionDeliveryState,
  ): void {
    const committed = this.canonicalStore().updateMessageDeliveryState(
      sessionId,
      messageId,
      deliveryState,
    )
    if (!committed) return
    const record = (this.options.listLocalSessions ?? listSessionRecords)()
      .find((item) => item.sessionId === sessionId)
    if (!record) return
    const persist = this.options.recordLocalSession ?? recordSession
    persist({
      ...record,
    })
  }

  commitEvent(event: ParsedNativeEvent): NativeLocalCommitResult {
    validateEvent(event)
    if (this.isSourceInternal(event.agentType, event.sourceSessionKey)) throw new InternalNativeSourceError()
    if (this.isSourceDeleted(event.agentType, event.sourceSessionKey)) {
      throw new NativeSourceDeletedError(event.sourceSessionKey)
    }
    if (isNativeTestWorkspace(event.workDir ?? '')) throw new InternalNativeSourceError()
    const installationId = this.installationId()
    const sourceFile = this.readSources()
    const sourceKey = stableSourceKey(event.agentType, event.sourceSessionKey)
    const existingBinding = sourceFile.sources[sourceKey]
    const fingerprint = eventFingerprint(event)
    const ledgerFile = this.ledgerFile(event.agentType, event.sourceEventKey)
    const existingLedger = fs.existsSync(ledgerFile) ? readJson<NativeLedgerEntry>(ledgerFile) : null
    if (existingLedger && existingLedger.daemonInstallationId !== installationId) {
      throw new Error('native event ledger belongs to another daemon installation')
    }
    if (existingLedger && existingLedger.eventFingerprint !== fingerprint) {
      throw new NativeEventIdentityConflictError(event.sourceEventKey)
    }
    if (!existingBinding && !existingLedger && event.role !== 'user') {
      throw new MissingUserBoundaryError(event.sourceSessionKey)
    }
    const claimedSessionId = event.claimSessionId ?? null
    const sessionId = existingBinding?.sessionId
      ?? existingLedger?.sessionId
      ?? claimedSessionId
      ?? stableSessionId(installationId, event.agentType, event.sourceSessionKey)
    if (claimedSessionId && existingBinding && existingBinding.sessionId !== claimedSessionId) {
      throw new Error(`managed claim session conflicts with source binding ${event.sourceSessionKey}`)
    }

    const store = this.canonicalStore()
    const suppressed = event.localDisposition === 'managed_echo_suppressed'
      || existingLedger?.mappedBy === 'managed_echo_suppressed'
    const messageId = existingLedger?.canonicalMessageId
      ?? (suppressed ? null : event.claimCanonicalMessageId
        ?? stableMessageId(
          installationId,
          event.agentType,
          event.canonicalMessageKey ?? event.sourceEventKey,
        ))
    let bodyRevision = store.getManifest(sessionId)?.bodyRevision ?? 0
    let duplicate = Boolean(existingLedger)
    const claimed = !suppressed && Boolean(event.claimCanonicalMessageId)
    if (claimed) {
      if (!messageId) throw new Error('managed echo claim requires a canonical message')
      const claimedState = store.getMessageState(sessionId, messageId)
      if (!claimedState || claimedState.tombstoned) {
        throw new Error(`managed echo claim target is not durable: ${messageId}`)
      }
      // Persist proof of consumption before advancing the source cursor. This
      // survives restart without guessing which queued input a terminal owns.
      if (claimedState.deliveryState === 'queued' && claimedState.message) {
        bodyRevision = store.upsert(sessionId, { ...claimedState.message, ts: event.ts }, 'executing').bodyRevision
      }
    }
    if (!existingLedger && !claimed && !suppressed) {
      if (!messageId) throw new Error('native event requires a canonical message')
      // Codex can emit the same logical tool call more than once (for example,
      // a replayed running frame before its completed frame). The source-event
      // ledger is keyed by the physical rollout line, while canonical identity
      // is keyed by canonicalMessageKey. Recover from that split-brain window
      // by updating an already durable logical message instead of aborting the
      // whole scanner batch with an append conflict.
      const durableLogicalMessage = event.canonicalMessageKey
        ? store.getMessageState(sessionId, messageId)
        : null
      const shouldUpsert = event.canonicalMutation === 'upsert' || Boolean(durableLogicalMessage)
      const previous = shouldUpsert
        ? durableLogicalMessage ?? store.getMessageState(sessionId, messageId)
        : null
      const envelope: Envelope = {
        id: messageId,
        sessionId,
        role: event.role,
        ts: previous?.message?.ts ?? event.ts,
        payload: mergeToolSkeleton(previous?.message?.payload, event.payload),
      }
      const committed = shouldUpsert
        ? store.upsert(sessionId, envelope)
        : store.append(sessionId, envelope)
      bodyRevision = committed.bodyRevision
      duplicate = committed.duplicate
      if (event.localToolDetail) {
        const persistDetail = this.options.writeLocalToolDetail ?? writeToolDetail
        const readDetail = this.options.readLocalToolDetail ?? readToolDetail
        const detail = mergeToolDetail(
          readDetail(sessionId, event.localToolDetail.toolCallId),
          event.localToolDetail,
        )
        persistDetail({
          sessionId,
          ...detail,
          ts: event.ts,
          detailRef: { toolIndex: 0 },
        })
      }
    }

    if (event.terminal) {
      bodyRevision = store.completeStartedUserMessages(sessionId, event.ts).at(-1)?.bodyRevision ?? bodyRevision
    }
    if ((!existingLedger || event.terminal) && !suppressed) {
      this.recordIndex(event, sessionId, messageId, bodyRevision)
    }
    const now = new Date().toISOString()
    if (!existingLedger) {
      atomicWriteJson(ledgerFile, {
        schemaVersion: SCHEMA_VERSION,
        daemonInstallationId: installationId,
        sessionId,
        agentType: event.agentType,
        sourceSessionKey: event.sourceSessionKey,
        sourceEventKey: event.sourceEventKey,
        eventFingerprint: fingerprint,
        canonicalMessageId: messageId,
        canonicalRevision: bodyRevision,
        cursor: event.cursor ?? null,
        mappedBy: suppressed
          ? 'managed_echo_suppressed'
          : claimed ? 'managed_echo_claim' : event.sourceMode,
        eventTs: event.ts,
        createdAt: now,
      } satisfies NativeLedgerEntry)
    }

    sourceFile.sources[sourceKey] = {
      schemaVersion: SCHEMA_VERSION,
      daemonInstallationId: installationId,
      sessionId,
      agentType: event.agentType,
      sourceSessionKey: event.sourceSessionKey,
      sourceMode: existingLedger ? existingBinding?.sourceMode ?? event.sourceMode : event.sourceMode,
      lastCursor: existingLedger
        ? existingBinding?.lastCursor ?? existingLedger.cursor
        : event.cursor ?? existingBinding?.lastCursor ?? null,
      bodyRevision,
      createdAt: existingBinding?.createdAt ?? now,
      updatedAt: now,
    }
    atomicWriteJson(this.sourcesFile(), sourceFile)
    if (!existingLedger && event.cursor) recordPersonalSyncLocalMetric('sourceCursorAdvanced')
    if (!existingLedger && !claimed && !suppressed && !duplicate) {
      recordPersonalSyncLocalMetric('canonicalCommits')
    }
    return { sessionId, messageId, bodyRevision, duplicate, claimed, suppressed }
  }

  repairMissingUserBoundaries(): number {
    const list = this.options.listLocalSessions ?? listSessionRecords
    const record = this.options.recordLocalSession ?? recordSession
    const store = this.canonicalStore()
    let repaired = 0
    for (const existing of list()) {
      if (existing.localReady) continue
      const manifest = store.getManifest(existing.sessionId)
      const firstSequence = manifest?.firstAvailableSeq
      if (firstSequence == null) continue
      const first = store.readPage(existing.sessionId, {
        limit: 1,
        beforeSequence: firstSequence + 1,
      }).entries[0]
      if (!first || first.sequence !== firstSequence || first.message.role !== 'user') continue
      record({
        sessionId: existing.sessionId,
        agentType: existing.agentType,
        sessionMode: existing.sessionMode,
        managerConfig: existing.managerConfig,
        workDir: existing.workDir,
        agentSessionId: existing.agentSessionId,
        modelId: existing.modelId,
        managerDefaultWorkerAgentType: existing.managerDefaultWorkerAgentType,
        managerDefaultWorkerModelId: existing.managerDefaultWorkerModelId,
        status: existing.status,
        lastActivityAt: existing.lastActivityAt,
        lastMessagePreview: existing.lastMessagePreview,
        localReady: true,
        firstUserMessageId: first.message.id,
        firstUserBodyRevision: first.revision,
      })
      repaired += 1
    }
    return repaired
  }

  listManagedClaims(): PendingManagedClaim[] {
    return Object.values(this.readManagedEchoState().claims)
  }

  listManagedSuppressions(): ManagedSuppressionWindow[] {
    return Object.values(this.readManagedEchoState().suppressions)
  }

  upsertManagedClaim(claim: PendingManagedClaim): void {
    validateManagedClaim(claim)
    const state = this.readManagedEchoState()
    state.claims[claim.canonicalMessageId] = claim
    atomicWriteJson(this.managedEchoStateFile(), state)
  }

  updateManagedClaimSource(
    sessionId: string,
    agentType: string,
    sourceSessionKey: string,
  ): void {
    const state = this.readManagedEchoState()
    let changed = false
    for (const claim of Object.values(state.claims)) {
      if (claim.sessionId !== sessionId || claim.sourceAgentType !== agentType) continue
      claim.sourceSessionKey = sourceSessionKey
      changed = true
    }
    if (changed) atomicWriteJson(this.managedEchoStateFile(), state)
  }

  removeManagedClaim(canonicalMessageId: string): void {
    const state = this.readManagedEchoState()
    if (!state.claims[canonicalMessageId]) return
    delete state.claims[canonicalMessageId]
    atomicWriteJson(this.managedEchoStateFile(), state)
  }

  completeManagedClaim(
    canonicalMessageId: string,
    suppression?: ManagedSuppressionWindow,
  ): void {
    const state = this.readManagedEchoState()
    delete state.claims[canonicalMessageId]
    if (suppression) {
      validateSuppression(suppression)
      state.suppressions[stableSourceKey(suppression.agentType, suppression.sourceSessionKey)] = suppression
    }
    atomicWriteJson(this.managedEchoStateFile(), state)
  }

  removeManagedSuppression(agentType: string, sourceSessionKey: string): void {
    const state = this.readManagedEchoState()
    const key = stableSourceKey(agentType, sourceSessionKey)
    if (!state.suppressions[key]) return
    delete state.suppressions[key]
    atomicWriteJson(this.managedEchoStateFile(), state)
  }

  listSourceBindings(): SourceBinding[] {
    return Object.values(this.readSources().sources)
      .filter((binding) => !this.isSourceDeleted(binding.agentType, binding.sourceSessionKey))
  }

  /** Raw source → session bindings, including managed-echo suppressions and deleted sources. */
  listSourceOwners(): Array<{ agentType: string; sourceSessionKey: string; sessionId: string }> {
    return Object.values(this.readSources().sources)
      .map(({ agentType, sourceSessionKey, sessionId }) => ({ agentType, sourceSessionKey, sessionId }))
  }

  purgeSession(sessionId: string): void {
    if (!sessionId) throw new Error('sessionId is required')
    const sourceFile = this.readSources()
    let sourceChanged = false
    for (const [key, binding] of Object.entries(sourceFile.sources)) {
      if (binding.sessionId !== sessionId) continue
      delete sourceFile.sources[key]
      sourceChanged = true
    }
    if (sourceChanged) atomicWriteJson(this.sourcesFile(), sourceFile)

    const managedState = this.readManagedEchoState()
    let managedChanged = false
    for (const [key, claim] of Object.entries(managedState.claims)) {
      if (claim.sessionId !== sessionId) continue
      delete managedState.claims[key]
      managedChanged = true
    }
    for (const [key, suppression] of Object.entries(managedState.suppressions)) {
      if (suppression.sessionId !== sessionId) continue
      delete managedState.suppressions[key]
      managedChanged = true
    }
    if (managedChanged) atomicWriteJson(this.managedEchoStateFile(), managedState)

    const ledgerDirectory = path.join(this.rootDir(), 'ledger')
    if (!fs.existsSync(ledgerDirectory)) return
    for (const entry of fs.readdirSync(ledgerDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const file = path.join(ledgerDirectory, entry.name)
      const ledger = readJson<NativeLedgerEntry>(file)
      if (ledger.daemonInstallationId !== this.installationId()) {
        throw new Error('native event ledger belongs to another daemon installation')
      }
      if (ledger.sessionId === sessionId) fs.unlinkSync(file)
    }
  }

  isSourceInternal(agentType: ParsedNativeEvent['agentType'], sourceSessionKey: string): boolean {
    const root = this.rootDir()
    return isInternalNativeSource(agentType, sourceSessionKey, {
      filePath: path.join(path.basename(root) === 'native-fusion' ? path.dirname(root) : root,
        'native-fusion-state.json'),
      daemonInstallationId: this.installationId(),
    })
  }

  isSourceDeleted(agentType: ParsedNativeEvent['agentType'], sourceSessionKey: string): boolean {
    const store = this.options.deletionStore ?? new NativeSourceDeletionStore({
      rootDir: path.basename(this.rootDir()) === 'native-fusion'
        ? path.dirname(this.rootDir())
        : this.rootDir(),
      daemonInstallationId: this.installationId(),
    })
    return store.has(agentType, sourceSessionKey)
  }

  observeNativeTitle(
    agentType: ParsedNativeEvent['agentType'],
    sourceSessionKey: string,
    titleValue: string,
  ): boolean {
    if (this.isSourceInternal(agentType, sourceSessionKey)) return false
    const title = titleValue.trim().slice(0, 120)
    if (!title) return false
    const binding = this.readSources().sources[stableSourceKey(agentType, sourceSessionKey)]
    if (!binding || this.isSourceDeleted(agentType, sourceSessionKey)) return false
    const existing = (this.options.listLocalSessions ?? listSessionRecords)()
      .find((record) => record.sessionId === binding.sessionId)
    if (existing?.titleLockedByUser || (
      existing?.titleSource === 'agent_native' && existing.title === title
    )) return false
    const originHash = crypto.createHash('sha256')
      .update(`${agentType}\0${sourceSessionKey}\0${title}`)
      .digest('hex')
    const record = this.options.recordLocalSession ?? recordSession
    record({
      sessionId: binding.sessionId,
      agentType: binding.agentType,
      workDir: existing?.workDir ?? '',
      agentSessionId: sourceSessionKey,
      title,
      titleSource: 'agent_native',
      titleOriginEventId: `agent-native:${originHash}`,
    })
    return true
  }

  private recordIndex(
    event: ParsedNativeEvent,
    sessionId: string,
    messageId: string | null,
    bodyRevision: number,
  ): void {
    const record = this.options.recordLocalSession ?? recordSession
    // A native transcript event's cwd describes where that particular turn
    // happened, not the Shennian project's launch directory.  Claude can
    // legitimately visit another directory during a turn; projecting that
    // value back into the session index makes the conversation jump between
    // projects (and can cause the next send to restart it in that directory).
    // Keep the first/explicitly selected session workDir stable once recorded.
    const existing = (this.options.listLocalSessions ?? listSessionRecords)()
      .find((item) => item.sessionId === sessionId)
    const stableWorkDir = existing?.workDir?.trim() || event.workDir || ''
    const attentionId = event.terminal
      ? `terminal:${crypto.createHash('sha256').update(event.sourceEventKey).digest('hex')}`
      : undefined
    const nextPreview = event.role === 'user' || event.role === 'agent'
      ? preview(event.payload)
      : null
    const previewTuple = nextPreview && messageId
      ? {
          lastMessagePreview: nextPreview,
          lastMessagePreviewMessageId: messageId,
          lastMessagePreviewAt: new Date(event.ts).toISOString(),
        }
      : {}
    const lastVisibleEventAt = messageId && (nextPreview || isToolPayload(event.payload))
      ? new Date(event.ts).toISOString()
      : undefined
    record({
      sessionId,
      agentType: event.agentType,
      workDir: stableWorkDir,
      agentSessionId: event.sourceSessionKey,
      modelId: event.modelId ?? null,
      status: event.terminal
        ? event.terminalState === 'failed' || event.terminalState === 'aborted'
          ? 'failed'
          : 'completed'
        : 'active',
      attentionId,
      lastActivityAt: new Date(event.ts).toISOString(),
      lastVisibleEventAt,
      ...previewTuple,
      ...(event.role === 'user' && messageId
        ? {
            localReady: true,
            firstUserMessageId: messageId,
            firstUserBodyRevision: bodyRevision,
          }
        : {}),
      title: event.title?.trim() || (event.role === 'user' ? preview(event.payload) ?? '' : undefined),
      titleSource: event.title?.trim()
        ? event.titleSource ?? 'first_user_fallback'
        : 'first_user_fallback',
      titleOriginEventId: event.sourceEventKey,
    })
  }

  private readSources(): SourceBindingFile {
    const file = this.sourcesFile()
    if (!fs.existsSync(file)) {
      return { schemaVersion: SCHEMA_VERSION, daemonInstallationId: this.installationId(), sources: {} }
    }
    const parsed = readJson<SourceBindingFile>(file)
    if (parsed.schemaVersion !== SCHEMA_VERSION
      || parsed.daemonInstallationId !== this.installationId() || !parsed.sources) {
      throw new Error('invalid native source binding store')
    }
    for (const binding of Object.values(parsed.sources)) {
      if (binding.daemonInstallationId !== this.installationId()) {
        throw new Error('native source binding belongs to another daemon installation')
      }
    }
    return parsed
  }

  private installationId(): string {
    return this.options.daemonInstallationId ?? getDaemonInstallationId()
  }
  private canonicalStore(): CanonicalSessionStore {
    return this.options.canonicalStore ?? getCanonicalSessionStore()
  }
  private rootDir(): string {
    return this.options.rootDir ?? resolvePersonalSyncV1Path('native-fusion')
  }
  private sourcesFile(): string {
    return path.join(this.rootDir(), 'sources.json')
  }
  private managedEchoStateFile(): string {
    return path.join(this.rootDir(), 'managed-echo-state.json')
  }
  private readManagedEchoState(): ManagedEchoStateFile {
    const file = this.managedEchoStateFile()
    if (!fs.existsSync(file)) {
      return {
        schemaVersion: SCHEMA_VERSION,
        daemonInstallationId: this.installationId(),
        claims: {},
        suppressions: {},
      }
    }
    const state = readJson<ManagedEchoStateFile>(file)
    if (
      state.schemaVersion !== SCHEMA_VERSION
      || state.daemonInstallationId !== this.installationId()
      || !state.claims || !state.suppressions
    ) throw new Error('invalid managed echo state')
    for (const claim of Object.values(state.claims)) validateManagedClaim(claim)
    for (const suppression of Object.values(state.suppressions)) validateSuppression(suppression)
    return state
  }
  private ledgerFile(agentType: string, sourceEventKey: string): string {
    const name = crypto.createHash('sha256').update(`${agentType}\0${sourceEventKey}`).digest('hex')
    return path.join(this.rootDir(), 'ledger', `${name}.json`)
  }
}

function validateEvent(event: ParsedNativeEvent): void {
  if (!event.agentType || !event.sourceSessionKey || !event.sourceEventKey || !event.payload) {
    throw new Error('invalid native event')
  }
  if (!Number.isFinite(event.ts)) throw new Error('invalid native event timestamp')
}
function stableSourceKey(agentType: string, sourceSessionKey: string): string {
  return crypto.createHash('sha256').update(`${agentType}\0${sourceSessionKey}`).digest('hex')
}
function stableSessionId(installationId: string, agentType: string, sourceSessionKey: string): string {
  const digest = crypto.createHash('sha256')
    .update(`${installationId}\0${agentType}\0${sourceSessionKey}`).digest('hex').slice(0, 32)
  return `native-session-${digest}`
}
function stableMessageId(installationId: string, agentType: string, sourceEventKey: string): string {
  const digest = crypto.createHash('sha256')
    .update(`${installationId}\0${agentType}\0${sourceEventKey}`).digest('hex').slice(0, 32)
  return `native-${digest}`
}
function eventFingerprint(event: ParsedNativeEvent): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    agentType: event.agentType,
    sourceSessionKey: event.sourceSessionKey,
    sourceEventKey: event.sourceEventKey,
    role: event.role,
    ts: event.ts,
    payload: event.payload,
    canonicalMessageKey: event.canonicalMessageKey ?? null,
    canonicalMutation: event.canonicalMutation ?? 'append',
  })).digest('hex')
}

function validateManagedClaim(claim: PendingManagedClaim): void {
  if (
    !claim.sessionId || !claim.canonicalMessageId || !claim.textHash
    || !Number.isFinite(claim.createdAt)
    || !['codex', 'claude', 'opencode'].includes(claim.sourceAgentType)
    || !['suppress_following', 'import_following'].includes(claim.managedEchoPolicy)
  ) throw new Error('invalid managed echo claim')
}

function validateSuppression(window: ManagedSuppressionWindow): void {
  if (
    !window.sessionId || !window.sourceSessionKey || !window.claimSourceEventKey
    || !['codex', 'claude', 'opencode'].includes(window.agentType)
    || !Number.isFinite(window.startedAt) || !Number.isFinite(window.endsAt)
    || window.endsAt < window.startedAt
  ) throw new Error('invalid managed echo suppression')
}

function mergeToolSkeleton(previousPayload: string | undefined, incomingPayload: string): string {
  if (!previousPayload) return incomingPayload
  try {
    const previous = JSON.parse(previousPayload) as Record<string, unknown>
    const incoming = JSON.parse(incomingPayload) as Record<string, unknown>
    if (
      previous.type !== 'tool' || incoming.type !== 'tool' ||
      previous.toolCallId !== incoming.toolCallId
    ) return incomingPayload
    const incomingName = typeof incoming.name === 'string' ? incoming.name : ''
    const usePreviousName = /(?:_output|_result)$/.test(incomingName)
    return JSON.stringify({
      ...previous,
      ...incoming,
      ...(usePreviousName && typeof previous.name === 'string' ? { name: previous.name } : {}),
    })
  } catch {
    return incomingPayload
  }
}

function mergeToolDetail(
  previous: LocalToolDetail | null,
  incoming: ParsedNativeEvent['localToolDetail'] & {},
): ParsedNativeEvent['localToolDetail'] & {} {
  if (!previous || previous.toolCallId !== incoming.toolCallId) return incoming
  const usePreviousName = /(?:_output|_result)$/.test(incoming.name)
  return {
    ...incoming,
    name: usePreviousName ? previous.name : incoming.name,
    ...(incoming.args === undefined && previous.args !== undefined ? { args: previous.args } : {}),
    ...(incoming.result === undefined && previous.result !== undefined ? { result: previous.result } : {}),
  }
}
function preview(payload: string): string | null {
  return sessionPreviewFromPayload(payload, 120)
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
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { fs.unlinkSync(temp) } catch {}
  }
}
function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}
