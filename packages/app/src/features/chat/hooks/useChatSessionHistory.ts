// @arch docs/architecture/data-sync.md#8-app-级统一正文副本与列表发布屏障
// @test src/__tests__/chat-background-history-loading.test.ts

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import {
  RoomWorkspaceActivityContext,
  isChatScreenActive,
} from '../../rooms/RoomWorkspaceActivityContext'
import {
  getSessionLiveActivity,
  getLiveSessionActivitySnapshot,
  useChatStore,
  useSessionsStore,
  envelopeToChatMessage,
  type ChatMessage,
} from '@shennian/shared'
import type { SessionActivitySnapshot, SessionReadWatermark } from '@shennian/wire'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { useAuthStore } from '../../../config/auth'
import { personalSessionBodyStore } from '../../../storage/db'
import type { PersonalSessionBodyStore } from '../../../storage/personal-session-body-store.native'
import { recordPersonalSessionHistoryError } from '../services/personalSessionHistoryMetrics'
import {
  getChatOutboundMessages,
  removeConfirmedChatOutboundMessages,
} from '../utils/outboundStorage'
import { mergeVisibleChatMessages } from '../utils/visibleWindow'
import { syncVisiblePersonalSessionBody } from '../services/personalBodyReplicaSync'
import {
  reportPersonalBodyReplicaFailure,
  shouldRecoverVisibleBodyAfterRun,
} from '../services/visibleBodyRecovery'
import { waitForDesktopHistoryLoadingPaint } from '../../desktop-chat/desktopHistoryLoading'

type SessionMeta =
  | {
      id: string
      machineId: string
      lastActivityAt: string
      visibleMessageCount?: number
      lastVisibleMessageId?: string | null
      attentionCount?: number
      lastAttentionId?: string | null
      activity?: SessionActivitySnapshot | null
    }
  | undefined

type Options = {
  sessionId: string
  session: SessionMeta
  messages: ChatMessage[]
  chatSessionId: string | null
  isTyping: boolean
  chatLoading: boolean
  clear: () => void
  closeFileDrawer: () => void
  setSessionId: (sessionId: string | null) => void
  setMessages: (messages: ChatMessage[]) => void
  setChatLoading: (loading: boolean) => void
  setHasMore: (hasMore: boolean) => void
  prependMessages: (msgs: ChatMessage[]) => void
  readLocalHistory?: (
    store: Pick<PersonalSessionBodyStore, 'getMessages'>,
    accountId: string,
    sessionId: string,
    turnLimit: number,
  ) => ReturnType<PersonalSessionBodyStore['getMessages']>
  workspaceOwnsRouteActivity?: boolean
  /** The steward owns a machine-wide read watermark, not the ordinary session store's one. */
  skipReadCommit?: boolean
  /** Input-only docks own sending/queue state, never an invisible transcript. */
  loadBody?: boolean
}

const INITIAL_CHAT_HISTORY_TURNS = 30
const OLDER_CHAT_HISTORY_TURNS = 20

export function useChatSessionHistory({
  sessionId,
  session,
  chatSessionId,
  clear,
  closeFileDrawer,
  setSessionId,
  setMessages,
  setChatLoading,
  setHasMore,
  readLocalHistory,
  workspaceOwnsRouteActivity = false,
  skipReadCommit = false,
  loadBody = true,
}: Options) {
  const routeFocused = useIsFocused()
  const workspaceActive = useContext(RoomWorkspaceActivityContext)
  const isScreenFocused = isChatScreenActive(
    routeFocused,
    workspaceActive,
    workspaceOwnsRouteActivity,
  )
  const focusedRef = useRef(isScreenFocused)
  focusedRef.current = isScreenFocused
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pendingPresentationToken, setPendingPresentationToken] = useState<string | null>(null)
  const pendingPresentationTokenRef = useRef<string | null>(null)
  const presentedPresentationTokenRef = useRef<string | null>(null)
  const committingPresentationTokenRef = useRef<string | null>(null)
  const pendingReadWatermarkRef = useRef<SessionReadWatermark | null>(null)
  const loadedTurnsRef = useRef(INITIAL_CHAT_HISTORY_TURNS)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const activitySessionIdRef = useRef(sessionId)
  const previousActivityRef = useRef<SessionActivitySnapshot | null>(session?.activity ?? null)

  const loadLocalWindow = useCallback(async (turnLimit: number) => {
    if (!sessionId || !loadBody) return
    const accountId = useAuthStore.getState().user?.id
    if (!accountId) {
      setChatLoading(false)
      return
    }
    try {
      const [cache, envelopes] = await Promise.all([
        personalSessionBodyStore.getState(accountId, sessionId),
        readLocalHistory
          ? readLocalHistory(personalSessionBodyStore, accountId, sessionId, turnLimit)
          : personalSessionBodyStore.getMessagesByUserTurns(accountId, sessionId, {
            turnLimit, ...(Platform.OS !== 'web' ? { messageLimit: turnLimit * 10 } : {}),
          }),
      ])
      if (useChatStore.getState().sessionId !== sessionId || useAuthStore.getState().user?.id !== accountId) return
      const incoming = envelopes.map((envelope) =>
        envelopeToChatMessage(envelope, envelope.deliveryState),
      )
      removeConfirmedChatOutboundMessages(accountId, sessionId, incoming.map((message) => message.id))
      const currentById = new Map(
        useChatStore.getState().messages.map((message) => [message.id, message]),
      )
      for (const message of getChatOutboundMessages(accountId, sessionId)) {
        currentById.set(message.id, message)
      }
      setMessages(mergeVisibleChatMessages([...currentById.values()], incoming))
      const firstSequence = envelopes[0]?.localSequence ?? null
      setHasMore(Boolean(
        cache?.hasOlder
        || (firstSequence !== null && cache?.firstCachedSeq !== null
          && cache?.firstCachedSeq !== undefined && firstSequence > cache.firstCachedSeq),
      ))
      setChatLoading(false)
      useChatStore.getState().setSessionLoadFailed(false)

      const latestSession = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
      const mountedSession = sessionRef.current
      const bodyRevision = cache?.cachedBodyRevision ?? latestSession?.bodyRevision ?? 0
      const presentationToken = `${sessionId}:${bodyRevision}:${incoming.length}`
      pendingPresentationTokenRef.current = presentationToken
      pendingReadWatermarkRef.current = {
        bodyRevision,
        visibleMessageCount: latestSession?.visibleMessageCount ?? mountedSession?.visibleMessageCount ?? 0,
        lastVisibleMessageId: latestSession?.lastVisibleMessageId ?? mountedSession?.lastVisibleMessageId ?? null,
        attentionCount: latestSession?.attentionCount ?? mountedSession?.attentionCount ?? 0,
        lastAttentionId: latestSession?.lastAttentionId ?? mountedSession?.lastAttentionId ?? null,
      }
      setPendingPresentationToken(presentationToken)
    } catch {
      setChatLoading(false)
      useChatStore.getState().setSessionLoadFailed(true)
      recordPersonalSessionHistoryError('cache', 'local_history_read_failed')
    }
  }, [loadBody, readLocalHistory, sessionId, setChatLoading, setHasMore, setMessages])

  useEffect(() => {
    if (!isScreenFocused || !sessionId) return
    clear()
    closeFileDrawer()
    setSessionId(sessionId)
    setChatLoading(loadBody)
    setHasMore(false)
    loadedTurnsRef.current = INITIAL_CHAT_HISTORY_TURNS
    pendingPresentationTokenRef.current = null
    presentedPresentationTokenRef.current = null
    committingPresentationTokenRef.current = null
    pendingReadWatermarkRef.current = null
    setPendingPresentationToken(null)
    useChatStore.getState().setSessionLoadFailed(false)
    const accountId = useAuthStore.getState().user?.id
    let active = true
    if (!loadBody) useChatStore.getState().restoreRunPhase(getLiveSessionActivitySnapshot(sessionRef.current?.activity))
    if (loadBody) void loadLocalWindow(INITIAL_CHAT_HISTORY_TURNS).then(() => {
      if (!active || useAuthStore.getState().user?.id !== accountId || useChatStore.getState().sessionId !== sessionId) return
      const current = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
      useChatStore.getState().restoreRunPhase(current ? getSessionLiveActivity(current) : null)
      // Room-bound sessions can intentionally have a stale Server-side body
      // revision. Pull only this visible conversation from its owning machine;
      // the body-store subscription below presents the committed delta.
      void syncVisiblePersonalSessionBody(sessionId).catch((error) => {
        recordPersonalSessionHistoryError('relay', 'visible_history_sync_failed')
        reportPersonalBodyReplicaFailure('visible_sync', { sessionId, error })
      })
    })
    const unsubscribe = accountId && loadBody
      ? personalSessionBodyStore.subscribe(accountId, sessionId, () => {
          void loadLocalWindow(loadedTurnsRef.current)
        })
      : () => {}
    return () => {
      active = false
      unsubscribe()
      if (useChatStore.getState().sessionId === sessionId) clear()
    }
  }, [clear, closeFileDrawer, isScreenFocused, loadBody, loadLocalWindow, sessionId, setChatLoading, setHasMore, setSessionId])

  useEffect(() => {
    if (!isScreenFocused || !sessionId) return
    const chatState = useChatStore.getState()
    if (chatState.sessionId === sessionId) return

    // A linked Worker is pushed on top of the Manager/source conversation.
    // Both screens share the singleton chat store, so returning must restore
    // the still-mounted source screen instead of leaving the Worker cleanup's
    // empty snapshot visible.
    setSessionId(sessionId)
    setChatLoading(loadBody)
    if (!loadBody) useChatStore.getState().restoreRunPhase(getLiveSessionActivitySnapshot(sessionRef.current?.activity))
    if (loadBody) void loadLocalWindow(loadedTurnsRef.current).then(() => {
      if (!focusedRef.current || useChatStore.getState().sessionId !== sessionId) return
      const current = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
      useChatStore.getState().restoreRunPhase(current ? getSessionLiveActivity(current) : null)
      void syncVisiblePersonalSessionBody(sessionId).catch((error) => {
        recordPersonalSessionHistoryError('relay', 'visible_history_sync_failed')
        reportPersonalBodyReplicaFailure('visible_sync', { sessionId, error })
      })
    })
  }, [chatSessionId, isScreenFocused, loadBody, loadLocalWindow, sessionId, setChatLoading, setSessionId])

  useEffect(() => {
    const current = session?.activity ?? null
    if (activitySessionIdRef.current !== sessionId) {
      activitySessionIdRef.current = sessionId
      previousActivityRef.current = current
      return
    }
    const previous = previousActivityRef.current
    previousActivityRef.current = current
    if (!loadBody) return
    if (!shouldRecoverVisibleBodyAfterRun(previous, current, isScreenFocused)) return
    // The machine stream is the realtime path. This targeted revision pull is
    // the reliable terminal repair when a route or delta was interrupted, and
    // intentionally does not depend on the Room-bound Server index being fresh.
    void syncVisiblePersonalSessionBody(sessionId).catch((error) => {
      recordPersonalSessionHistoryError('relay', 'visible_terminal_sync_failed')
      reportPersonalBodyReplicaFailure('visible_sync', { sessionId, error })
    })
  }, [isScreenFocused, loadBody, session?.activity, sessionId])

  const loadOlderMessages = useCallback(async () => {
    if (!loadBody || !sessionId || loadingOlder) return
    const chatState = useChatStore.getState()
    if (chatState.sessionId !== sessionId || !chatState.hasMore) return
    setLoadingOlder(true)
    try {
      if (Platform.OS === 'web') await waitForDesktopHistoryLoadingPaint()
      loadedTurnsRef.current += OLDER_CHAT_HISTORY_TURNS
      await loadLocalWindow(loadedTurnsRef.current)
    } finally {
      setLoadingOlder(false)
    }
  }, [loadBody, loadLocalWindow, loadingOlder, sessionId])

  const commitPresentedSnapshotRead = useCallback((presentationToken: string) => {
    if (pendingPresentationTokenRef.current !== presentationToken
      || presentedPresentationTokenRef.current !== presentationToken
      || AppState.currentState !== 'active'
      || !focusedRef.current
      || useChatStore.getState().sessionId !== sessionId) return
    const readWatermark = pendingReadWatermarkRef.current
    if (!readWatermark || committingPresentationTokenRef.current) return
    if (skipReadCommit) {
      pendingPresentationTokenRef.current = null
      presentedPresentationTokenRef.current = null
      pendingReadWatermarkRef.current = null
      setPendingPresentationToken((current) => current === presentationToken ? null : current)
      return
    }
    committingPresentationTokenRef.current = presentationToken
    void accountRuntime.markSessionRead(sessionId, new Date().toISOString(), readWatermark).then(() => {
      if (pendingPresentationTokenRef.current !== presentationToken) return
      pendingPresentationTokenRef.current = null
      presentedPresentationTokenRef.current = null
      pendingReadWatermarkRef.current = null
      setPendingPresentationToken((current) => current === presentationToken ? null : current)
    }).catch(() => {
      recordPersonalSessionHistoryError('relay', 'read_watermark_failed')
    }).finally(() => {
      if (committingPresentationTokenRef.current === presentationToken) {
        committingPresentationTokenRef.current = null
      }
    })
  }, [sessionId, skipReadCommit])

  const acknowledgeLatestSnapshotPresented = useCallback((presentationToken: string) => {
    if (pendingPresentationTokenRef.current !== presentationToken) return
    presentedPresentationTokenRef.current = presentationToken
    commitPresentedSnapshotRead(presentationToken)
  }, [commitPresentedSnapshotRead])

  useEffect(() => {
    const token = presentedPresentationTokenRef.current
    if (isScreenFocused && token) commitPresentedSnapshotRead(token)
  }, [isScreenFocused, commitPresentedSnapshotRead])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return
      const presentationToken = presentedPresentationTokenRef.current
      if (presentationToken) commitPresentedSnapshotRead(presentationToken)
    })
    return () => subscription.remove()
  }, [commitPresentedSnapshotRead])

  return {
    loadingOlder,
    loadOlderMessages,
    pendingPresentationToken,
    acknowledgeLatestSnapshotPresented,
  }
}
