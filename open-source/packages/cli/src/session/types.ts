// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-core.test.ts
// @test src/__tests__/model-switching.test.ts

import type {
  AgentType,
  ExternalChannelSessionStatus,
  SessionMode,
  SessionScope,
  SessionRunPhase,
} from '@shennian/wire'
import type { AgentAdapter } from '../agents/adapter.js'
import type { CliRelayClient } from '../relay/client.js'
import type { NativeSessionFusionService } from '../native-fusion/service.js'
import type { ManagerRuntimeService } from '../manager/runtime.js'
import type { ResolveAuthorizedPathResult } from '../fs/boundary.js'
import type { ManagedRoomExecutor } from '../room/managed-room-ipc.js'
import type { ActiveRunJournal } from './run-recovery/journal.js'
import type { RunRecoveryBarrier } from './run-recovery/barrier.js'
import type { RunJournalRecord } from './run-recovery/schema.js'
import type { PreparedManagedRoomTurn } from './queue.js'

export type ActiveSession = {
  adapter: AgentAdapter
  workDir: string
  agentType: AgentType
  sessionMode?: SessionMode
  nativeSessionVisibility?: 'user' | 'internal'
  /** Steward turns speak only through `steward say`; see steward/session.ts. */
  sessionScope?: SessionScope
  /** Run whose `say` calls have been committed; drives the last-output fallback. */
  stewardSay?: { count: number }
  /** Last flushed Agent text of the current run, shown only as the no-`say` fallback. */
  stewardLastText?: string
  agentSessionId: string | null
  lastActiveAt: number
  currentRunId: string | null
  currentRunPhase: SessionRunPhase | null
  nextEventSeq: number
  heartbeatSeq: number
  heartbeatTimer: ReturnType<typeof setInterval> | null
  pendingTextEvent: {
    runId: string
    seq: number
    text: string
    thinking: boolean
  } | null
  externalChannel?: ExternalChannelSessionStatus | null
  externalChannelEnv?: NodeJS.ProcessEnv
  externalReplyTarget?: string | null
  /** Opaque per-turn Room capability; revoked and cleared on every terminal path. */
  managedRoomContextToken?: string | null
  /** Room `send` results of the current Turn; reset when the Turn's capability is issued. */
  roomSendOutcome?: { successes: number; failureCodes: string[] } | null
  /** Stable Shennian recovery identity; provider run ids are stored separately. */
  journalRunId?: string | null
  /** Last time the provider produced anything for the current run (any event, or the dispatch itself). */
  lastProviderActivityAt?: number
  /** Set while a "possibly stuck" notice is showing for the current run. */
  stalledNotice?: { id: string; ts: number } | null
}

export type PendingTransfer = {
  transferId: string
  rootPath: string
  lastActivityAt: number
}

export type ChatQueueService = {
  handleEnqueue(req: import('@shennian/wire').ReqFrame): Promise<boolean>
  handleGet(req: import('@shennian/wire').ReqFrame): Promise<void>
  handleEdit(req: import('@shennian/wire').ReqFrame): Promise<void>
  handleDelete(req: import('@shennian/wire').ReqFrame): Promise<void>
  handlePromote(req: import('@shennian/wire').ReqFrame): Promise<void>
  noteExternalClaim(sessionId: string, canonicalMessageId: string): void
  noteTerminal(sessionId: string): void
  /** True while a queued message is being handed to the Agent; the queue reports its own failures. */
  isDispatching?(sessionId: string): boolean
  purgeSession(sessionId: string): void
  getSnapshot(sessionId: string): import('@shennian/wire').ChatQueueSnapshot
}

export type SessionActivityPublisher = {
  publish(
    sessionId: string,
    activity: import('@shennian/wire').SessionActivitySnapshot | null,
  ): void
}

export type UpgradePolicyController = {
  setPolicy(policy: 'none' | 'patch'): void
  getPolicy(): 'none' | 'patch'
}

export type RemoteAccessPauseController = {
  prepare(): {
    disabledAt: string
    autoStartDisabled: boolean
    autoStartError?: string
  }
  isDisabled(): boolean
  shutdownAfterResponse(): void
}

export type SessionManagerRuntime = {
  client: CliRelayClient
  pendingTransfers: Map<string, PendingTransfer>
  processedReqIds: Set<string>
  reloadCustomAgents: () => void
  /** Cached per-machine Agent infos, without a rescan; used to republish after a cache update. */
  getAgentSnapshot?: () => import('@shennian/wire').AgentInfo[]
  resolvePath: (pathValue: string) => string
  resolveAuthorizedPath: (pathValue: string, rootPath: string) => ResolveAuthorizedPathResult
  resolveAuthorizedPathAsync: (
    pathValue: string,
    rootPath: string,
  ) => Promise<ResolveAuthorizedPathResult>
  runTextAcc: Map<string, string>
  sessions: Map<string, ActiveSession>
  evictIdleSessions: () => void
  nativeFusion: NativeSessionFusionService | null
  managerRuntime: ManagerRuntimeService | null
  chatQueue: ChatQueueService | null
  activityPublisher?: SessionActivityPublisher | null
  upgradePolicyController?: UpgradePolicyController | null
  revokeManagedRoomContextToken?: ((token: string) => void) | null
  managedRoomExecutor?: ManagedRoomExecutor | null
  runJournal?: ActiveRunJournal | null
  recoveryBarrier?: RunRecoveryBarrier | null
  /** Rebuilds short-lived Room authority from current server state after restart. */
  prepareManagedRecovery?: (
    record: RunJournalRecord,
  ) => Promise<PreparedManagedRoomTurn | null>
}
