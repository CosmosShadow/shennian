// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-store.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import type {
  Envelope,
  SessionBodyMutation,
  SessionDeliveryState,
  SessionHistoryMessage,
} from '@shennian/wire'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION } from '@shennian/wire'

const SCHEMA_VERSION = 1 as const
const SPARSE_INDEX_INTERVAL = 64
const SEGMENT_NAME = 'mutations-000001.jsonl'

export type CanonicalMutationType = 'append' | 'upsert' | 'tombstone'
export type CanonicalCommitInput = {
  sessionId: string
  mutation: CanonicalMutationType
  messageId: string
  message?: Envelope
  deliveryState?: SessionDeliveryState
  committedAt?: string
}
export type CanonicalCommitResult = {
  bodyRevision: number
  sequence: number
  mutation: CanonicalMutation
  duplicate: boolean
}
export type CanonicalHistoryPage = {
  bodyRevision: number
  firstAvailableSeq: number | null
  lastAvailableSeq: number | null
  hasOlder: boolean
  messages: Envelope[]
  entries: SessionHistoryMessage[]
}
export type CanonicalMutation = Omit<SessionBodyMutation, 'subscriptionId'> & {
  schemaVersion: typeof SCHEMA_VERSION
  mutationId: string
  committedAt: string
  contentHash: string
}
type CanonicalManifest = {
  schemaVersion: typeof SCHEMA_VERSION
  daemonInstallationId: string
  sessionId: string
  bodyRevision: number
  nextSequence: number
  firstAvailableSeq: number | null
  lastAvailableSeq: number | null
  mutationCount: number
  visibleMessageCount: number
  lastVisibleMessageId: string | null
  lastBodyCommittedAt: string | null
  segment: typeof SEGMENT_NAME
  logByteLength: number
  updatedAt: string
}
type SparseIndex = {
  schemaVersion: typeof SCHEMA_VERSION
  sessionId: string
  segment: typeof SEGMENT_NAME
  entries: Array<{ revision: number; offset: number }>
}
type MessageState = {
  schemaVersion: typeof SCHEMA_VERSION
  sessionId: string
  messageId: string
  sequence: number
  lastRevision: number
  contentHash: string
  tombstoned: boolean
  message?: Envelope
  deliveryState?: SessionDeliveryState
}

export class CanonicalStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CanonicalStoreError'
  }
}
export class CanonicalStoreCorruptionError extends CanonicalStoreError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CanonicalStoreCorruptionError'
  }
}
export class CanonicalStoreConflictError extends CanonicalStoreError {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalStoreConflictError'
  }
}

export class CanonicalSessionStore {
  readonly rootDir: string
  readonly daemonInstallationId: string
  private mutationListeners = new Set<(mutation: CanonicalMutation) => void>()

  constructor(rootDir: string, daemonInstallationId: string) {
    if (!daemonInstallationId) throw new CanonicalStoreError('daemonInstallationId is required')
    this.rootDir = path.resolve(rootDir)
    this.daemonInstallationId = daemonInstallationId
  }

  commit(input: CanonicalCommitInput): CanonicalCommitResult {
    validateCommitInput(input)
    const sessionDir = this.sessionDir(input.sessionId)
    this.assertHealthy(sessionDir)
    fs.mkdirSync(this.messageStateDir(sessionDir), { recursive: true, mode: 0o700 })
    let manifest = this.loadManifestOrRebuild(input.sessionId)
    const previous = this.readMessageState(sessionDir, input.messageId)
    const contentHash = mutationContentHash(input)
    if (previous && previous.contentHash === contentHash && previous.tombstoned === (input.mutation === 'tombstone')) {
      return {
        bodyRevision: manifest.bodyRevision,
        sequence: previous.sequence,
        mutation: this.findMutationByRevision(input.sessionId, previous.lastRevision),
        duplicate: true,
      }
    }
    if (input.mutation === 'append' && previous) {
      throw new CanonicalStoreConflictError(
        `message ${input.messageId} already exists in session ${input.sessionId}; use upsert`,
      )
    }

    const sequence = previous?.sequence ?? manifest.nextSequence
    const revision = manifest.bodyRevision + 1
    const committedAt = input.committedAt ?? new Date().toISOString()
    const mutation: CanonicalMutation = {
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: this.daemonInstallationId,
      schemaVersion: SCHEMA_VERSION,
      mutationId: deterministicMutationId(
        input.sessionId,
        input.messageId,
        input.mutation,
        previous?.contentHash ?? 'none',
        contentHash,
      ),
      sessionId: input.sessionId,
      revision,
      mutation: input.mutation,
      messageId: input.messageId,
      sequence,
      ...(input.message ? { message: input.message } : {}),
      ...(input.deliveryState ? { deliveryState: input.deliveryState } : {}),
      committedAt,
      contentHash,
    }
    const logFile = path.join(sessionDir, SEGMENT_NAME)
    const offset = appendAndSync(logFile, `${JSON.stringify(mutation)}\n`)
    const state: MessageState = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: input.sessionId,
      messageId: input.messageId,
      sequence,
      lastRevision: revision,
      contentHash,
      tombstoned: input.mutation === 'tombstone',
      ...(input.message ? { message: input.message } : {}),
      ...(input.deliveryState ? { deliveryState: input.deliveryState } : {}),
    }
    atomicWriteJson(this.messageStateFile(sessionDir, sequence, input.messageId), state)
    const sparseIndex = this.readSparseIndex(sessionDir, input.sessionId)
    if (revision === 1 || (revision - 1) % SPARSE_INDEX_INTERVAL === 0) {
      sparseIndex.entries.push({ revision, offset })
      atomicWriteJson(path.join(sessionDir, 'sparse-index.json'), sparseIndex)
    }
    manifest = {
      ...manifest,
      bodyRevision: revision,
      nextSequence: previous ? manifest.nextSequence : sequence + 1,
      firstAvailableSeq: manifest.firstAvailableSeq ?? sequence,
      lastAvailableSeq: Math.max(manifest.lastAvailableSeq ?? sequence, sequence),
      mutationCount: manifest.mutationCount + 1,
      visibleMessageCount: manifest.visibleMessageCount
        + (!previous && input.mutation !== 'tombstone' ? 1 : 0)
        - (Boolean(previous && !previous.tombstoned) && input.mutation === 'tombstone' ? 1 : 0),
      // Delivery-state updates are upserts against an older sequence. They
      // must not make that older message the visible tail of the transcript.
      // Only a newly appended/resurrected message advances the tail.
      lastVisibleMessageId: input.mutation === 'tombstone'
        ? (manifest.lastVisibleMessageId === input.messageId
            ? this.findLastVisibleMessageId(sessionDir, input.messageId)
            : manifest.lastVisibleMessageId)
        : (!previous || previous.tombstoned ? input.messageId : manifest.lastVisibleMessageId),
      lastBodyCommittedAt: committedAt,
      logByteLength: fs.statSync(logFile).size,
      updatedAt: committedAt,
    }
    atomicWriteJson(path.join(sessionDir, 'manifest.json'), manifest)
    for (const listener of this.mutationListeners) {
      try { listener(mutation) } catch (error) {
        console.error('[canonical-store] mutation listener failed', error)
      }
    }
    return { bodyRevision: revision, sequence, mutation, duplicate: false }
  }

  subscribe(listener: (mutation: CanonicalMutation) => void): () => void {
    this.mutationListeners.add(listener)
    return () => this.mutationListeners.delete(listener)
  }

  append(sessionId: string, message: Envelope, deliveryState?: SessionDeliveryState): CanonicalCommitResult {
    return this.commit({ sessionId, mutation: 'append', messageId: message.id, message, deliveryState })
  }
  upsert(sessionId: string, message: Envelope, deliveryState?: SessionDeliveryState): CanonicalCommitResult {
    return this.commit({ sessionId, mutation: 'upsert', messageId: message.id, message, deliveryState })
  }
  tombstone(sessionId: string, messageId: string, deliveryState?: SessionDeliveryState): CanonicalCommitResult {
    return this.commit({ sessionId, mutation: 'tombstone', messageId, deliveryState })
  }
  readRecent(sessionId: string, limit: number): CanonicalHistoryPage {
    return this.readPage(sessionId, { limit })
  }

  readPage(sessionId: string, options: { limit: number; beforeSequence?: number }): CanonicalHistoryPage {
    const limit = normalizeLimit(options.limit)
    const sessionDir = this.sessionDir(sessionId)
    if (!fs.existsSync(sessionDir)) return emptyPage()
    const manifest = this.loadManifestOrRebuild(sessionId)
    const files = this.listMessageStateFiles(sessionDir)
      .filter((entry) => options.beforeSequence === undefined || entry.sequence < options.beforeSequence)
      .sort((a, b) => b.sequence - a.sequence)
    const selected: MessageState[] = []
    let inspected = 0
    for (const entry of files) {
      inspected += 1
      const state = readJsonFile<MessageState>(path.join(this.messageStateDir(sessionDir), entry.name))
      if (!state.tombstoned && state.message) selected.push(state)
      if (selected.length >= limit) break
    }
    selected.sort((a, b) => a.sequence - b.sequence)
    const hasOlder = selected.length > 0 && files.slice(inspected).some((entry) => {
      const state = readJsonFile<MessageState>(path.join(this.messageStateDir(sessionDir), entry.name))
      return !state.tombstoned && Boolean(state.message)
    })
    return {
      bodyRevision: manifest.bodyRevision,
      firstAvailableSeq: manifest.firstAvailableSeq,
      lastAvailableSeq: manifest.lastAvailableSeq,
      hasOlder,
      messages: selected.map((state) => state.message!),
      entries: selected.map((state) => ({
        sequence: state.sequence,
        revision: state.lastRevision,
        message: state.message!,
        ...(state.deliveryState ? { deliveryState: state.deliveryState } : {}),
      })),
    }
  }

  readPageAtRevision(
    sessionId: string,
    options: { limit: number; revision: number; beforeSequence?: number },
  ): CanonicalHistoryPage {
    const limit = normalizeLimit(options.limit)
    const sessionDir = this.sessionDir(sessionId)
    if (!fs.existsSync(sessionDir)) return emptyPage()
    const manifest = this.loadManifestOrRebuild(sessionId)
    if (!Number.isSafeInteger(options.revision) || options.revision < 0
      || options.revision > manifest.bodyRevision) {
      throw new CanonicalStoreError('snapshot revision is unavailable')
    }
    const states = new Map<string, MessageState>()
    const contents = readFileFromOffset(path.join(sessionDir, SEGMENT_NAME), 0)
    for (const line of contents.split('\n')) {
      if (!line) continue
      const mutation = parseMutation(line, sessionId)
      if (mutation.revision > options.revision) break
      states.set(mutation.messageId, {
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        messageId: mutation.messageId,
        sequence: mutation.sequence,
        lastRevision: mutation.revision,
        contentHash: mutation.contentHash,
        tombstoned: mutation.mutation === 'tombstone',
        ...(mutation.message ? { message: mutation.message } : {}),
        ...(mutation.deliveryState ? { deliveryState: mutation.deliveryState } : {}),
      })
    }
    const visible = [...states.values()]
      .filter((state) => !state.tombstoned && state.message
        && (options.beforeSequence === undefined || state.sequence < options.beforeSequence))
      .sort((left, right) => right.sequence - left.sequence)
    const selected = visible.slice(0, limit).sort((left, right) => left.sequence - right.sequence)
    const allVisible = [...states.values()].filter((state) => !state.tombstoned && state.message)
    const sequences = allVisible.map((state) => state.sequence)
    return {
      bodyRevision: options.revision,
      firstAvailableSeq: sequences.length ? Math.min(...sequences) : null,
      lastAvailableSeq: sequences.length ? Math.max(...sequences) : null,
      hasOlder: visible.length > selected.length,
      messages: selected.map((state) => state.message!),
      entries: selected.map((state) => ({
        sequence: state.sequence,
        revision: state.lastRevision,
        message: state.message!,
        ...(state.deliveryState ? { deliveryState: state.deliveryState } : {}),
      })),
    }
  }

  readDeltas(sessionId: string, afterRevision: number, limit: number): CanonicalMutation[] {
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
      throw new CanonicalStoreError('afterRevision must be a non-negative safe integer')
    }
    const boundedLimit = normalizeLimit(limit)
    const sessionDir = this.sessionDir(sessionId)
    if (!fs.existsSync(sessionDir)) return []
    const manifest = this.loadManifestOrRebuild(sessionId)
    if (afterRevision >= manifest.bodyRevision) return []
    const sparse = this.readSparseIndex(sessionDir, sessionId)
    const targetRevision = afterRevision + 1
    const checkpoint = [...sparse.entries].reverse().find((entry) => entry.revision <= targetRevision)
    const contents = readFileFromOffset(path.join(sessionDir, SEGMENT_NAME), checkpoint?.offset ?? 0)
    const mutations: CanonicalMutation[] = []
    for (const line of contents.split('\n')) {
      if (!line) continue
      const mutation = parseMutation(line, sessionId)
      if (mutation.revision > afterRevision) mutations.push(mutation)
      if (mutations.length >= boundedLimit) break
    }
    return mutations
  }

  getManifest(sessionId: string): Readonly<CanonicalManifest> | null {
    const sessionDir = this.sessionDir(sessionId)
    return fs.existsSync(sessionDir) ? this.loadManifestOrRebuild(sessionId) : null
  }

  getMessageState(sessionId: string, messageId: string): {
    sequence: number
    lastRevision: number
    tombstoned: boolean
    message?: Envelope
    deliveryState?: SessionDeliveryState
  } | null {
    const sessionDir = this.sessionDir(sessionId)
    if (!fs.existsSync(sessionDir)) return null
    this.loadManifestOrRebuild(sessionId)
    const state = this.readMessageState(sessionDir, messageId)
    return state ? {
      sequence: state.sequence,
      lastRevision: state.lastRevision,
      tombstoned: state.tombstoned,
      message: state.message,
      deliveryState: state.deliveryState,
    } : null
  }

  completeStartedUserMessages(sessionId: string, terminalTs: number): CanonicalCommitResult[] {
    const sessionDir = this.sessionDir(sessionId)
    if (!fs.existsSync(sessionDir)) return []
    this.loadManifestOrRebuild(sessionId)
    const completed: CanonicalCommitResult[] = []
    for (const entry of this.listMessageStateFiles(sessionDir).sort((a, b) => b.sequence - a.sequence)) {
      const state = readJsonFile<MessageState>(path.join(this.messageStateDir(sessionDir), entry.name))
      if (state.tombstoned || state.message?.role !== 'user') continue
      // A native terminal proves nothing about durable inputs still waiting
      // in the daemon queue. Only a dispatch/managed echo may mark them started.
      if (state.deliveryState !== 'executing' || state.message.ts > terminalTs) continue
      completed.push(this.upsert(sessionId, state.message, 'completed'))
    }
    return completed
  }

  updateMessageDeliveryState(
    sessionId: string,
    messageId: string,
    deliveryState: SessionDeliveryState,
  ): CanonicalCommitResult | null {
    const state = this.getMessageState(sessionId, messageId)
    if (!state?.message || state.tombstoned) return null
    return this.upsert(sessionId, state.message, deliveryState)
  }

  listSessionIds(): string[] {
    const sessionsRoot = path.join(this.rootDir, 'sessions')
    if (!fs.existsSync(sessionsRoot)) return []
    const ids: string[] = []
    for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestFile = path.join(sessionsRoot, entry.name, 'manifest.json')
      if (fs.existsSync(manifestFile)) ids.push(readJsonFile<CanonicalManifest>(manifestFile).sessionId)
    }
    return ids.sort()
  }

  purgeSession(sessionId: string): void {
    if (!sessionId) throw new CanonicalStoreError('sessionId is required')
    const sessionsRoot = path.resolve(this.rootDir, 'sessions')
    const target = path.resolve(sessionsRoot, sessionDirName(sessionId))
    if (path.dirname(target) !== sessionsRoot) throw new CanonicalStoreError('invalid session path')
    fs.rmSync(target, { recursive: true, force: true })
  }

  private findLastVisibleMessageId(sessionDir: string, excludedMessageId: string): string | null {
    for (const entry of this.listMessageStateFiles(sessionDir).sort((a, b) => b.sequence - a.sequence)) {
      const state = readJsonFile<MessageState>(path.join(this.messageStateDir(sessionDir), entry.name))
      if (state.messageId !== excludedMessageId && !state.tombstoned && state.message) return state.messageId
    }
    return null
  }

  rebuild(sessionId: string): Readonly<CanonicalManifest> {
    const sessionDir = this.sessionDir(sessionId)
    this.assertHealthy(sessionDir)
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 })
    const existingManifestFile = path.join(sessionDir, 'manifest.json')
    if (fs.existsSync(existingManifestFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(existingManifestFile, 'utf8')) as Partial<CanonicalManifest>
        if (existing.daemonInstallationId && existing.daemonInstallationId !== this.daemonInstallationId) {
          throw new CanonicalStoreConflictError(
            `canonical session ${sessionId} belongs to a different daemon installation`,
          )
        }
      } catch (error) {
        if (error instanceof CanonicalStoreConflictError) throw error
        // A malformed projection manifest is rebuilt from the append-only log.
      }
    }
    const logFile = path.join(sessionDir, SEGMENT_NAME)
    if (!fs.existsSync(logFile)) {
      const manifest = emptyManifest(sessionId, this.daemonInstallationId)
      atomicWriteJson(path.join(sessionDir, 'manifest.json'), manifest)
      atomicWriteJson(path.join(sessionDir, 'sparse-index.json'), emptySparseIndex(sessionId))
      return manifest
    }
    const buffer = fs.readFileSync(logFile)
    let completeLength = buffer.length
    if (buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a) {
      const lastNewline = buffer.lastIndexOf(0x0a)
      completeLength = lastNewline < 0 ? 0 : lastNewline + 1
      fs.truncateSync(logFile, completeLength)
    }
    const complete = buffer.subarray(0, completeLength).toString('utf8')
    const states = new Map<string, MessageState>()
    const sparse = emptySparseIndex(sessionId)
    let expectedRevision = 1
    let offset = 0
    let lastCommittedAt = new Date(0).toISOString()
    try {
      for (const lineWithNewline of complete.match(/.*\n/g) ?? []) {
        const line = lineWithNewline.slice(0, -1)
        if (!line) {
          offset += Buffer.byteLength(lineWithNewline)
          continue
        }
        const mutation = parseMutation(line, sessionId)
        if (mutation.revision !== expectedRevision) {
          throw new CanonicalStoreCorruptionError(
            `non-contiguous revision in ${sessionId}: expected ${expectedRevision}, got ${mutation.revision}`,
          )
        }
        if (mutation.revision === 1 || (mutation.revision - 1) % SPARSE_INDEX_INTERVAL === 0) {
          sparse.entries.push({ revision: mutation.revision, offset })
        }
        const previous = states.get(mutation.messageId)
        if (previous && previous.sequence !== mutation.sequence) {
          throw new CanonicalStoreCorruptionError(`sequence changed for message ${mutation.messageId}`)
        }
        states.set(mutation.messageId, {
          schemaVersion: SCHEMA_VERSION,
          sessionId,
          messageId: mutation.messageId,
          sequence: mutation.sequence,
          lastRevision: mutation.revision,
          contentHash: mutation.contentHash,
          tombstoned: mutation.mutation === 'tombstone',
          ...(mutation.message ? { message: mutation.message } : {}),
          ...(mutation.deliveryState ? { deliveryState: mutation.deliveryState } : {}),
        })
        expectedRevision += 1
        offset += Buffer.byteLength(lineWithNewline)
        lastCommittedAt = mutation.committedAt
      }
    } catch (error) {
      this.quarantineCorruptSegment(sessionId, logFile, error)
    }
    const stateDir = this.messageStateDir(sessionDir)
    fs.rmSync(stateDir, { recursive: true, force: true })
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    for (const state of states.values()) {
      atomicWriteJson(this.messageStateFile(sessionDir, state.sequence, state.messageId), state)
    }
    atomicWriteJson(path.join(sessionDir, 'sparse-index.json'), sparse)
    const sequences = [...states.values()].map((state) => state.sequence)
    const visibleStates = [...states.values()]
      .filter((state) => !state.tombstoned && Boolean(state.message))
      .sort((left, right) => left.sequence - right.sequence)
    const bodyRevision = expectedRevision - 1
    const manifest: CanonicalManifest = {
      schemaVersion: SCHEMA_VERSION,
      daemonInstallationId: this.daemonInstallationId,
      sessionId,
      bodyRevision,
      nextSequence: sequences.length === 0 ? 1 : Math.max(...sequences) + 1,
      firstAvailableSeq: sequences.length === 0 ? null : Math.min(...sequences),
      lastAvailableSeq: sequences.length === 0 ? null : Math.max(...sequences),
      mutationCount: bodyRevision,
      visibleMessageCount: visibleStates.length,
      lastVisibleMessageId: visibleStates.at(-1)?.messageId ?? null,
      lastBodyCommittedAt: bodyRevision > 0 ? lastCommittedAt : null,
      segment: SEGMENT_NAME,
      logByteLength: completeLength,
      updatedAt: lastCommittedAt,
    }
    atomicWriteJson(path.join(sessionDir, 'manifest.json'), manifest)
    return manifest
  }

  private loadManifestOrRebuild(sessionId: string): CanonicalManifest {
    const sessionDir = this.sessionDir(sessionId)
    this.assertHealthy(sessionDir)
    const manifestFile = path.join(sessionDir, 'manifest.json')
    const logFile = path.join(sessionDir, SEGMENT_NAME)
    if (!fs.existsSync(manifestFile)) return this.rebuild(sessionId) as CanonicalManifest
    try {
      const manifest = readJsonFile<CanonicalManifest>(manifestFile)
      validateManifest(manifest, sessionId, this.daemonInstallationId)
      const logLength = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0
      return manifest.logByteLength === logLength ? manifest : this.rebuild(sessionId) as CanonicalManifest
    } catch (error) {
      if (error instanceof CanonicalStoreConflictError) throw error
      return this.rebuild(sessionId) as CanonicalManifest
    }
  }

  private findMutationByRevision(sessionId: string, revision: number): CanonicalMutation {
    const found = this.readDeltas(sessionId, revision - 1, 1)[0]
    if (!found || found.revision !== revision) {
      throw new CanonicalStoreCorruptionError(`missing mutation revision ${revision} in ${sessionId}`)
    }
    return found
  }

  private readSparseIndex(sessionDir: string, sessionId: string): SparseIndex {
    const indexFile = path.join(sessionDir, 'sparse-index.json')
    if (!fs.existsSync(indexFile)) return emptySparseIndex(sessionId)
    const index = readJsonFile<SparseIndex>(indexFile)
    if (index.schemaVersion !== SCHEMA_VERSION || index.sessionId !== sessionId || index.segment !== SEGMENT_NAME) {
      throw new CanonicalStoreCorruptionError(`invalid sparse index for session ${sessionId}`)
    }
    return index
  }

  private readMessageState(sessionDir: string, messageId: string): MessageState | null {
    const suffix = `.${messageIdHash(messageId)}.json`
    const entry = this.listMessageStateFiles(sessionDir).find((candidate) => candidate.name.endsWith(suffix))
    if (!entry) return null
    const state = readJsonFile<MessageState>(path.join(this.messageStateDir(sessionDir), entry.name))
    if (state.messageId !== messageId) {
      throw new CanonicalStoreCorruptionError(`message state hash collision for ${messageId}`)
    }
    return state
  }

  private listMessageStateFiles(sessionDir: string): Array<{ name: string; sequence: number }> {
    const stateDir = this.messageStateDir(sessionDir)
    if (!fs.existsSync(stateDir)) return []
    return fs.readdirSync(stateDir)
      .map((name) => ({ name, match: /^(\d{16})\.[a-f0-9]{32}\.json$/.exec(name) }))
      .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match))
      .map((entry) => ({ name: entry.name, sequence: Number(entry.match[1]) }))
  }

  private quarantineCorruptSegment(sessionId: string, logFile: string, cause: unknown): never {
    const quarantineDir = path.join(this.rootDir, 'quarantine')
    fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 })
    const quarantined = path.join(quarantineDir, `${sessionDirName(sessionId)}-${Date.now()}-${SEGMENT_NAME}`)
    renameSyncWithRetry(logFile, quarantined)
    atomicWriteJson(path.join(this.sessionDir(sessionId), 'CORRUPT.json'), {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      quarantined,
      detectedAt: new Date().toISOString(),
      reason: cause instanceof Error ? cause.message : String(cause),
    })
    throw new CanonicalStoreCorruptionError(
      `canonical segment for ${sessionId} was quarantined at ${quarantined}`,
      { cause },
    )
  }

  private assertHealthy(sessionDir: string): void {
    const marker = path.join(sessionDir, 'CORRUPT.json')
    if (fs.existsSync(marker)) {
      throw new CanonicalStoreCorruptionError(`canonical session is quarantined: ${marker}`)
    }
  }
  private sessionDir(sessionId: string): string {
    return path.join(this.rootDir, 'sessions', sessionDirName(sessionId))
  }
  private messageStateDir(sessionDir: string): string {
    return path.join(sessionDir, 'messages')
  }
  private messageStateFile(sessionDir: string, sequence: number, messageId: string): string {
    return path.join(this.messageStateDir(sessionDir), `${String(sequence).padStart(16, '0')}.${messageIdHash(messageId)}.json`)
  }
}

function validateCommitInput(input: CanonicalCommitInput): void {
  if (!input.sessionId || !input.messageId) throw new CanonicalStoreError('sessionId and messageId are required')
  if (input.message && (input.message.id !== input.messageId || input.message.sessionId !== input.sessionId)) {
    throw new CanonicalStoreError('message identity does not match commit identity')
  }
  if (input.mutation !== 'tombstone' && !input.message) {
    throw new CanonicalStoreError(`${input.mutation} mutation requires a message`)
  }
}
function validateManifest(manifest: CanonicalManifest, sessionId: string, daemonInstallationId: string): void {
    if (manifest.daemonInstallationId !== daemonInstallationId) {
      throw new CanonicalStoreConflictError(
        `canonical session ${sessionId} belongs to a different daemon installation`,
      )
    }
    if (manifest.schemaVersion !== SCHEMA_VERSION
    || manifest.sessionId !== sessionId
    || manifest.segment !== SEGMENT_NAME || !Number.isSafeInteger(manifest.bodyRevision)
    || manifest.bodyRevision < 0) {
    throw new Error(`invalid canonical manifest for ${sessionId}`)
  }
}
function parseMutation(line: string, sessionId: string): CanonicalMutation {
  let mutation: CanonicalMutation
  try {
    mutation = JSON.parse(line) as CanonicalMutation
  } catch (cause) {
    throw new CanonicalStoreCorruptionError(`malformed canonical mutation in ${sessionId}`, { cause })
  }
  if (mutation.schemaVersion !== SCHEMA_VERSION || mutation.sessionId !== sessionId
    || !Number.isSafeInteger(mutation.revision) || mutation.revision < 1
    || !Number.isSafeInteger(mutation.sequence) || mutation.sequence < 1
    || !['append', 'upsert', 'tombstone'].includes(mutation.mutation)) {
    throw new CanonicalStoreCorruptionError(`invalid canonical mutation in ${sessionId}`)
  }
  return mutation
}
function emptyManifest(sessionId: string, daemonInstallationId: string): CanonicalManifest {
  return { schemaVersion: SCHEMA_VERSION, daemonInstallationId,
    sessionId, bodyRevision: 0, nextSequence: 1,
    firstAvailableSeq: null, lastAvailableSeq: null, mutationCount: 0,
    visibleMessageCount: 0, lastVisibleMessageId: null, lastBodyCommittedAt: null,
    segment: SEGMENT_NAME,
    logByteLength: 0, updatedAt: new Date(0).toISOString() }
}
function emptySparseIndex(sessionId: string): SparseIndex {
  return { schemaVersion: SCHEMA_VERSION, sessionId, segment: SEGMENT_NAME, entries: [] }
}
function emptyPage(): CanonicalHistoryPage {
  return {
    bodyRevision: 0,
    firstAvailableSeq: null,
    lastAvailableSeq: null,
    hasOlder: false,
    messages: [],
    entries: [],
  }
}
function normalizeLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new CanonicalStoreError('limit must be an integer between 1 and 500')
  }
  return limit
}
function sessionDirName(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex')
}
function messageIdHash(messageId: string): string {
  return crypto.createHash('sha256').update(messageId).digest('hex').slice(0, 32)
}
function mutationContentHash(input: CanonicalCommitInput): string {
  return crypto.createHash('sha256').update(JSON.stringify({ mutation: input.mutation,
    message: input.message ?? null, deliveryState: input.deliveryState ?? null })).digest('hex')
}
function deterministicMutationId(sessionId: string, messageId: string,
  mutation: CanonicalMutationType, previousContentHash: string, contentHash: string): string {
  return crypto.createHash('sha256')
    .update(`${sessionId}\0${messageId}\0${mutation}\0${previousContentHash}\0${contentHash}`)
    .digest('hex')
}
function appendAndSync(file: string, contents: string): number {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const fd = fs.openSync(file, 'a', 0o600)
  try {
    const offset = fs.fstatSync(fd).size
    fs.writeFileSync(fd, contents, 'utf8')
    fs.fsyncSync(fd)
    return offset
  } finally { fs.closeSync(fd) }
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
    syncDirectory(directory)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(temp) } catch {}
  }
}
function syncDirectory(directory: string): void {
  if (process.platform === 'win32') return
  const fd = fs.openSync(directory, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function readJsonFile<T>(file: string): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T }
  catch (cause) { throw new CanonicalStoreCorruptionError(`failed to read canonical JSON file ${file}`, { cause }) }
}
function readFileFromOffset(file: string, offset: number): string {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    if (offset >= size) return ''
    const buffer = Buffer.allocUnsafe(size - offset)
    fs.readSync(fd, buffer, 0, buffer.length, offset)
    return buffer.toString('utf8')
  } finally { fs.closeSync(fd) }
}
