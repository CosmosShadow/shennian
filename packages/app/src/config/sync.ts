import { useStewardSessionsStore } from '../features/steward/stewardSessionsStore'
import type { NianSession } from '@shennian/wire'
// @arch docs/features/app-relay-connectivity.md#p2实现可靠自动重连
// @test ../__tests__/app-connectivity-status.test.ts

import {
  createUseSync,
  useSessionsStore,
  useMachinesStore,
  useProjectsStore,
  useChatStore,
  getSyncEngine as getSharedSyncEngine,
  getRelayManager,
  getSessionLiveActivity,
  reportLog,
  getRuntimeMetricSnapshot,
  resetRuntimeMetrics,
  setRuntimeMetricsEnabled,
} from '@shennian/shared'
import { SESSION_SYNC_DATA_EPOCH } from '@shennian/wire'
import { useAuthStore } from './auth'
import { authApi } from './api'
import { buildRelayClientUrl, buildRelayUrl } from '../platform/relay-url'
import { db, personalSessionBodyStore } from '../storage/db'
import { scheduleNativeBadgeSync } from '../lib/push-badge'
import { publishRoomRelayEvent, publishRoomSyncRequest } from '../features/rooms/roomEvents'
import { publishAgentRefreshEvent } from '../features/agents/agentEvents'
import { publishStewardResync, publishStewardSessionEvent } from '../features/steward/stewardSessionEvents'
import {
  clearAllChatOutboundMessages,
  clearChatOutboundAccount,
  markChatOutboundSessionDeleted,
  removeChatOutboundSession,
} from '../features/chat/utils/outboundStorage'
import {
  clearAllChatDrafts,
  clearChatDraftAccount,
  removeChatDraft,
} from '../features/chat/utils/draftStorage'
import { getNativeNetInfoAdapter } from '../hooks/nativeNetInfo'
import { AppState, Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Application from 'expo-application'
import * as Updates from 'expo-updates'
import { clearAllChatScrollPositions } from '../features/chat/utils/scrollPositionStorage'
import { clearAllReasoningEffortPreferences } from '../features/chat/utils/reasoningEffortStorage'
import { clearAllAttachmentPreviewCaches } from '../features/chat/utils/attachmentPreview'
import { usePersonalBodyReplicaSync } from '../features/chat/services/personalBodyReplicaSync.native'
import { useRoomReplicaSync } from '../features/rooms/useRoomReplicaSync'
import { clearAllRoomDrafts, clearRoomDraftAccount } from '../features/rooms/roomDraftStorage'
import { clearCoordinationAccountCache } from '../features/projects/coordination/localState'
import { publishPersonalBodyReplicaTargetChange } from '../features/chat/services/personalBodyReplicaSignals'
const runtimeMetricsEnabled =
  process.env.EXPO_PUBLIC_SHENNIAN_PERF_DIAGNOSTICS === '1'
setRuntimeMetricsEnabled(runtimeMetricsEnabled)

if (runtimeMetricsEnabled) {
  ;(
    globalThis as typeof globalThis & {
      __SHENNIAN_RUNTIME_METRICS__?: {
        snapshot: typeof getRuntimeMetricSnapshot
        reset: typeof resetRuntimeMetrics
      }
    }
  ).__SHENNIAN_RUNTIME_METRICS__ = {
    snapshot: getRuntimeMetricSnapshot,
    reset: resetRuntimeMetrics,
  }
}

export function applySessionActivity(
  sessionId: string,
  lastActivityAt: string,
  preview?: string,
  opts?: { markRead?: boolean; userMessage?: boolean },
) {
  const sessionsState = useSessionsStore.getState()
  const session = sessionsState.sessions.find((s) => s.id === sessionId)
  if (!session) return

  sessionsState.applyActivity(
    sessionId,
    lastActivityAt,
    preview,
    {
      ...(opts?.markRead ? { lastReadAt: lastActivityAt } : {}),
      ...(opts?.userMessage ? { userMessageAt: lastActivityAt } : {}),
    },
  )

  const nextSession = useSessionsStore.getState().sessions.find((s) => s.id === sessionId)
  if (!nextSession) return

  if (
    nextSession.lastUserMessageAt === session.lastUserMessageAt &&
    nextSession.lastActivityAt === session.lastActivityAt &&
    nextSession.lastMessagePreview === session.lastMessagePreview &&
    nextSession.userState?.lastReadAt === session.userState?.lastReadAt &&
    nextSession.userState?.manualUnread === session.userState?.manualUnread
  ) {
    return
  }

  void getSharedSyncEngine()
    ?.persistSession(nextSession)
    .then(() => {
      if (opts?.markRead) scheduleNativeBadgeSync()
    })
    .catch(() => {})
}

function unreadStateChanged(
  previous: ReturnType<typeof useSessionsStore.getState>['sessions'][number] | undefined,
  next: ReturnType<typeof useSessionsStore.getState>['sessions'][number],
): boolean {
  return (
    previous?.userState?.lastReadAt !== next.userState?.lastReadAt ||
    previous?.userState?.manualUnread !== next.userState?.manualUnread
  )
}

let lastRelayNetworkOnline: boolean | null = null

const useRealSync = createUseSync({
  store: db,
  api: authApi,
  // The cutover revision is independent from the wire epoch. Revision 2 closes
  // the rollout race where an epoch-2 App could reset, then rehydrate from the
  // still-legacy Server before its destructive migration was deployed.
  syncCacheVersion: `personal-data-epoch:${SESSION_SYNC_DATA_EPOCH}:cutover:2`,
  onPersonalDataReset: async () => {
    await Promise.all([
      clearAllChatDrafts(),
      clearAllRoomDrafts(),
      clearAllChatOutboundMessages(),
      clearAllChatScrollPositions(),
      clearAllReasoningEffortPreferences(),
      clearAllAttachmentPreviewCaches(),
    ])
    useChatStore.getState().clear()
    useSessionsStore.getState().setSessions([])
    useProjectsStore.getState().setProjects([])
  },
  getToken: () => useAuthStore.getState().token,
  getIsAuthenticated: () => useAuthStore.getState().isAuthenticated,
  getUserId: () => useAuthStore.getState().user?.id ?? null,
  buildRelayUrl,
  buildRelayClientUrl,
  subscribeNetworkStatus: (update) => {
    const netInfo = getNativeNetInfoAdapter()
    if (!netInfo) return () => {}
    const publish = (state: { isConnected: boolean | null }) => {
      if (state.isConnected !== null) {
        lastRelayNetworkOnline = state.isConnected
        update(state.isConnected)
      }
    }
    void netInfo.fetch().then(publish)
    return netInfo.addEventListener(publish)
  },
  onRelayConnectivityEvent: (event) => {
    const metadata = {
      platform: Platform.OS,
      shellVersion: Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? null,
      nativeBuild: Application.nativeBuildVersion ?? null,
      updateId: Updates.updateId ?? null,
      reason: event.snapshot.reason,
      closeCode: event.snapshot.closeCode,
      retryable: event.snapshot.retryable,
      retryAttempt: event.snapshot.retryAttempt,
      connectionId: event.snapshot.connectionId,
      appState: AppState.currentState,
      networkOnline: lastRelayNetworkOnline,
    }
    reportLog({
      level: event.name === 'relay_recovery_failed' ? 'warn' : 'info',
      type: 'ws',
      wsEvent: event.name,
      durationMs: event.durationMs,
      metadata,
    })
    // Remote DB reporting is intentionally disabled. Keep a privacy-safe local
    // lifecycle line so production device logs can still explain recovery.
    console[event.name === 'relay_recovery_failed' ? 'warn' : 'info'](
      '[relay:connectivity]',
      JSON.stringify({ event: event.name, durationMs: event.durationMs ?? null, ...metadata }),
    )
  },
  onSessionsChange: (sessions) => {
    useSessionsStore.getState().setSessions(sessions)
  },
  onSessionIndexTargetChange: publishPersonalBodyReplicaTargetChange,
  setSessionsLoading: (loading) => useSessionsStore.getState().setLoading(loading),
  onSyncStart: () => {
    useSessionsStore.getState().setServerSyncing(true)
  },
  onSyncEnd: () => useSessionsStore.getState().setServerSyncing(false),
  onSessionUpdate: (session) => {
    const previous = useSessionsStore.getState().sessions.find((item) => item.id === session.id)
    useSessionsStore.getState().upsertSession(session)
    if (unreadStateChanged(previous, session)) scheduleNativeBadgeSync()
    const chatState = useChatStore.getState()
    if (chatState.sessionId === session.id) {
      const liveActivity = getSessionLiveActivity(session)
      const nextPhase = liveActivity?.runPhase ?? null
      const nextRunId = liveActivity?.runId ?? null
      const prevPhase = chatState.runPhase
      const prevRunId = chatState.currentRunId
      const isChange = nextPhase !== prevPhase || nextRunId !== prevRunId
      if (isChange) {
        console.log(
          `[sync:activity] sessionId=${session.id.slice(0, 8)} ${prevPhase}/${prevRunId?.slice(0, 8) ?? '-'} → ${nextPhase ?? 'null'}/${nextRunId?.slice(0, 8) ?? '-'}`,
        )
        reportLog({
          level: 'info',
          userId: useAuthStore.getState().user?.id,
          sessionId: session.id,
          wsEvent: 'restoreRunPhase',
          metadata: {
            liveActivity,
            before: { runPhase: prevPhase, currentRunId: prevRunId },
          },
        })
      }
      chatState.restoreRunPhase(liveActivity)
    }
  },
  onSessionBatchUpdate: (sessions) => {
    useSessionsStore.getState().upsertSessions(sessions)
  },
  onSessionDelete: (sessionId, deletionRevision = 0) => {
    markChatOutboundSessionDeleted(sessionId)
    useSessionsStore.getState().removeSession(sessionId)
    const accountId = useAuthStore.getState().user?.id
    if (accountId) {
      void personalSessionBodyStore
        .markDeleted(accountId, sessionId, deletionRevision)
        .catch(() => {})
    }
    if (accountId) {
      removeChatOutboundSession(accountId, sessionId)
      removeChatDraft(accountId, sessionId)
    }
    const chat = useChatStore.getState()
    if (chat.sessionId === sessionId) chat.clear()
  },
  onMachinesChange: (machines) => useMachinesStore.getState().setMachines(machines),
  onMachinesRemoteResolved: (resolved) => useMachinesStore.getState().setRemoteResolved(resolved),
  onMachineRemoved: (machineId) => {
    const accountId = useAuthStore.getState().user?.id
    if (accountId) {
      void db.markMachineAgentsUnavailable?.(accountId, machineId).catch(() => {})
    }
  },
  onProjectsChange: (projects) => useProjectsStore.getState().setProjects(projects),
  onMachineStatus: (machineId, online, region, cliVersion, autoUpgrade, sync) =>
    useMachinesStore
      .getState()
      .updateMachineStatus(machineId, online, region, cliVersion, autoUpgrade, sync),
  onMachineAgentList: (machineId, agentList) =>
    useMachinesStore.getState().updateMachineAgentList(machineId, agentList),
  onMachineAgents: (machineId, agentList, agents) =>
    useMachinesStore.getState().updateMachineAgents(machineId, agentList, agents ?? []),
  onUpgradeEvent: (payload) => useMachinesStore.getState().handleUpgradeEvent(payload),
  onSessionQueueUpdate: (sessionId, queue) => {
    const chatState = useChatStore.getState()
    if (chatState.sessionId === sessionId) {
      chatState.setQueue(queue)
    }
  },
  onRelayEvent: (event) => {
    if (event.event === 'session.update') {
      const session = (event.payload as { session?: NianSession })?.session
      if (session?.sessionScope === 'steward' && session.userId === useAuthStore.getState().user?.id) {
        useStewardSessionsStore.getState().upsert(session)
      }
    }
    publishRoomRelayEvent(event)
    publishAgentRefreshEvent(event)
    publishStewardSessionEvent(event)
  },
  onReconnect: (reason) => {
    publishRoomSyncRequest(reason)
    publishStewardResync()
  },
  getChatSessionId: () => useChatStore.getState().sessionId,
  getChatIsTyping: () => useChatStore.getState().isTyping,
})

export function useSync() {
  useRealSync()
  usePersonalBodyReplicaSync()
  useRoomReplicaSync()
}

/**
 * Privacy boundary for an explicit logout/account deletion. The core index is
 * a single-active-account cache, so it is cleared wholesale; body, draft and
 * outbound stores additionally retain explicit account keys to prevent reads
 * across a fast A -> B account switch before cleanup finishes.
 */
export async function clearAccountLocalData(accountId: string | null | undefined): Promise<void> {
  getRelayManager()?.disconnectAll()

  const engine = getSharedSyncEngine()
  let persistentClearError: unknown = null
  try {
    if (engine) await engine.clearLocalData()
    else await db.clearAll()
  } catch (error) {
    persistentClearError = error
  }

  if (accountId) {
    clearChatDraftAccount(accountId)
    clearChatOutboundAccount(accountId)
    clearRoomDraftAccount(accountId)
    await clearCoordinationAccountCache(accountId).catch(() => {})
  }
  await clearAllAttachmentPreviewCaches().catch(() => {})
  useChatStore.getState().clear()
  useSessionsStore.getState().setSessions([])
  useMachinesStore.getState().setMachines([])
  useProjectsStore.getState().setProjects([])
  if (persistentClearError) throw persistentClearError
}

export { getSharedSyncEngine as getSyncEngine, getRelayManager }
