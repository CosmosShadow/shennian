// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-parsers.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { listSessionRecords } from '../session/store.js'
import {
  knownInternalNativeSources,
  knownJournalInternalNativeSources,
  registerInternalNativeSource,
} from './source-visibility.js'
import type { CliRelayClient } from '../relay/client.js'
import { publishPendingSessionIndexes } from '../session/index-publisher.js'
import { NativeFusionFileWatcher } from './file-watcher.js'
import {
  NativeEventIdentityConflictError,
  NativeFusionLocalRepository,
} from './local-repository.js'
import {
  inspectNativeSessionFile,
  listClaudeTranscriptFiles,
  listCodexRolloutFiles,
  listNativeTranscriptRoots,
  listOpenCodeSessionFiles,
  lookupCodexThreadName,
  parseClaudeTranscriptChunkCooperatively,
  parseCodexRolloutChunkCooperatively,
  parseOpenCodeSessionFile,
} from './parsers.js'
import { loadNativeScannerState, saveNativeScannerState } from './state.js'
import { nativeFileIdentity, normalizeNativeFileIdentity } from './file-identity.js'
import type {
  ExternalOwnerObservation,
  ManagedSuppressionWindow,
  NativeFileCursor,
  ParsedNativeEvent,
  PendingManagedClaim,
} from './types.js'

const SCAN_INTERVAL_MS = 5 * 60_000
const CLAIM_TTL_MS = 2 * 60_000
const MANAGED_RUN_SUPPRESSION_TTL_MS = 30 * 60_000
const ACTIVE_SCAN_INTERVAL_MS = 2_000
const SCAN_YIELD_EVERY_FILES = 1
const COMMIT_YIELD_EVERY_EVENTS = 16
const EXTERNAL_ACTIVITY_HEARTBEAT_MS = 30_000
const EXTERNAL_OBSERVATION_TTL_MS = 4 * 60 * 60_000

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function isCodexRolloutPath(filePath: string): boolean {
  return filePath.split(/[\\/]+/).includes('.codex')
}

function fileMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

export class NativeSessionFusionService {
  private timer: ReturnType<typeof setInterval> | null = null
  private activeTimer: ReturnType<typeof setInterval> | null = null
  private scanPromise: Promise<void> | null = null
  private queuedTargetFiles = new Set<string>()
  private pendingBoundaryFiles = new Set<string>()
  private sourceFiles = new Map<string, string>()
  private fullScanQueued = false
  private watchEnabled = false
  private lifecycleRevision = 0
  private watcher = new NativeFusionFileWatcher((filePaths) => {
    void this.scanNow(filePaths).catch((error) => {
      console.error('[native-fusion] watched file scan failed', error)
    })
  })
  private pendingClaims: Map<string, PendingManagedClaim>
  private suppressionWindows: Map<string, ManagedSuppressionWindow>
  private externalObservations = new Map<string, ExternalOwnerObservation[]>()
  private externalTerminalHandler: ((sessionId: string, phase?: 'final' | 'error' | 'aborted') => void) | null = null
  private externalClaimHandler:
    | ((sessionId: string, canonicalMessageId: string) => void)
    | null = null
  private ignoredSources = new Set<string>()

  constructor(
    private client: CliRelayClient,
    private repository = new NativeFusionLocalRepository(),
  ) {
    const initialState = loadNativeScannerState()
    for (const owner of [
      ...knownInternalNativeSources(listSessionRecords()),
      ...knownJournalInternalNativeSources(initialState.daemonInstallationId),
    ]) {
      registerInternalNativeSource(owner.sessionId, owner.agentType, owner.sourceSessionKey)
    }
    this.ignoredSources = new Set(Object.keys(loadNativeScannerState().ignoredSources ?? {}))
    this.pendingClaims = new Map(
      (this.repository.listManagedClaims?.() ?? [])
        .map((claim) => [claim.canonicalMessageId, claim]),
    )
    this.suppressionWindows = new Map(
      (this.repository.listManagedSuppressions?.() ?? [])
        .map((window) => [sourceKey(window.agentType, window.sourceSessionKey), window]),
    )
  }

  /** Durably excludes short-lived validation/orchestration sessions from personal chat discovery. */
  ignoreNativeSource(agentType: string, sourceSessionKey: string): void {
    if (!['codex', 'claude', 'opencode'].includes(agentType) || !sourceSessionKey) return
    const key = sourceKey(agentType, sourceSessionKey)
    if (this.ignoredSources.has(key)) return
    this.ignoredSources.add(key)
    const state = loadNativeScannerState()
    for (const key of Object.keys(state.ignoredSources ?? {})) this.ignoredSources.add(key)
    state.ignoredSources = Object.fromEntries(
      [...this.ignoredSources].sort().map((key) => [key, true as const]),
    )
    saveNativeScannerState(state)
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.scanNow().catch((error) => {
        console.error('[native-fusion] periodic scan failed', error)
      })
    }, SCAN_INTERVAL_MS)
  }

  stop(): void {
    this.lifecycleRevision += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.activeTimer) clearInterval(this.activeTimer)
    this.activeTimer = null
    this.pendingBoundaryFiles.clear()
    this.watchEnabled = false
    this.watcher.stop()
  }

  setExternalTerminalHandler(handler: ((sessionId: string, phase?: 'final' | 'error' | 'aborted') => void) | null): void {
    this.externalTerminalHandler = handler
  }

  getActiveRuns(): Array<{ sessionId: string; runId: string }> {
    return [...this.externalObservations.values()].flatMap(observations => observations
      .filter(observation => observation.state === 'running')
      .map(({ sessionId, runId }) => ({ sessionId, runId })))
  }

  setExternalClaimHandler(
    handler: ((sessionId: string, canonicalMessageId: string) => void) | null,
  ): void {
    this.externalClaimHandler = handler
    if (!handler) return
    for (const observations of this.externalObservations.values()) {
      for (const observation of observations) {
        if (observation.state === 'running') {
          handler(observation.sessionId, observation.canonicalMessageId)
        }
      }
    }
  }

  restoreExternalObservation(params: {
    sessionId: string
    sourceSessionKey: string
    runId: string
    canonicalMessageId: string
    createdAt: number
  }): boolean {
    if (
      !params.sessionId || !params.sourceSessionKey || !params.runId ||
      !params.canonicalMessageId || !Number.isFinite(params.createdAt)
    ) return false

    const key = `codex:${params.sourceSessionKey}`
    const observations = this.externalObservations.get(key) ?? []
    if (observations.some((observation) => observation.runId === params.runId)) return true

    const now = Date.now()
    const restored: ExternalOwnerObservation = {
      ...params,
      // A retained claim means the queued submission has not appeared in the
      // native history yet. Otherwise its user boundary was already consumed
      // before restart and the Turn is running or terminal.
      state: this.pendingClaims.has(params.canonicalMessageId) ? 'queued' : 'running',
      createdAt: Math.min(params.createdAt, now),
      lastPublishedAt: now,
    }
    observations.push(restored)
    observations.sort((left, right) => left.createdAt - right.createdAt)
    this.externalObservations.set(key, observations)
    this.emitExternalActivity(restored, restored.state)
    if (restored.state === 'running') {
      this.externalClaimHandler?.(restored.sessionId, restored.canonicalMessageId)
    }
    // Startup restores this after deletion catch-up and before the normal
    // native scan. Arm the observer without racing that initial scan.
    this.ensureActiveScanning(false)
    return true
  }

  handleConnected(): void {
    const lifecycleRevision = ++this.lifecycleRevision
    this.watchEnabled = true
    void this.scanNow()
      .catch((error) => {
        console.error('[native-fusion] initial scan failed', error)
      })
      .finally(() => {
        if (this.lifecycleRevision === lifecycleRevision) this.start()
      })
  }

  registerManagedSend(params: {
    sessionId: string
    agentType: string
    sourceAgentType?: string | null
    canonicalMessageId?: string | null
    sourceSessionKey?: string | null
    text: string
    managedEchoPolicy?: 'suppress_following' | 'import_following'
    externalRunId?: string | null
  }): void {
    if (!params.canonicalMessageId) return
    const sourceAgentType = params.sourceAgentType ?? params.agentType
    if (
      sourceAgentType !== 'codex' &&
      sourceAgentType !== 'claude' &&
      sourceAgentType !== 'opencode'
    )
      return
    const claimKey = params.canonicalMessageId
    const existing = this.pendingClaims.get(claimKey)
    const textHash = normalizedTextHash(params.text)
    if (existing && (
      existing.sessionId !== params.sessionId
      || existing.sourceAgentType !== sourceAgentType
      || existing.textHash !== textHash
    )) {
      throw new Error(`managed echo claim identity conflict: ${claimKey}`)
    }
    const claim: PendingManagedClaim = {
      sessionId: params.sessionId,
      agentType: params.agentType,
      sourceAgentType,
      canonicalMessageId: params.canonicalMessageId,
      textHash,
      createdAt: existing?.createdAt ?? Date.now(),
      sourceSessionKey: params.sourceSessionKey ?? existing?.sourceSessionKey ?? null,
      managedEchoPolicy: params.managedEchoPolicy ?? 'suppress_following',
      externalRunId: params.externalRunId ?? null,
    }
    this.repository.upsertManagedClaim?.(claim)
    this.pendingClaims.set(claimKey, claim)
    if (params.externalRunId && params.sourceSessionKey) {
      const key = `${sourceAgentType}:${params.sourceSessionKey}`
      const observations = this.externalObservations.get(key) ?? []
      observations.push({
        sessionId: params.sessionId,
        sourceSessionKey: params.sourceSessionKey,
        runId: params.externalRunId,
        canonicalMessageId: params.canonicalMessageId,
        state: 'queued',
        createdAt: Date.now(),
        lastPublishedAt: Date.now(),
      })
      this.externalObservations.set(key, observations)
      this.emitExternalActivity(observations[observations.length - 1]!, 'queued')
      this.ensureActiveScanning()
    }
  }

  cancelManagedSend(canonicalMessageId: string): void {
    this.repository.removeManagedClaim?.(canonicalMessageId)
    this.pendingClaims.delete(canonicalMessageId)
  }

  noteManagedSourceSession(
    sessionId: string,
    agentType: string,
    sourceSessionKey: string | null,
  ): void {
    if (!sourceSessionKey) return
    this.repository.updateManagedClaimSource?.(sessionId, agentType, sourceSessionKey)
    for (const claim of this.pendingClaims.values()) {
      if (claim.sessionId === sessionId && claim.sourceAgentType === agentType) {
        claim.sourceSessionKey = sourceSessionKey
      }
    }
  }

  handleSessionDeleted(sessionId: string): void {
    for (const [key, claim] of this.pendingClaims.entries()) {
      if (claim.sessionId === sessionId) this.pendingClaims.delete(key)
    }
    for (const [key, window] of this.suppressionWindows.entries()) {
      if (window.sessionId === sessionId) this.suppressionWindows.delete(key)
    }
    for (const [key, observations] of this.externalObservations.entries()) {
      const remaining = observations.filter((observation) => observation.sessionId !== sessionId)
      if (remaining.length === 0) this.externalObservations.delete(key)
      else this.externalObservations.set(key, remaining)
    }
    this.repository.purgeSession(sessionId)
  }

  private ensureActiveScanning(runImmediately = true): void {
    if (this.activeTimer) return
    this.activeTimer = setInterval(() => {
      if (this.externalObservations.size === 0 && this.pendingBoundaryFiles.size === 0) {
        if (this.activeTimer) clearInterval(this.activeTimer)
        this.activeTimer = null
        return
      }
      this.scanActiveTargets()
    }, ACTIVE_SCAN_INTERVAL_MS)
    if (runImmediately) this.scanActiveTargets()
  }

  private scanActiveTargets(): void {
    const targets = this.activeScanTargets()
    // One in-flight full reconciliation is already locating an observation's
    // source. Do not queue another full pass every two seconds behind it.
    if (targets === undefined && this.scanPromise) return
    void this.scanNow(targets).catch((error) => {
      console.error('[native-fusion] active observation scan failed', error)
    })
  }

  private activeScanTargets(): string[] | undefined {
    const observedSourceKeys = [...this.externalObservations.keys()]
    if (observedSourceKeys.some((key) => !this.sourceFiles.has(key))) return undefined
    return [...new Set([
      ...this.pendingBoundaryFiles,
      ...observedSourceKeys.flatMap((key) => {
        const filePath = this.sourceFiles.get(key)
        return filePath ? [filePath] : []
      }),
    ])]
  }

  private emitExternalActivity(
    observation: ExternalOwnerObservation,
    lifecycle: 'queued' | 'running',
  ): void {
    this.client.sendAgentEvent({
      type: 'event',
      event: 'agent',
      id: `external-owner-${observation.runId}-${lifecycle}-${observation.lastPublishedAt}`,
      payload: {
        state: lifecycle === 'queued' ? 'start' : 'heartbeat',
        sessionId: observation.sessionId,
        runId: observation.runId,
        seq: lifecycle === 'queued' ? 0 : 1,
        runPhase: 'thinking',
        canStop: false,
        owner: 'external',
        ownerLabel: 'Codex Desktop',
        lifecycle,
      },
    })
  }

  private emitExternalTerminal(
    observation: ExternalOwnerObservation,
    terminalState: NonNullable<ParsedNativeEvent['terminalState']> = 'completed',
  ): void {
    const state = terminalState === 'completed'
      ? 'final'
      : terminalState === 'aborted'
        ? 'aborted'
        : 'error'
    this.client.sendAgentEvent({
      type: 'event',
      event: 'agent',
      id: `external-owner-${observation.runId}-${state}`,
      payload: {
        state,
        sessionId: observation.sessionId,
        runId: observation.runId,
        seq: 2,
        ...(state === 'error' ? { message: 'Codex Desktop turn failed' } : {}),
        owner: 'external',
        ownerLabel: 'Codex Desktop',
      },
    })
    // The relay event updates remote clients, but the local SessionManager also
    // owns the durable queue. Wake it explicitly so an externally-owned Codex
    // turn cannot leave the next mobile message queued forever.
    this.externalTerminalHandler?.(observation.sessionId, state)
  }

  private pruneState(): void {
    const now = Date.now()
    for (const [key, window] of this.suppressionWindows.entries()) {
      if (window.endsAt > now) continue
      this.repository.removeManagedSuppression?.(window.agentType, window.sourceSessionKey)
      this.suppressionWindows.delete(key)
    }
  }

  async scanNow(targetFiles?: readonly string[]): Promise<void> {
    if (this.client.getState() !== 'connected') return
    if (this.scanPromise) {
      const activeScan = this.scanPromise
      if (targetFiles) {
        for (const filePath of targetFiles) this.queuedTargetFiles.add(filePath)
      } else {
        this.fullScanQueued = true
      }
      await activeScan
      if (this.fullScanQueued) {
        this.fullScanQueued = false
        this.queuedTargetFiles.clear()
        return this.scanNow()
      }
      if (this.queuedTargetFiles.size > 0) {
        const queued = [...this.queuedTargetFiles]
        this.queuedTargetFiles.clear()
        return this.scanNow(queued)
      }
      return
    }
    this.scanPromise = this.runScanLoop(targetFiles).finally(() => {
      this.scanPromise = null
    })
    return this.scanPromise
  }

  private async runScanLoop(initialTargets?: readonly string[]): Promise<void> {
    let targets = initialTargets ? [...new Set(initialTargets)] : undefined
    while (true) {
      await this.runScan(targets)
      if (this.fullScanQueued) {
        await yieldToEventLoop()
        this.fullScanQueued = false
        this.queuedTargetFiles.clear()
        targets = undefined
        continue
      }
      if (this.queuedTargetFiles.size > 0) {
        await yieldToEventLoop()
        targets = [...this.queuedTargetFiles]
        this.queuedTargetFiles.clear()
        continue
      }
      return
    }
  }

  private async runScan(targetFiles?: readonly string[]): Promise<void> {
    this.pruneState()
    this.refreshExternalObservations()
    const state = loadNativeScannerState()
    for (const key of Object.keys(state.ignoredSources ?? {})) this.ignoredSources.add(key)
    state.ignoredSources = Object.fromEntries(
      [...this.ignoredSources].sort().map((key) => [key, true as const]),
    )
    const nextFilesState = { ...state.files }
    const observedTitles = new Map<string, ParsedNativeEvent>()
    let committedAnyBatch = false
    const commitBatch = (events: ParsedNativeEvent[]): Set<string> => {
      const quarantinedEventKeys = new Set<string>()
      const commit = (remaining: ParsedNativeEvent[]): void => {
        try {
          this.repository.commitEvents(remaining)
        } catch (error) {
          if (!(error instanceof NativeEventIdentityConflictError)) throw error
          const conflict = remaining.find((event) => event.sourceEventKey === error.sourceEventKey)
          if (!conflict) throw error
          quarantinedEventKeys.add(conflict.sourceEventKey)
          console.warn(`[native-fusion] quarantined conflicting native event ${conflict.sourceEventKey}`)
          const withoutConflict = remaining.filter((event) => event !== conflict)
          if (withoutConflict.length > 0) commit(withoutConflict)
        }
      }
      commit(events)
      return quarantinedEventKeys
    }
    const files = targetFiles
      ? [...targetFiles]
      : [
          ...listCodexRolloutFiles(),
          ...listClaudeTranscriptFiles(),
          ...listOpenCodeSessionFiles(),
        ].sort((left, right) => fileMtimeMs(right) - fileMtimeMs(left))
    if (!targetFiles && this.watchEnabled) this.watcher.refresh(files, listNativeTranscriptRoots())

    let fileIndex = 0
    let preferQueuedTarget = false
    while (files.length > 0 || (preferQueuedTarget && this.queuedTargetFiles.size > 0)) {
      let filePath: string | undefined
      if (preferQueuedTarget && this.queuedTargetFiles.size > 0) {
        filePath = [...this.queuedTargetFiles]
          .sort((left, right) => fileMtimeMs(right) - fileMtimeMs(left))[0]
        if (filePath) {
          this.queuedTargetFiles.delete(filePath)
          const duplicateIndex = files.indexOf(filePath)
          if (duplicateIndex >= 0) files.splice(duplicateIndex, 1)
        }
        preferQueuedTarget = false
      } else {
        filePath = files.shift()
        preferQueuedTarget = true
      }
      if (!filePath) break
      if (fileIndex > 0 && fileIndex % SCAN_YIELD_EVERY_FILES === 0) {
        await yieldToEventLoop()
      }
      fileIndex += 1
      if (!fs.existsSync(filePath)) {
        if (this.watchEnabled) this.watcher.untrackFile(filePath)
        this.pendingBoundaryFiles.delete(filePath)
        for (const [key, mappedPath] of this.sourceFiles.entries()) {
          if (mappedPath === filePath) this.sourceFiles.delete(key)
        }
        continue
      }
      if (this.watchEnabled) this.watcher.trackFile(filePath)
      const stat = fs.statSync(filePath)
      const isCodex = isCodexRolloutPath(filePath)
      const isOpenCode = filePath.endsWith('.opencode-session.json')
      let current: NativeFileCursor | undefined = state.files[filePath]
      const fileIdentity = nativeFileIdentity(stat)
      const storedIdentity = current?.fileIdentity
        ? normalizeNativeFileIdentity(current.fileIdentity)
        : undefined
      let isNewFile = !current
      if (current && !isOpenCode && (
        stat.size < current.offset
        || (storedIdentity && storedIdentity !== fileIdentity)
      )) {
        current = undefined
        isNewFile = true
      }
      const unchanged = Boolean(
        current
        && storedIdentity === fileIdentity
        && current.mtimeMs === stat.mtimeMs
        && current.offset >= stat.size
        && current.sources?.length,
      )
      if (unchanged && current) {
        for (const source of current.sources ?? []) {
          this.sourceFiles.set(sourceKey(source.agentType, source.sourceSessionKey), filePath)
        }
        if (current.classification === 'live' && current.awaitingUserBoundary) {
          this.pendingBoundaryFiles.add(filePath)
        } else {
          this.pendingBoundaryFiles.delete(filePath)
        }
        continue
      }
      const inspection = current?.sources?.length && !isOpenCode
        ? {
            status: 'ready' as const,
            createdAtMs: current.sessionCreatedAtMs ?? stat.birthtimeMs,
            sources: current.sources,
          }
        : inspectNativeSessionFile(filePath)
      if (inspection.status === 'pending') {
        if (stat.birthtimeMs >= state.fusionEpochMs) this.pendingBoundaryFiles.add(filePath)
        continue
      }
      for (const source of inspection.sources) {
        this.sourceFiles.set(sourceKey(source.agentType, source.sourceSessionKey), filePath)
      }
      if (
        !isOpenCode
        && inspection.sources.length > 0
        && inspection.sources.every((source) => (
          this.repository.isSourceDeleted?.(source.agentType, source.sourceSessionKey)
          || this.repository.isSourceInternal?.(source.agentType, source.sourceSessionKey)
          || this.ignoredSources.has(sourceKey(source.agentType, source.sourceSessionKey))
        ))
      ) {
        nextFilesState[filePath] = {
          ...(current ?? {
            daemonInstallationId: state.daemonInstallationId,
            classification: inspection.createdAtMs >= state.fusionEpochMs ? 'live' : 'historical',
            awaitingUserBoundary: true,
            sessionCreatedAtMs: inspection.createdAtMs,
            sourceBoundaryEstablished: {},
          }),
          offset: stat.size,
          mtimeMs: stat.mtimeMs,
          fileIdentity,
        }
        continue
      }
      if (!current) {
        current = {
          daemonInstallationId: state.daemonInstallationId,
          offset: 0,
          mtimeMs: stat.mtimeMs,
          classification: inspection.createdAtMs >= state.fusionEpochMs ? 'live' : 'historical',
          awaitingUserBoundary: true,
          sessionCreatedAtMs: inspection.createdAtMs,
          sourceBoundaryEstablished: {},
        }
      } else if (isOpenCode && current.mtimeMs === stat.mtimeMs) {
        continue
      }

      const startOffset = isOpenCode ? 0 : current.offset
      let parsed: { nextOffset: number; events: ParsedNativeEvent[] }
      try {
        parsed = isOpenCode
          ? parseOpenCodeSessionFile(filePath, startOffset)
          : isCodex
            ? await parseCodexRolloutChunkCooperatively(filePath, startOffset)
            : await parseClaudeTranscriptChunkCooperatively(filePath, startOffset)
        if (!isOpenCode && parsed.nextOffset < startOffset) {
          throw new Error('native transcript cursor moved backwards')
        }
      } catch (error) {
        console.error('[native-fusion] target file scan failed; isolated for retry', error)
        continue
      }
      let acceptedEvents: ParsedNativeEvent[]
      let nextFileState: NativeFileCursor
      if (isOpenCode) {
        const planned = planOpenCodeSnapshot(
          parsed.events,
          current,
          state.fusionEpochMs,
          isNewFile,
          stat.mtimeMs,
          parsed.nextOffset,
        )
        acceptedEvents = planned.events
        nextFileState = planned.cursor
      } else if (isNewFile && current.classification === 'historical') {
        acceptedEvents = []
        nextFileState = {
          ...current,
          offset: parsed.nextOffset,
          mtimeMs: stat.mtimeMs,
          awaitingUserBoundary: true,
        }
      } else {
        const planned = planJsonlEvents(parsed.events, current, parsed.nextOffset, stat.mtimeMs)
        acceptedEvents = planned.events
        nextFileState = planned.cursor
      }
      nextFileState.fileIdentity = fileIdentity
      nextFileState.sources = inspection.sources

      const fileBatches: ParsedNativeEvent[] = []
      const fileClaimTransitions = new Map<string, ManagedSuppressionWindow | null>()
      const stagedSuppressions = new Map<string, {
        window: ManagedSuppressionWindow
        claimKey: string
      }>()
      for (const event of acceptedEvents) {
        if (this.ignoredSources.has(sourceKey(event.agentType, event.sourceSessionKey))) continue
        if (this.repository.isSourceDeleted?.(event.agentType, event.sourceSessionKey)) continue
        if (this.repository.isSourceInternal?.(event.agentType, event.sourceSessionKey)) continue
        const claimed = this.tryClaimManagedEcho(event)
        if (claimed) {
          fileBatches.push(claimed.event)
          fileClaimTransitions.set(claimed.claimKey, claimed.suppression ?? null)
          if (claimed.suppression) {
            stagedSuppressions.set(
              sourceKey(claimed.suppression.agentType, claimed.suppression.sourceSessionKey),
              { window: claimed.suppression, claimKey: claimed.claimKey },
            )
          }
          continue
        }
        const suppression = this.suppressionFor(event, stagedSuppressions, fileClaimTransitions)
        if (suppression) {
          fileBatches.push({
            ...event,
            claimSessionId: suppression.sessionId,
            localDisposition: 'managed_echo_suppressed',
          })
          continue
        }
        fileBatches.push(event)
      }

      const orderedFileBatches = fileBatches.sort((left, right) => left.ts - right.ts)
      const quarantinedEventKeys = new Set<string>()
      try {
        for (let start = 0; start < orderedFileBatches.length; start += COMMIT_YIELD_EVERY_EVENTS) {
          const quarantined = commitBatch(
            orderedFileBatches.slice(start, start + COMMIT_YIELD_EVERY_EVENTS),
          )
          for (const eventKey of quarantined) quarantinedEventKeys.add(eventKey)
          committedAnyBatch = true
          if (start + COMMIT_YIELD_EVERY_EVENTS < orderedFileBatches.length) {
            await yieldToEventLoop()
          }
        }
      } catch (error) {
        console.error('[native-fusion] target file commit failed; isolated for retry', error)
        continue
      }

      const quarantinedClaimKeys = new Set(
        orderedFileBatches
          .filter((event) => quarantinedEventKeys.has(event.sourceEventKey))
          .flatMap((event) => event.claimCanonicalMessageId ? [event.claimCanonicalMessageId] : []),
      )
      for (const [claimKey, suppression] of fileClaimTransitions) {
        if (quarantinedClaimKeys.has(claimKey)) continue
        this.repository.completeManagedClaim?.(claimKey, suppression ?? undefined)
        this.pendingClaims.delete(claimKey)
        if (suppression) {
          this.suppressionWindows.set(
            sourceKey(suppression.agentType, suppression.sourceSessionKey),
            suppression,
          )
        }
      }
      for (const event of parsed.events) {
        if (this.ignoredSources.has(sourceKey(event.agentType, event.sourceSessionKey))) continue
        if (this.repository.isSourceDeleted?.(event.agentType, event.sourceSessionKey)) continue
        if (this.repository.isSourceInternal?.(event.agentType, event.sourceSessionKey)) continue
        if (event.title?.trim() && event.titleSource === 'agent_native') {
          observedTitles.set(`${event.agentType}:${event.sourceSessionKey}`, event)
        }
      }
      for (const event of orderedFileBatches) {
        if (!quarantinedEventKeys.has(event.sourceEventKey)) this.observeExternalLifecycle(event)
      }

      nextFilesState[filePath] = nextFileState
      state.files = nextFilesState
      saveNativeScannerState(state)
      if (nextFileState.classification === 'live' && nextFileState.awaitingUserBoundary) {
        this.pendingBoundaryFiles.add(filePath)
      } else {
        this.pendingBoundaryFiles.delete(filePath)
      }
      if (orderedFileBatches.length > 0) {
        await publishPendingSessionIndexes(this.client).catch((error) => {
          console.error('[native-fusion] index projection sync failed; retained for retry', error)
        })
      }
    }

    if (!committedAnyBatch) this.repository.commitEvents([])
    for (const event of observedTitles.values()) {
      this.repository.observeNativeTitle(event.agentType, event.sourceSessionKey, event.title ?? '')
    }
    for (const binding of this.repository.listSourceBindings()) {
      if (binding.agentType !== 'codex') continue
      const title = lookupCodexThreadName(binding.sourceSessionKey)
      if (title) this.repository.observeNativeTitle('codex', binding.sourceSessionKey, title)
    }

    state.files = nextFilesState
    saveNativeScannerState(state)
    if (this.pendingBoundaryFiles.size > 0) this.ensureActiveScanning(false)
    this.repository.repairMissingUserBoundaries?.()
    await publishPendingSessionIndexes(this.client).catch((error) => {
      console.error('[native-fusion] index projection sync failed; retained for retry', error)
    })
  }

  private refreshExternalObservations(): void {
    const now = Date.now()
    for (const [key, observations] of this.externalObservations.entries()) {
      const active = observations.filter(
        (observation) => now - observation.createdAt < EXTERNAL_OBSERVATION_TTL_MS,
      )
      if (active.length === 0) {
        this.externalObservations.delete(key)
        continue
      }
      this.externalObservations.set(key, active)
      const current = active[0]!
      if (now - current.lastPublishedAt < EXTERNAL_ACTIVITY_HEARTBEAT_MS) continue
      current.lastPublishedAt = now
      this.emitExternalActivity(current, current.state)
    }
  }

  private tryClaimManagedEcho(event: ParsedNativeEvent): {
    event: ParsedNativeEvent
    claimKey: string
    suppression?: ManagedSuppressionWindow
  } | null {
    const now = Date.now()
    for (const [claimKey, claim] of this.pendingClaims.entries()) {
      if (claim.sourceAgentType !== event.agentType) continue
      if (event.role !== 'user') continue
      if (!claim.sourceSessionKey) continue
      if (claim.sourceSessionKey !== event.sourceSessionKey) continue
      const claimWindowMs = claim.externalRunId ? EXTERNAL_OBSERVATION_TTL_MS : CLAIM_TTL_MS
      if (Math.abs(event.ts - claim.createdAt) > claimWindowMs) continue
      if (normalizedTextHash(event.payload) !== claim.textHash) continue

      const suppression = claim.managedEchoPolicy === 'suppress_following'
        ? {
            sessionId: claim.sessionId,
            agentType: event.agentType,
            sourceSessionKey: event.sourceSessionKey,
            claimSourceEventKey: event.sourceEventKey,
            startedAt: event.ts,
            endsAt: Math.max(now, event.ts) + MANAGED_RUN_SUPPRESSION_TTL_MS,
          } satisfies ManagedSuppressionWindow
        : undefined
      return {
        claimKey,
        suppression,
        event: {
          ...event,
          sourceMode: 'managed_echo_claim',
          claimCanonicalMessageId: claim.canonicalMessageId,
          claimSessionId: claim.sessionId,
          managedEchoPolicy: claim.managedEchoPolicy,
        },
      }
    }
    return null
  }

  private observeExternalLifecycle(event: ParsedNativeEvent): void {
    const key = `${event.agentType}:${event.sourceSessionKey}`
    const observations = this.externalObservations.get(key)
    if (!observations?.length) return

    const current = observations[0]!
    if (
      event.claimCanonicalMessageId === current.canonicalMessageId &&
      current.state === 'queued'
    ) {
      this.repository.updateMessageDeliveryState(
        current.sessionId,
        current.canonicalMessageId,
        'executing',
      )
      this.externalClaimHandler?.(current.sessionId, current.canonicalMessageId)
      current.state = 'running'
      current.lastPublishedAt = Date.now()
      this.emitExternalActivity(current, 'running')
    }
    if (!event.terminal || current.state !== 'running') return

    const terminalState = event.terminalState ?? 'completed'
    this.repository.updateMessageDeliveryState(
      current.sessionId,
      current.canonicalMessageId,
      terminalState === 'aborted'
        ? 'cancelled'
        : terminalState === 'failed'
          ? 'failed'
          : 'completed',
    )
    this.emitExternalTerminal(current, terminalState)
    observations.shift()
    if (observations.length === 0) {
      this.externalObservations.delete(key)
    } else {
      this.externalObservations.set(key, observations)
      observations[0]!.lastPublishedAt = Date.now()
      this.emitExternalActivity(observations[0]!, 'queued')
    }
  }

  private suppressionFor(
    event: ParsedNativeEvent,
    staged: Map<string, { window: ManagedSuppressionWindow; claimKey: string }>,
    transitions: Map<string, ManagedSuppressionWindow | null>,
  ): ManagedSuppressionWindow | null {
    const key = sourceKey(event.agentType, event.sourceSessionKey)
    const stagedEntry = staged.get(key)
    const window = stagedEntry?.window ?? this.suppressionWindows.get(key)
    if (!window || event.ts < window.startedAt) return null
    if (event.ts > window.endsAt) {
      this.clearSuppression(key, window, stagedEntry, staged, transitions)
      return null
    }
    if (event.role === 'user') {
      // A cursor rollback may replay the user event that established this
      // suppression window. It is not a new terminal-authored turn and must
      // not release suppression for agent output that arrived after the crash.
      if (event.sourceEventKey === window.claimSourceEventKey) return null
      this.clearSuppression(key, window, stagedEntry, staged, transitions)
      return null
    }
    return window
  }

  private clearSuppression(
    key: string,
    window: ManagedSuppressionWindow,
    stagedEntry: { window: ManagedSuppressionWindow; claimKey: string } | undefined,
    staged: Map<string, { window: ManagedSuppressionWindow; claimKey: string }>,
    transitions: Map<string, ManagedSuppressionWindow | null>,
  ): void {
    if (stagedEntry) {
      staged.delete(key)
      transitions.set(stagedEntry.claimKey, null)
      return
    }
    this.repository.removeManagedSuppression?.(window.agentType, window.sourceSessionKey)
    this.suppressionWindows.delete(key)
  }
}

function normalizedTextHash(text: string): string {
  return crypto.createHash('sha256').update(normalizeText(text)).digest('hex')
}

function sourceKey(agentType: string, sourceSessionKey: string): string {
  return `${agentType}:${sourceSessionKey}`
}

function planJsonlEvents(
  events: ParsedNativeEvent[],
  current: NativeFileCursor,
  nextOffset: number,
  mtimeMs: number,
): { events: ParsedNativeEvent[]; cursor: NativeFileCursor } {
  if (!current.awaitingUserBoundary) {
    return { events, cursor: { ...current, offset: nextOffset, mtimeMs } }
  }
  if (events.length === 0) {
    return {
      events: [],
      cursor: { ...current, offset: nextOffset, mtimeMs, awaitingUserBoundary: true },
    }
  }
  const userBoundary = events.findIndex((event) => event.role === 'user')
  if (userBoundary < 0) {
    return { events: [], cursor: { ...current, mtimeMs, awaitingUserBoundary: true } }
  }
  return {
    events: events.slice(userBoundary),
    cursor: { ...current, offset: nextOffset, mtimeMs, awaitingUserBoundary: false },
  }
}

function planOpenCodeSnapshot(
  events: ParsedNativeEvent[],
  current: NativeFileCursor,
  fusionEpochMs: number,
  isNewFile: boolean,
  mtimeMs: number,
  nextOffset: number,
): { events: ParsedNativeEvent[]; cursor: NativeFileCursor } {
  const established = { ...(current.sourceBoundaryEstablished ?? {}) }
  const watermarkTs = current.eventWatermarkTs ?? -1
  const keysAtWatermark = new Set(current.eventKeysAtWatermark ?? [])
  const candidates = isNewFile
    ? events
    : events.filter((event) => event.ts > watermarkTs
      || (event.ts === watermarkTs && !keysAtWatermark.has(event.sourceEventKey)))
  const accepted: ParsedNativeEvent[] = []
  for (const event of candidates) {
    const sourceKey = event.sourceSessionKey
    if (established[sourceKey]) {
      accepted.push(event)
      continue
    }
    const sourceIsLive = !isNewFile || (event.sourceSessionCreatedAtMs ?? 0) >= fusionEpochMs
    if (!sourceIsLive || event.role !== 'user') continue
    established[sourceKey] = true
    accepted.push(event)
  }
  const maxTimestamp = events.reduce((maximum, event) => Math.max(maximum, event.ts), watermarkTs)
  const nextKeySet = new Set(maxTimestamp === watermarkTs ? current.eventKeysAtWatermark ?? [] : [])
  for (const event of events) {
    if (event.ts === maxTimestamp) nextKeySet.add(event.sourceEventKey)
  }
  return {
    events: accepted,
    cursor: {
      ...current,
      offset: nextOffset,
      mtimeMs,
      eventWatermarkTs: maxTimestamp >= 0 ? maxTimestamp : undefined,
      eventKeysAtWatermark: maxTimestamp >= 0 ? [...nextKeySet] : undefined,
      sourceBoundaryEstablished: established,
    },
  }
}
