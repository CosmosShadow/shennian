// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-store.test.ts
// @test src/__tests__/model-switching.test.ts
import { type ReqFrame, type SessionDeletionCommand } from '@shennian/wire'
import crypto from 'node:crypto'
import { coordinationCommand, coordinationEnabled, startProjectCoordinators, stopProjectCoordinators, projectCoordinatorsBusy, noteCoordinationEvent } from '../project-coordination/runtime.js'
import { ProjectWorkbenchRegistry } from '../project-coordination/http.js'
import { getRegisteredAgents, unregisterAgent } from '../agents/adapter.js'
import { resetCommandSpecCache } from '../agents/command-spec.js'
import type { CliRelayClient } from '../relay/client.js'
import { loadConfig } from '../config/index.js'
import { handleUpgradeStart, handleUpgradeStatus } from '../commands/upgrade.js'
import {
  handleAgentsRefresh,
  handleModelsRefresh,
  refreshMachineAgents,
} from './handlers/agents.js'
import { AcpDiscoveryWatcher } from '../agents/acp/watcher.js'
import { handleAgentCapabilitiesList } from './handlers/agent-capabilities.js'
import {
  handleAgentConfigClear,
  handleAgentConfigGet,
  handleAgentConfigTest,
  handleAgentConfigUpsert,
} from './handlers/agent-config.js'
import { handleCodexSettings } from './handlers/codex-settings.js'
import { handleChatAbort, handleChatSend } from './handlers/chat.js'
import { recoverJournaledRun } from './handlers/chat-recovery.js'
import { handleSessionRefresh } from './handlers/session-refresh.js'
import { handleSessionToolDetail } from './handlers/tool-detail.js'
import { handleSessionTitleSet } from './handlers/title.js'
import { handleSessionMessageStatus } from './handlers/message-status.js'
import { handleAgentWorkspaceValidation } from './handlers/agent-workspace-validation.js'
import { handleVoiceSessionBodyWindow } from './handlers/voice-window.js'
import { commitStewardSay, commitTerminalStewardSay } from './handlers/steward.js'
import { handlePersonalRequest } from './handlers/personal.js'
import { handleRemoteAccessPause } from './handlers/remote-access.js'
import {
  cleanupPendingTransfers,
  handleFsLs,
  handleFsRead,
  handleFsRename,
  handleFsWrite,
  handleFsTransferAbort,
  handleFsTransferChunk,
  handleFsTransferFinish,
  handleFsTransferStart,
  handleFsExportMarkdownPdf,
  handleFsExportMarkdownPdfSetup,
  handleFsArchiveZip,
} from './handlers/fs.js'
import {
  handleRegionProbe,
  handleRegionSwitch,
  handleUpgradeSetPolicy,
} from './handlers/control.js'
import type {
  ActiveSession,
  PendingTransfer,
  SessionManagerRuntime,
  RemoteAccessPauseController,
  UpgradePolicyController,
} from './types.js'
import type { UpgradeIdleState } from '../upgrade/scheduler.js'
import type { NativeSessionFusionService } from '../native-fusion/service.js'
import {
  ManagerRuntimeService,
  setManagerRuntimeService,
  type LocalReqDispatchResult,
} from '../manager/runtime.js'
import {
  ChatQueueManager,
  type ManagedRoomEnqueueParams,
  type ManagedRoomQueueContext,
  type PreparedManagedRoomTurn,
  type ManagedAgentDirectTurnPreparer,
} from './queue.js'
import {
  createAuthorizedFsRoot,
  createAuthorizedFsRootAsync,
  resolveAuthorizedPath,
  resolveAuthorizedPathAsync,
  resolveSessionWorkDir,
} from '../fs/boundary.js'
// Side-effect imports to register built-in agent adapters.
import '../agents/claude.js'
import '../agents/codex.js'
import '../agents/workbuddy.js'
import '../agents/gemini.js'
import '../agents/cursor.js'
// OpenClaw support is intentionally disabled.
import '../agents/opencode.js'
import '../agents/pi-coding-agent.js'
import '../agents/shennian.js'
import '../agents/manager.js'
import { registerCustomAgent } from '../agents/custom.js'
import { listNodeAdapters } from '../adapter-kit/registry.js'
import { syncNodeAdapterAgents } from '../agents/node-adapter.js'
import type { ManagedRoomBinder } from '../room/managed-room-binding.js'
import {
  bindManagedRoom,
  handleManagedRoomBind,
  handleManagedRoomRestart,
  discardPreBindingSession,
} from './handlers/room-managed.js'
import {
  getDaemonInstallationId,
  listSessionRecords,
  purgeCanonicalSession,
  purgeSessionRecord,
  recordSession,
  upsertMessage,
} from './store.js'
import { requestSessionIndexPublish } from './index-publisher.js'
import { checkRunStalls } from './run-stall.js'
import { reportUpgradeAggregateMetric } from '../log-reporter.js'
import { PersonalHistorySubscriptions } from './history-subscriptions.js'
import { startAttachmentCleanupLoop } from './attachment-cleanup-loop.js'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
import { collectLocalNativeSources } from '../native-fusion/session-native-sources.js'
import { purgeToolDetails } from './tool-detail-store.js'
import { NativeSessionCleanupOutbox } from './native-cleanup-outbox.js'
import { assertPersonalSyncIdentity } from '../personal-sync/epoch.js'
import type { ManagedManagerExecutor, ManagedRoomExecutor } from '../room/managed-room-ipc.js'
import { ActiveRunJournal } from './run-recovery/journal.js'
import { RunRecoveryBarrier } from './run-recovery/barrier.js'
import { RunRecoveryCoordinator, type RecoveryTerminal } from './run-recovery/coordinator.js'
import type { RunJournalRecord } from './run-recovery/schema.js'
import { ProjectFsHandleStore } from './project-fs-store.js'
import {
  handleProjectFsRequest,
  type TrustedProjectFsRequestResolver,
} from './handlers/project-fs.js'
import { handleAgentPermissionResponse, handleAcpAgentRequest } from './handlers/agent-control.js'
import { SessionDeletionSynchronizer } from './deletion-synchronizer.js'
import {
  dispatchManagedChat,
  dispatchQueuedChat,
  interruptQueuedChat,
} from './queued-chat-dispatch.js'
const MAX_SESSIONS = 50
export { resolveSessionWorkDir } from '../fs/boundary.js'
export function upgradeRecoveryVisibleMessage(): string {
  return '神念升级中断了本次运行。已完成的回复或操作仍然有效，未完成部分可重试。原会话已保留。'
}

export class SessionManager {
  scheduleHandler?: (req: ReqFrame) => Promise<void>
  getScheduleQueue() {
    return this.chatQueue
  }
  private sessions = new Map<string, ActiveSession>()
  /** Track processed request IDs to deduplicate replayed offline messages */
  private processedReqIds = new Set<string>()
  /** Accumulate agent text per run for messageSummary on final event */
  private runTextAcc = new Map<string, string>()
  /** In-flight chunked uploads: transferId → metadata */
  private pendingTransfers = new Map<string, PendingTransfer>()
  private managerRuntime: ManagerRuntimeService
  private chatQueue: ChatQueueManager
  private historySubscriptions: PersonalHistorySubscriptions
  private nativeCleanupOutbox: NativeSessionCleanupOutbox
  private activityProbeTimer: ReturnType<typeof setInterval> | null = null
  private stopAttachmentCleanup: (() => void) | null = null
  private activeRequests = 0
  private acpDiscoveryWatcher: AcpDiscoveryWatcher
  private runJournal: ActiveRunJournal
  private recoveryBarrier = new RunRecoveryBarrier()
  private recoveryCoordinator: RunRecoveryCoordinator
  private recoveryPass: Promise<void> | null = null
  private prepareManagedRecovery: SessionManagerRuntime['prepareManagedRecovery']
  private projectFsHandleStore = new ProjectFsHandleStore()
  private deletionSynchronizer: SessionDeletionSynchronizer
  constructor(
    private client: CliRelayClient,
    private nativeFusion: NativeSessionFusionService | null = null,
    private cliVersion?: string,
    private upgradePolicyController: UpgradePolicyController | null = null,
    private managedRoomBinder: ManagedRoomBinder | null = null,
    private remoteAccessPauseController: RemoteAccessPauseController | null = null,
    private managedRoomContextRevoker: ((token: string) => void) | null = null,
    private managedRoomExecutor: ManagedRoomExecutor | null = null,
    runJournalOverride: ActiveRunJournal | null = null,
    private trustedProjectFsRequestResolver: TrustedProjectFsRequestResolver | null = null,
    private getAgentSnapshot: (() => import('@shennian/wire').AgentInfo[]) | null = null,
  ) {
    this.runJournal = runJournalOverride ?? new ActiveRunJournal(getDaemonInstallationId())
    startProjectCoordinators()
    for (const record of this.runJournal.loadPendingReconciliation().records) {
      this.recoveryBarrier.begin(record.sessionId)
    }
    this.recoveryCoordinator = new RunRecoveryCoordinator({
      journal: this.runJournal,
      barrier: this.recoveryBarrier,
      recover: (record, beforeContinueDispatch) =>
        recoverJournaledRun(this.getRuntime(), record, beforeContinueDispatch),
      commitTerminal: (record, result) => this.commitRecoveryTerminal(record, result),
      isCanonicalTerminal: (record) => {
        const local = listSessionRecords().find((entry) => entry.sessionId === record.sessionId)
        const terminalAttentionId = `terminal:${crypto
          .createHash('sha256')
          .update(`${record.runId}\0`)
          .digest('hex')}`
        return local?.lastAttentionId === terminalAttentionId
      },
      onOutcome: (outcome) =>
        reportUpgradeAggregateMetric({
          kind: 'recovery',
          adapterType: outcome.adapterType,
          result: outcome.result,
          stage:
            outcome.result === 'continued'
              ? 'continue'
              : outcome.result === 'reattached'
                ? 'reattach'
                : outcome.result === 'resumed'
                  ? 'resume'
                  : outcome.result === 'terminal_reconciled'
                    ? 'inspect'
                    : 'terminal',
          durationMs: outcome.durationMs,
          retries: Math.max(0, outcome.attempts - 1),
          ...(outcome.reason ? { errorCode: outcome.reason } : {}),
        }),
    })
    this.managerRuntime = new ManagerRuntimeService({
      getRuntime: () => this.getRuntime(),
      getAgentSnapshot: this.getAgentSnapshot ?? undefined,
      // Manager inbox delivery is an internal transaction. Let thrown request
      // failures reach ManagerRuntime so it can retain the durable inbox item.
      dispatchReq: (req) => this.handleReq(req, { propagateErrors: true }),
    })
    this.chatQueue = new ChatQueueManager({
      getRuntime: () => this.getRuntime(),
      dispatchReq: (req) => this.handleReq(req),
      dispatchManagedReq: (req, prepared) => dispatchManagedChat(this.getRuntime(), req, prepared),
      dispatchQueuedReq: (req, prepared) => dispatchQueuedChat(this.getRuntime(), req, prepared),
      interruptQueuedSession: (sessionId) => interruptQueuedChat(this.getRuntime(), sessionId),
    })
    this.deletionSynchronizer = new SessionDeletionSynchronizer(client, (deletion) =>
      this.applySessionDeletion(deletion),
    )
    this.historySubscriptions = new PersonalHistorySubscriptions(this.client)
    this.nativeCleanupOutbox = new NativeSessionCleanupOutbox({ logger: console.info })
    this.acpDiscoveryWatcher = new AcpDiscoveryWatcher(async () => {
      resetCommandSpecCache()
      await refreshMachineAgents(this.getRuntime())
    })
    this.nativeFusion?.setExternalTerminalHandler?.((sessionId, phase) => {
      void this.handleExternalTerminal(sessionId, phase)
    })
    this.nativeFusion?.setExternalClaimHandler?.((sessionId, canonicalMessageId) => {
      this.chatQueue.noteExternalClaim(sessionId, canonicalMessageId)
    })
    this.nativeCleanupOutbox.start()
    setManagerRuntimeService(this.managerRuntime)
    void this.managerRuntime.start()
    this.reloadCustomAgents()
    try {
      this.acpDiscoveryWatcher.start()
    } catch (error) {
      console.warn(
        `[acp.discovery] watcher unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    this.activityProbeTimer = setInterval(() => {
      checkRunStalls(this.sessions.entries(), () => requestSessionIndexPublish(this.client))
      void this.publishManagedActivitySnapshots().catch((error) => {
        console.error('[session.activity] managed probe failed', error)
      })
    }, 15_000)
    this.activityProbeTimer.unref?.()
    this.stopAttachmentCleanup = startAttachmentCleanupLoop({
      getRoots: () => [
        ...listSessionRecords().map(record => this.resolvePath(record.workDir)),
        ...Array.from(this.pendingTransfers.values()).map(transfer => this.resolvePath(transfer.rootPath)),
      ],
      onError: error => console.error('[attachment.cleanup] failed',
        error instanceof Error ? error.message : String(error)),
    })
  }
  executeManagedManagerAction(input: Parameters<ManagedManagerExecutor>[0]) {
    return this.managerRuntime.executeScopedWorkerAction(
      input.managerSessionId,
      input.action,
      input.params,
      input.roomOrigin,
    )
  }
  noteManagedRoomSendOutcome(input: { token: string; ok: boolean; errorCode?: string }): void {
    for (const session of this.sessions.values()) {
      if (session.managedRoomContextToken !== input.token) continue
      const outcome = session.roomSendOutcome ?? (session.roomSendOutcome = { successes: 0, failureCodes: [] })
      if (input.ok) outcome.successes += 1
      else if (outcome.failureCodes.length < 20) outcome.failureCodes.push(input.errorCode ?? 'managed_room_action_failed')
      return
    }
  }
  getManagedRoomActiveRunId(token: string, bindingSessionId: string): string | null {
    const bindingSession = this.sessions.get(bindingSessionId)
    if (bindingSession?.currentRunId) return bindingSession.currentRunId
    for (const session of this.sessions.values()) {
      if (session.managedRoomContextToken === token) return session.currentRunId ?? null
    }
    return null
  }
  private getRuntime(): SessionManagerRuntime {
    return {
      client: this.client,
      pendingTransfers: this.pendingTransfers,
      processedReqIds: this.processedReqIds,
      reloadCustomAgents: () => this.reloadCustomAgents(),
      getAgentSnapshot: this.getAgentSnapshot ?? undefined,
      resolvePath: (pathValue) => this.resolvePath(pathValue),
      resolveAuthorizedPath: (pathValue, rootPath) =>
        this.resolveAuthorizedPath(pathValue, rootPath),
      resolveAuthorizedPathAsync: (pathValue, rootPath) =>
        this.resolveAuthorizedPathAsync(pathValue, rootPath),
      runTextAcc: this.runTextAcc,
      sessions: this.sessions,
      evictIdleSessions: () => this.evictIdleSessions(),
      nativeFusion: this.nativeFusion,
      managerRuntime: this.managerRuntime,
      chatQueue: this.chatQueue,
      activityPublisher: {
        publish: (sessionId, activity) => this.publishSessionActivity(sessionId, activity),
      },
      upgradePolicyController: this.upgradePolicyController,
      revokeManagedRoomContextToken: this.managedRoomContextRevoker,
      managedRoomExecutor: this.managedRoomExecutor,
      runJournal: this.runJournal,
      recoveryBarrier: this.recoveryBarrier,
      prepareManagedRecovery: this.prepareManagedRecovery,
    }
  }
  coordinateFromLocal = (params: Record<string, unknown>) => coordinationCommand(this.getRuntime(), params)
  private projectWorkbenches = new ProjectWorkbenchRegistry(input => this.coordinateFromLocal(input))
  openProjectWorkbench(params: Record<string, unknown>) {
    if (typeof params.workDir !== 'string') throw new Error('coordination_directory_invalid')
    return this.projectWorkbenches.open(this.resolvePath(params.workDir))
  }
  async resumePendingAcpAuthentication(agentType: string): Promise<boolean> {
    const session = [...this.sessions.values()].find(
      (candidate) =>
        candidate.agentType === agentType && candidate.adapter.hasPendingAuthenticationRetry?.(),
    )
    if (!session?.adapter.resumeAfterExternalAuthentication) return false
    await session.adapter.resumeAfterExternalAuthentication()
    return true
  }
  getUpgradeIdleState(): UpgradeIdleState {
    const reasons: string[] = []
    if (projectCoordinatorsBusy()) reasons.push('project-coordinator-turn')
    if ([...this.sessions.values()].some((session) => session.currentRunId !== null)) {
      reasons.push('active-agent-turn')
    }
    if (this.pendingTransfers.size > 0) reasons.push('file-transfer')
    if (this.activeRequests > 0) reasons.push('active-daemon-request')
    return { idle: reasons.length === 0, reasons }
  }
  bindManagedRoomFromLocal(params: Record<string, unknown>) {
    return bindManagedRoom(this.getRuntime(), this.managedRoomBinder, params)
  }

  /** Local IPC from `shennian steward say`; only steward sessions accept it. */
  stewardSayFromLocal(params: Record<string, unknown>): { messageId: string; sessionId?: string } {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    const text = typeof params.text === 'string' ? params.text : ''
    // No session id means the user's own AI in a terminal: use the "来自终端" conversation.
    if (!sessionId) return commitTerminalStewardSay(this.getRuntime(), text)
    return commitStewardSay(this.getRuntime(), sessionId, text)
  }

  prepareForUpgrade(upgradeJobId: string): { activeRunCount: number } {
    this.recoveryBarrier.freezeDispatch()
    const activeRunCount = this.runJournal.markPlannedUpgrade(upgradeJobId)
    this.runJournal.sync()
    return { activeRunCount }
  }

  cancelUpgradePreparation(): void {
    this.recoveryBarrier.unfreezeDispatch()
  }

  async recoverInterruptedRuns(): Promise<void> {
    this.recoveryPass ??= this.recoveryCoordinator.recoverAll()
    await this.recoveryPass
  }

  getPendingRecoveryCount(): number {
    return this.runJournal.loadPendingReconciliation().records.length
  }

  /** Relay loss revokes every short-lived Project file capability. */
  revokeProjectFsHandles(): void {
    this.projectFsHandleStore.revokeAll()
  }

  private async commitRecoveryTerminal(
    record: RunJournalRecord,
    result: RecoveryTerminal,
  ): Promise<void> {
    const active = this.sessions.get(record.sessionId)
    if (active) {
      active.currentRunId = null
      active.currentRunPhase = null
      active.journalRunId = null
      if (active.heartbeatTimer) {
        clearInterval(active.heartbeatTimer)
        active.heartbeatTimer = null
      }
    }
    this.runTextAcc.delete(`${record.sessionId}:${record.providerRunId ?? record.runId}`)
    this.publishSessionActivity(record.sessionId, null)
    const visibleMessage = upgradeRecoveryVisibleMessage()
    upsertMessage(record.sessionId, {
      id: `upgrade-recovery-terminal-${record.runId}`,
      sessionId: record.sessionId,
      role: 'agent',
      ts: Date.now(),
      payload: JSON.stringify({
        v: 1,
        type: 'error',
        content: visibleMessage,
        error: true,
        recoveryState: result.result,
        recoveryReason: result.reason,
      }),
    })
    recordSession({
      sessionId: record.sessionId,
      agentType: record.agentType,
      sessionMode: record.sessionMode,
      workDir: record.workDir,
      agentSessionId: record.agentSessionId,
      modelId: record.modelId,
      status: 'failed',
      attentionId: `upgrade-recovery:${record.runId}`,
      lastActivityAt: new Date().toISOString(),
    })
    this.managerRuntime.noteAgentEvent(record.sessionId, {
      state: 'error',
      runId: record.providerRunId ?? record.runId,
      seq: record.lastObservedEventSeq + 1,
      message: visibleMessage,
    })
    requestSessionIndexPublish(this.client)
    const seq = record.lastObservedEventSeq + 1
    this.client.sendAgentEvent({
      type: 'event',
      event: 'agent',
      payload:
        result.result === 'interrupted_by_upgrade'
          ? {
              state: 'interrupted_by_upgrade',
              sessionId: record.sessionId,
              runId: record.providerRunId ?? record.runId,
              seq,
              reason: result.reason,
            }
          : {
              state: 'recovery_failed',
              sessionId: record.sessionId,
              runId: record.providerRunId ?? record.runId,
              seq,
              reason: result.reason,
              ...(result.message ? { message: result.message } : {}),
            },
      seq,
      id: `agent-recovery-terminal-${record.runId}`,
    })
    this.chatQueue.noteTerminal(record.sessionId)
  }

  setManagedRoomTurnPreparer(
    prepare: (contexts: ManagedRoomQueueContext[]) => Promise<PreparedManagedRoomTurn>,
  ): void {
    this.chatQueue.setManagedRoomTurnPreparer(prepare)
  }

  setManagedAgentDirectTurnPreparer(prepare: ManagedAgentDirectTurnPreparer): void {
    this.chatQueue.setManagedAgentDirectTurnPreparer(prepare)
  }

  setManagedRecoveryPreparer(
    prepare: NonNullable<SessionManagerRuntime['prepareManagedRecovery']>,
  ): void {
    this.prepareManagedRecovery = prepare
  }

  async enqueueManagedRoomBatch(
    inputs: Array<{ params: ManagedRoomEnqueueParams; context: ManagedRoomQueueContext }>,
  ): Promise<void> {
    const enriched = inputs.map((input) => {
      const persisted = listSessionRecords().find(
        (record) => record.sessionId === input.params.sessionId,
      )
      return {
        context: input.context,
        params: {
          ...input.params,
          modelId: persisted?.modelId ?? input.params.modelId,
          sessionMode: persisted?.sessionMode ?? input.params.sessionMode,
          managerConfig: persisted?.managerConfig ?? input.params.managerConfig,
          managerDefaultWorkerAgentType:
            persisted?.managerDefaultWorkerAgentType ?? input.params.managerDefaultWorkerAgentType,
          managerDefaultWorkerModelId:
            persisted?.managerDefaultWorkerModelId ?? input.params.managerDefaultWorkerModelId,
        },
      }
    })
    await this.chatQueue.enqueueManagedRoomBatch(enriched)
  }

  async retireManagedRoomSession(sessionId: string): Promise<void> {
    this.chatQueue.purgeSession(sessionId)
    await discardPreBindingSession(this.getRuntime(), sessionId)
  }

  discardPendingManagedRoomMessages(sessionId: string): number {
    return this.chatQueue.discardPendingManagedRoomMessages(sessionId)
  }

  async synchronizeSessionDeletions(): Promise<void> {
    await this.deletionSynchronizer.synchronize()
  }

  private async applySessionDeletion(deletion: SessionDeletionCommand): Promise<void> {
    const tombstones = new NativeSourceDeletionStore({
      daemonInstallationId: getDaemonInstallationId(),
    })
    // Read local provenance before any purge below erases it. These extra
    // tombstones only block re-import; provider cleanup stays limited to the
    // Server-issued `deletion.sources`.
    const codexHome = listSessionRecords().find((record) => record.sessionId === deletion.sessionId)?.codexSettings?.codexHome
    let localSources: SessionDeletionCommand['sources'] = []
    try {
      localSources = collectLocalNativeSources(deletion.sessionId, { records: listSessionRecords() })
    } catch (error) {
      console.warn('[session.deletions] local native source lookup failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    // The session barrier is the first durable local mutation. If the process
    // crashes after this point, every body/index writer rejects the session.
    tombstones.recordSession(deletion)
    for (const source of [...deletion.sources, ...localSources]) {
      const existing = tombstones.find(source.agentType, source.sourceSessionKey)
      // Legacy importers could bind one native source to more than one Shennian
      // session. The existing source tombstone already prevents resurrection;
      // keep its original identity so the cleanup outbox's exact guard refuses
      // a destructive provider action for the duplicate session. The duplicate
      // session still receives its own tombstone and must not block the global
      // deletion revision from advancing.
      if (existing && existing.sessionId !== deletion.sessionId) continue
      tombstones.record({ ...deletion, ...source })
    }
    // Deletion wins every race with recovery. Persist the abort before stopping
    // a provider so a crash cannot revive the deleted turn on next startup.
    this.runJournal.markSessionAborted(deletion.sessionId)
    this.recoveryBarrier.end(deletion.sessionId)

    const active = this.sessions.get(deletion.sessionId)
    if (active) {
      this.revokeManagedRoomToken(active)
      try {
        await active.adapter.stop()
      } catch {}
      this.sessions.delete(deletion.sessionId)
    }

    this.historySubscriptions.closeSession(deletion.sessionId)
    this.nativeFusion?.handleSessionDeleted(deletion.sessionId)
    this.chatQueue.purgeSession(deletion.sessionId)
    purgeToolDetails(deletion.sessionId)
    purgeCanonicalSession(deletion.sessionId)
    purgeSessionRecord(deletion.sessionId)
    this.runTextAcc.delete(deletion.sessionId)
    this.publishSessionActivity(deletion.sessionId, null)
    // enqueue() is a synchronous durable commit. Third-party work begins only
    // after the deletion command can safely advance and ACK its revision.
    this.nativeCleanupOutbox.enqueue(deletion, codexHome)
    this.nativeCleanupOutbox.kick()
  }

  private publishSessionActivity(
    sessionId: string,
    activity: import('@shennian/wire').SessionActivitySnapshot | null,
  ): void {
    this.client.sendEvent({
      type: 'event',
      event: 'session.activity',
      payload: { sessionId, activity },
    })
  }
  private async handleExternalTerminal(sessionId: string, phase: 'final' | 'error' | 'aborted' = 'final'): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      // An external-owner turn can terminate without emitting through this
      // adapter instance. Dispose its cached app-server state (including a
      // stale activeTurnId) before the queued turn creates a fresh adapter.
      // The native-fusion terminal is also the only local terminal callback
      // for that turn, so it must close the Active Run Journal before the
      // session object (and its journalRunId) is discarded.
      if (session.journalRunId) {
        this.recoveryCoordinator.completeFromProvider(sessionId, session.journalRunId)
        session.journalRunId = null
      }
      this.sessions.delete(sessionId)
      this.revokeManagedRoomToken(session)
      if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
      session.adapter.removeAllListeners()
      await session.adapter.stop().catch(() => {})
    }
    noteCoordinationEvent(this.getRuntime(), sessionId, phase)
    this.chatQueue.noteTerminal(sessionId)
  }

  private async publishManagedActivitySnapshots(): Promise<void> {
    for (const [sessionId, session] of this.sessions.entries()) {
      // Event-driven sessions already publish a low-cost heartbeat from the
      // adapter binding. Do not also probe getStatus every 15 seconds.
      if (session.heartbeatTimer) continue
      if (!session.currentRunId || !session.adapter.getStatus) continue
      const status = await session.adapter.getStatus().catch(() => null)
      if (!status?.active || !status.runPhase) continue
      const nowIso = new Date().toISOString()
      this.publishSessionActivity(sessionId, {
        sessionId,
        runId: status.runId || session.currentRunId,
        runPhase: status.runPhase,
        startedAt: new Date(session.lastActiveAt).toISOString(),
        updatedAt: nowIso,
        canStop: status.canStop ?? true,
      })
      const seq = session.heartbeatSeq++
      this.client.sendAgentEvent({
        type: 'event',
        event: 'agent',
        payload: {
          state: 'heartbeat',
          sessionId,
          runId: status.runId || session.currentRunId,
          seq,
          runPhase: status.runPhase,
          canStop: status.canStop ?? true,
        },
        seq,
        id: `agent-status-${status.runId || session.currentRunId}-${Date.now()}`,
      })
    }
  }

  private reloadCustomAgents(): void {
    for (const agentType of getRegisteredAgents()) {
      if (agentType.startsWith('custom:')) {
        unregisterAgent(agentType)
      }
    }

    const config = loadConfig()
    for (const [name, entry] of Object.entries(config.customAgents ?? {})) {
      registerCustomAgent(name, entry)
    }
    syncNodeAdapterAgents(listNodeAdapters(), new Set(Object.keys(config.customAgents ?? {})))
  }

  async handleReq(
    req: ReqFrame,
    options: { propagateErrors?: boolean } = {},
  ): Promise<void | LocalReqDispatchResult> {
    const runtime = this.getRuntime()
    let result: LocalReqDispatchResult | undefined
    this.activeRequests++
    try {
      switch (req.method) {
        case 'schedule.deliver':
          if (!this.scheduleHandler) throw new Error('schedules_unavailable')
          await this.scheduleHandler(req)
          break
        case 'chat.send':
          if (req.params.scheduledDelivery) throw new Error('schedule_source_untrusted')
          assertPersonalSyncIdentity(req.params)
          // A legacy caller may still use chat.send directly. During the
          // upgrade freeze/recovery window it must receive the same durable
          // queue semantics as chat.enqueue rather than waiting in memory or
          // racing the recovered turn.
          if (
            this.recoveryBarrier.isDispatchFrozen() ||
            this.recoveryBarrier.isRecovering(String(req.params.sessionId ?? '')) ||
            (typeof req.params.workDir === 'string' && coordinationEnabled(runtime.resolvePath(req.params.workDir)))
          ) {
            result = {
              durableQueueHandoff: await this.chatQueue.handleEnqueue({
                ...req,
                method: 'chat.enqueue',
              }),
            }
          } else {
            await handleChatSend(runtime, req)
          }
          break
        case 'chat.enqueue':
          assertPersonalSyncIdentity(req.params)
          result = { durableQueueHandoff: await this.chatQueue.handleEnqueue(req) }
          break
        case 'chat.codex.settings.get':
        case 'chat.codex.settings.set':
          handleCodexSettings(runtime, req)
          break
        case 'chat.queue.get':
          assertPersonalSyncIdentity(req.params)
          await this.chatQueue.handleGet(req)
          break
        case 'chat.queue.edit':
          assertPersonalSyncIdentity(req.params)
          await this.chatQueue.handleEdit(req)
          break
        case 'chat.queue.delete':
          assertPersonalSyncIdentity(req.params)
          await this.chatQueue.handleDelete(req)
          break
        case 'chat.queue.promote':
          assertPersonalSyncIdentity(req.params)
          await this.chatQueue.handlePromote(req)
          break
        case 'chat.abort':
          assertPersonalSyncIdentity(req.params)
          await handleChatAbort(runtime, req)
          break
        case 'session.refresh':
          assertPersonalSyncIdentity(req.params)
          await handleSessionRefresh(runtime, req)
          break
        case 'session.history.open':
          this.historySubscriptions.handleOpen(req)
          break
        case 'session.history.sync':
          this.historySubscriptions.handleSync(req)
          break
        case 'session.history.page':
          this.historySubscriptions.handlePage(req)
          break
        case 'session.history.close':
          this.historySubscriptions.handleClose(req)
          break
        case 'session.body.replica.subscribe':
          this.historySubscriptions.handleReplicaSubscribe(req)
          break
        case 'session.body.replica.unsubscribe':
          this.historySubscriptions.handleReplicaUnsubscribe(req)
          break
        case 'session.history':
          this.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'upgrade_required' })
          break
        case 'session.message.status':
          handleSessionMessageStatus(runtime, req)
          break
        case 'session.tool.detail':
          await handleSessionToolDetail(runtime, req)
          break
        case 'voice.session.body.window':
          handleVoiceSessionBodyWindow(runtime, req)
          break
        case 'session.title.set':
          await handleSessionTitleSet(runtime, req)
          break
        case 'room.agent.bind-managed':
          await handleManagedRoomBind(runtime, this.managedRoomBinder, req)
          break
        case 'room.agent.restart-managed':
          await handleManagedRoomRestart(runtime, this.managedRoomBinder, req)
          break
        case 'personal.recording':
        case 'personal.workspace': case 'project.taskEvent':
        case 'personal.apps.list':
        case 'personal.apps.register':
        case 'personal.apps.remove':
        case 'personal.service':
          await handlePersonalRequest(runtime, req)
          break
        case 'fs.ls':
          await handleFsLs(runtime, req)
          break
        case 'project.fs.open':
        case 'project.fs.list':
        case 'project.fs.read':
        case 'project.fs.close':
          await handleProjectFsRequest(
            this.client,
            this.projectFsHandleStore,
            req,
            this.trustedProjectFsRequestResolver,
          )
          break
        case 'fs.read':
          await handleFsRead(runtime, req)
          break
        case 'fs.write':
          await handleFsWrite(runtime, req)
          break
        case 'fs.export.markdown-pdf':
          await handleFsExportMarkdownPdf(runtime, req)
          break
        case 'fs.export.markdown-pdf.setup':
          await handleFsExportMarkdownPdfSetup(runtime, req)
          break
        case 'fs.archive.zip':
          await handleFsArchiveZip(runtime, req)
          break
        case 'fs.rename':
          await handleFsRename(runtime, req)
          break
        case 'fs.transfer.start':
          await handleFsTransferStart(runtime, req)
          break
        case 'fs.transfer.chunk':
          await handleFsTransferChunk(runtime, req)
          break
        case 'fs.transfer.finish':
          await handleFsTransferFinish(runtime, req)
          break
        case 'fs.transfer.abort':
          await handleFsTransferAbort(runtime, req)
          break
        case 'region.probe':
          await handleRegionProbe(runtime, req)
          break
        case 'region.switch':
          await handleRegionSwitch(runtime, req)
          break
        case 'upgrade.start':
          await handleUpgradeStart(this.client, req.id, req.params.version as string | undefined, {
            currentVersion: this.cliVersion,
            confirmedMajor: req.params.confirmedMajor === true,
            prepareForUpgrade: (jobId) => this.prepareForUpgrade(jobId),
            cancelUpgradePreparation: () => this.cancelUpgradePreparation(),
            shutdownAfterHandoff: () => {
              setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100).unref?.()
            },
          })
          break
        case 'upgrade.status':
          await handleUpgradeStatus(this.client, req.id, { currentVersion: this.cliVersion })
          break
        case 'upgrade.set-policy':
          await handleUpgradeSetPolicy(runtime, req)
          break
        case 'machine.remote-access.pause':
          await handleRemoteAccessPause(this.client, this.remoteAccessPauseController, req)
          break
        case 'agents.refresh':
          await handleAgentsRefresh(runtime, req)
          break
        case 'agent.permission.respond':
          await handleAgentPermissionResponse(runtime, req)
          break
        case 'agent.auth.start':
        case 'agent.auth.logout':
        case 'agent.session-options.get':
        case 'agent.external-sessions.list':
        case 'agent.external-sessions.import':
        case 'agent.external-sessions.close':
        case 'agent.external-sessions.delete':
          await handleAcpAgentRequest(runtime, req)
          break
        case 'models.refresh':
          await handleModelsRefresh(runtime, req)
          break
        case 'agent.config.get':
          await handleAgentConfigGet(runtime, req)
          break
        case 'agent.config.upsert':
          await handleAgentConfigUpsert(runtime, req)
          break
        case 'agent.config.clear':
          await handleAgentConfigClear(runtime, req)
          break
        case 'agent.config.test':
          await handleAgentConfigTest(runtime, req)
          break
        case 'agent.workspace.validate':
          await handleAgentWorkspaceValidation(runtime, req)
          break
        case 'agent.capabilities.list':
          await handleAgentCapabilitiesList(runtime, req)
          break
        case 'skill.list':
        case 'skill.install':
        case 'skill.doctor':
        case 'skill.setup':
        case 'skill.use':
          this.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'feature_retired' })
          break
        case 'session.wechat-rpa.channel.get':
        case 'session.wechat-rpa.channel.upsert':
        case 'session.wechat-rpa.channel.sync':
        case 'manager.wechat-rpa.channel.get':
        case 'manager.wechat-rpa.channel.upsert':
        case 'manager.wechat-rpa.channel.sync':
          this.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'feature_retired' })
          break
        default:
          this.client.sendRes({
            type: 'res',
            id: req.id,
            ok: false,
            error: `Unknown method: ${req.method}`,
          })
      }
    } catch (err) {
      if (options.propagateErrors) throw err
      this.client.sendRes({
        type: 'res',
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      this.activeRequests--
    }
    return result
  }

  // ─── Session eviction ──────────────────────────────────────────────────────

  private evictIdleSessions(): void {
    if (this.sessions.size < MAX_SESSIONS) return

    let oldest: { key: string; session: ActiveSession } | null = null
    for (const [key, session] of this.sessions) {
      if (!oldest || session.lastActiveAt < oldest.session.lastActiveAt) {
        oldest = { key, session }
      }
    }
    if (oldest) {
      this.revokeManagedRoomToken(oldest.session)
      if (oldest.session.heartbeatTimer) {
        clearInterval(oldest.session.heartbeatTimer)
        oldest.session.heartbeatTimer = null
      }
      oldest.session.adapter.removeAllListeners()
      oldest.session.adapter.stop().catch(() => {})
      this.sessions.delete(oldest.key)
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private resolvePath(p: string): string {
    return resolveSessionWorkDir(p)
  }

  private resolveAuthorizedPath(p: string, rootPath: string) {
    return resolveAuthorizedPath(p, createAuthorizedFsRoot(rootPath))
  }

  private async resolveAuthorizedPathAsync(p: string, rootPath: string) {
    return resolveAuthorizedPathAsync(p, await createAuthorizedFsRootAsync(rootPath))
  }

  async cleanup(): Promise<void> {
    await stopProjectCoordinators()
    await this.projectWorkbenches.close()
    this.chatQueue.stop()
    this.projectFsHandleStore.revokeAll()
    this.acpDiscoveryWatcher.stop()
    this.nativeFusion?.setExternalTerminalHandler?.(null)
    this.nativeCleanupOutbox.stop()
    this.historySubscriptions.closeAll()
    if (this.activityProbeTimer) {
      clearInterval(this.activityProbeTimer)
      this.activityProbeTimer = null
    }
    this.stopAttachmentCleanup?.()
    this.stopAttachmentCleanup = null
    for (const [, session] of this.sessions) {
      this.revokeManagedRoomToken(session)
      if (session.heartbeatTimer) {
        clearInterval(session.heartbeatTimer)
        session.heartbeatTimer = null
      }
      // Process close during daemon shutdown is transport interruption, not a
      // provider terminal. Detach listeners first so the durable Run Journal
      // remains the sole recovery authority for the replacement daemon.
      session.adapter.removeAllListeners()
      await session.adapter.stop().catch(() => {})
    }
    this.sessions.clear()
    this.runTextAcc.clear()
    cleanupPendingTransfers(this.getRuntime())
    await this.managerRuntime.stop()
    setManagerRuntimeService(null)
  }
  private revokeManagedRoomToken(session: ActiveSession): void {
    const token = session.managedRoomContextToken
    session.managedRoomContextToken = null
    if (token) this.managedRoomContextRevoker?.(token)
  }
}
