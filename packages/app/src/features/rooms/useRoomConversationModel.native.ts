// @arch docs/features/network-rooms/ui.md#六群聊列表
// @test src/__tests__/room-conversation-screen.test.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomMessageView } from '@shennian/wire'
import type { RoomDetailView, RoomMemberView } from './types'
import { useAuthStore } from '../../config/auth'
import { db } from '../../storage/db'
import { publishRoomLocalRead, subscribeRoomEvents } from './roomEvents'
import { mergeRoomSyncWindow } from './roomSyncWindow'
import { loadRoomMessageRefresh } from './roomMessageRefresh'
import { compareRoomSequence as compareSequence, incrementRoomSequence as incrementSequence,
  maxRoomSequence as maxSequence, mergeRoomMessages as mergeMessages, shouldReportRoomRead } from './roomConversationUtils'
import { removeRoomDraft } from './roomDraftStorage'
import { isRoomAccountForbidden, roomAccountClient } from './roomAccountClient.native'
import type { RoomLoadStateValue as LoadState } from './components/RoomLoadState'
import type { RoomConversationModel, RoomConversationModelOptions, RoomSendInput } from './useRoomConversationModel.types'
const ROOM_MESSAGE_PAGE_SIZE = 50
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

async function fetchRoomContext(roomId: string) {
  return Promise.all([
    roomAccountClient.getRoom(roomId),
    roomAccountClient.listMembers(roomId).then((memberships) => ({ memberships })).catch((error) => {
      if (isRoomAccountForbidden(error)) return { memberships: [] }
      throw error
    }),
  ])
}

export function useRoomConversationModel({ roomId, accountId, networkStatus, active, onNewMessages }: RoomConversationModelOptions): RoomConversationModel {
  const [room, setRoom] = useState<RoomDetailView | null>(null)
  const [membershipId, setMembershipId] = useState<string | null>(null)
  const [members, setMembers] = useState<RoomMemberView[]>([])
  const [messages, setMessages] = useState<RoomMessageView[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderLoadFailed, setOlderLoadFailed] = useState(false)
  const [state, setState] = useState<LoadState>('loading')
  const latestSequenceRef = useRef('0')
  const pendingGapRef = useRef(false)
  const loadingOlderRef = useRef(false)
  const recoveryPromiseRef = useRef<Promise<void> | null>(null)
  const stateRef = useRef<LoadState>('loading')
  const lastReportedReadRef = useRef({ scope: '', sequence: '0' })
  const previousNetworkStatusRef = useRef(networkStatus)
  const alive = useRef(true)
  const scope = JSON.stringify([accountId, roomId])
  const currentScope = useRef(scope)
  currentScope.current = scope
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const isCurrent = useCallback(() => alive.current && currentScope.current === scope
    && useAuthStore.getState().user?.id === accountId, [accountId, scope])
  const loadInitial = useCallback(async () => {
    let restoredCached = false
    let cachedSequence: string | undefined
    if (accountId) {
      const [summaries, cachedMessages, cachedMembers, cachedSyncState] = await Promise.all([
        db.getRoomSummaries(accountId),
        db.getRoomMessages(accountId, roomId, { limit: ROOM_MESSAGE_PAGE_SIZE + 1 }),
        db.getRoomMembers(accountId, roomId),
        db.getRoomSyncState(accountId, roomId),
      ])
      const cached = summaries.find((item) => item.id === roomId)
      if (cached) {
        const cachedWindow = cachedMessages.slice(-ROOM_MESSAGE_PAGE_SIZE)
        const detail = cached.roomDetail as RoomDetailView | undefined
        setRoom(
          detail ?? {
            id: cached.id,
            name: cached.name,
            description: '',
            status: cached.status,
            visibility: cached.visibility,
            joinPolicy: cached.joinPolicy,
            lastSequence: cached.lastSequence,
            historyFromSequence: '1',
            membershipStatus: cached.membershipStatus ?? null,
          },
        )
        setMembershipId(cached.membershipId ?? null)
        setMembers(cachedMembers.map((item) => item.payload as RoomMemberView))
        cachedSequence = cachedWindow[cachedWindow.length - 1]?.sequence
        setMessages((current) => mergeMessages(current, cachedWindow))
        setHasOlder(
          cachedMessages.length > ROOM_MESSAGE_PAGE_SIZE || (cachedSyncState?.hasOlder ?? false),
        )
        latestSequenceRef.current = maxSequence(latestSequenceRef.current, cachedSequence ?? '0')
        setState('ready')
        restoredCached = true
      } else {
        setState('loading')
      }
    } else {
      setState('loading')
    }
    try {
      const [detail, memberData] = await fetchRoomContext(roomId)
      const before = incrementSequence(detail.room.lastSequence)
      const messageData = await loadRoomMessageRefresh(
        roomAccountClient.listMessages, roomId, before, cachedSequence,
      )
      setRoom(detail.room)
      setMembershipId(detail.membershipId)
      setMembers(memberData.memberships)
      setMessages((current) => current.filter((message) => {
        if (compareSequence(message.sequence, detail.room.historyFromSequence) < 0) return false
        return detail.room.historyThroughSequence == null ||
          compareSequence(message.sequence, detail.room.historyThroughSequence) <= 0
      }))
      setMessages((current) => mergeMessages(current, messageData.messages).filter((message) => {
        if (compareSequence(message.sequence, detail.room.historyFromSequence) < 0) return false
        return detail.room.historyThroughSequence == null ||
          compareSequence(message.sequence, detail.room.historyThroughSequence) <= 0
      }))
      if (!cachedSequence) setHasOlder(messageData.hasMore)
      setState('ready')
      if (accountId) {
        const [summaries, latestSyncState] = await Promise.all([
          db.getRoomSummaries(accountId),
          db.getRoomSyncState(accountId, roomId),
        ])
        const existing = summaries.find((item) => item.id === roomId)
        await Promise.all([
          db.upsertRoomSummary(accountId, {
            id: detail.room.id,
            name: detail.room.name,
            status: detail.room.status,
            visibility: detail.room.visibility,
            joinPolicy: detail.room.joinPolicy,
            humanCount:
              existing?.humanCount ??
              memberData.memberships.filter((item) => item.principalType === 'human').length,
            agentCount:
              existing?.agentCount ??
              memberData.memberships.filter((item) => item.principalType === 'agent').length,
            lastSequence: detail.room.lastSequence,
            lastReadSequence: existing?.lastReadSequence,
            unreadCount: 0,
            membershipRole: existing?.membershipRole,
            membershipStatus: detail.room.membershipStatus ?? existing?.membershipStatus,
            pinnedAt: existing?.pinnedAt,
            updatedAt: existing?.updatedAt ?? new Date().toISOString(),
            latestMessage:
              messageData.messages[messageData.messages.length - 1] ?? existing?.latestMessage,
            roomDetail: detail.room as unknown as Record<string, unknown>,
            membershipId: detail.membershipId,
          }),
          db.saveRoomMessages(accountId, roomId, messageData.messages),
          db.replaceRoomMembers(
            accountId,
            roomId,
            memberData.memberships.map((member) => ({
              id: member.id,
              roomId,
              payload: member as unknown as Record<string, unknown>,
            })),
          ),
          db.putRoomSyncState(
            mergeRoomSyncWindow(latestSyncState, {
              accountId,
              roomId,
              windowStartSequence: messageData.messages[0]?.sequence ?? '0',
              windowEndSequence:
                messageData.messages[messageData.messages.length - 1]?.sequence ?? '0',
              hasOlder: cachedSequence ? (latestSyncState?.hasOlder ?? false) : messageData.hasMore,
              serverLastSequence: detail.room.lastSequence,
            }),
          ),
        ])
      }
    } catch (error) {
      if (isRoomAccountForbidden(error) && accountId) {
        await db.removeRoom(accountId, roomId)
        removeRoomDraft(accountId, roomId)
      }
      if (restoredCached && !isRoomAccountForbidden(error)) return
      setState(isRoomAccountForbidden(error) ? 'forbidden' : 'failed')
    }
  }, [roomId, accountId])

  const refreshContext = useCallback(async () => {
    try {
      const [detail, memberData] = await fetchRoomContext(roomId)
      setRoom((current) => sameJson(current, detail.room) ? current : detail.room)
      setMembershipId(detail.membershipId)
      setMembers((current) => sameJson(current, memberData.memberships) ? current : memberData.memberships)
      if (accountId) {
        const summaries = await db.getRoomSummaries(accountId)
        const existing = summaries.find((item) => item.id === roomId)
        if (existing) {
          await db.upsertRoomSummary(accountId, {
            ...existing,
            name: detail.room.name,
            status: detail.room.status,
            visibility: detail.room.visibility,
            joinPolicy: detail.room.joinPolicy,
            lastSequence: detail.room.lastSequence,
            roomDetail: detail.room as unknown as Record<string, unknown>,
            membershipId: detail.membershipId,
          })
        }
        await db.replaceRoomMembers(
          accountId,
          roomId,
          memberData.memberships.map((member) => ({
            id: member.id,
            roomId,
            payload: member as unknown as Record<string, unknown>,
          })),
        )
      }
    } catch (error) {
      if (isRoomAccountForbidden(error) && accountId) {
        await db.removeRoom(accountId, roomId)
        removeRoomDraft(accountId, roomId)
        setState('forbidden')
        return
      }
      // A later Room event or foreground recovery retries without replacing the conversation.
    }
  }, [roomId, accountId])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    latestSequenceRef.current = messages[messages.length - 1]?.sequence ?? '0'
  }, [messages])

  useEffect(() => {
    if (state !== 'ready' || !accountId) return
    void db.replaceRoomMembers(
      accountId,
      roomId,
      members.map((member) => ({
        id: member.id,
        roomId,
        payload: member as unknown as Record<string, unknown>,
      })),
    )
  }, [members, roomId, state, accountId])

  useEffect(() => {
    if (state !== 'ready' || !accountId || !room) return
    void (async () => {
      const [summaries, existingSyncState] = await Promise.all([
        db.getRoomSummaries(accountId),
        db.getRoomSyncState(accountId, roomId),
      ])
      const existing = summaries.find((item) => item.id === roomId)
      const latest = messages[messages.length - 1]
      if (existing) {
        await db.upsertRoomSummary(accountId, {
          ...existing,
          name: room.name,
          status: room.status,
          visibility: room.visibility,
          joinPolicy: room.joinPolicy,
          lastSequence: latest?.sequence ?? room.lastSequence,
          latestMessage: latest ?? existing.latestMessage,
          updatedAt: latest?.createdAt ?? existing.updatedAt,
          roomDetail: room as unknown as Record<string, unknown>,
          membershipId,
        })
      }
      await db.putRoomSyncState(
        mergeRoomSyncWindow(existingSyncState, {
          accountId,
          roomId,
          windowStartSequence: messages[0]?.sequence ?? '0',
          windowEndSequence: latest?.sequence ?? '0',
          hasOlder,
          serverLastSequence: room.lastSequence,
        }),
      )
    })().catch(() => {})
  }, [hasOlder, membershipId, messages, room, roomId, state, accountId])

  const recoverNewMessages = useCallback((): Promise<void> => {
    if (stateRef.current !== 'ready') return Promise.resolve()
    if (recoveryPromiseRef.current) return recoveryPromiseRef.current

    const recovery = (async () => {
      let after = latestSequenceRef.current
      while (stateRef.current === 'ready') {
        const result = await roomAccountClient.listMessages(roomId, {
          after,
          limit: ROOM_MESSAGE_PAGE_SIZE,
        })
        if (result.messages.length === 0) return
        setMessages((current) => mergeMessages(current, result.messages))
        if (accountId) await db.saveRoomMessages(accountId, roomId, result.messages)
        after = result.messages[result.messages.length - 1]?.sequence ?? after
        latestSequenceRef.current = maxSequence(latestSequenceRef.current, after)
        if (!result.hasMore) {
          pendingGapRef.current = false
          // The Room detail may still contain the sequence from when the screen opened.
          // Once recovery reaches the tail, the visible message can be reported as read.
          setRoom((current) => current && compareSequence(after, current.lastSequence) > 0
            ? { ...current, lastSequence: after }
            : current)
          return
        }
      }
    })()
      .catch(() => {
        // Reconnect, foreground, or the next sequence gap will retry.
      })
      .finally(() => {
        if (recoveryPromiseRef.current === recovery) recoveryPromiseRef.current = null
      })

    recoveryPromiseRef.current = recovery
    return recovery
  }, [roomId, accountId])

  useEffect(
    () =>
      subscribeRoomEvents((event) => {
        if (event.event === 'room.sync.request') {
          void recoverNewMessages()
          return
        }
        if (event.event === 'room.replica.updated') {
          if (event.roomId === null || event.roomId === roomId) {
            void refreshContext()
            void recoverNewMessages()
          }
          return
        }
        if (event.roomId !== roomId) return
        if (event.event === 'room.read.local') return
        if (event.event === 'room.message.created') {
          const expected = incrementSequence(latestSequenceRef.current)
          if (compareSequence(event.message.sequence, expected) > 0) {
            // Do not acknowledge a tail message while an earlier sequence is missing.
            pendingGapRef.current = true
            void recoverNewMessages()
            return
          }
          latestSequenceRef.current = maxSequence(latestSequenceRef.current, event.message.sequence)
          setMessages((current) => mergeMessages(current, [event.message]))
          setRoom((current) => current && compareSequence(event.message.sequence, current.lastSequence) > 0
            ? { ...current, lastSequence: event.message.sequence }
            : current)
          if (accountId) void db.saveRoomMessages(accountId, roomId, [event.message])
          onNewMessages()
          return
        }
        void refreshContext()
      }),
    [recoverNewMessages, refreshContext, roomId, onNewMessages, accountId],
  )

  const loadOlderMessages = useCallback(async () => {
    let before = messages[0]?.sequence
    if (!before || !hasOlder || loadingOlderRef.current) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    setOlderLoadFailed(false)
    try {
      if (accountId) {
        const cached = await db.getRoomMessages(accountId, roomId, {
          before,
          limit: ROOM_MESSAGE_PAGE_SIZE,
        })
        if (cached.length) {
          setMessages((current) => mergeMessages(current, cached))
          before = cached[0]?.sequence ?? before
          if (cached.length === ROOM_MESSAGE_PAGE_SIZE) return
        }
      }
      const result = await roomAccountClient.listMessages(roomId, {
        before,
        limit: ROOM_MESSAGE_PAGE_SIZE,
      })
      setMessages((current) => mergeMessages(current, result.messages))
      if (accountId) await db.saveRoomMessages(accountId, roomId, result.messages)
      setHasOlder(result.hasMore)
    } catch {
      setOlderLoadFailed(true)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [hasOlder, messages, roomId, accountId])

  useEffect(() => {
    const previous = previousNetworkStatusRef.current
    previousNetworkStatusRef.current = networkStatus
    if (previous === 'offline' && networkStatus === 'online') void recoverNewMessages()
  }, [networkStatus, recoverNewMessages])

  const roomLastSequence = room?.lastSequence
  useEffect(() => {
    const sequence = messages[messages.length - 1]?.sequence
    if (!active || pendingGapRef.current || !membershipId || !sequence || !roomLastSequence || compareSequence(sequence, roomLastSequence) !== 0) return
    if (!shouldReportRoomRead(lastReportedReadRef.current, scope, sequence)) return
    lastReportedReadRef.current = { scope, sequence }
    void roomAccountClient.updateReadState(roomId, sequence)
      .then(() => publishRoomLocalRead(roomId, sequence))
      .catch(() => {
        const current = lastReportedReadRef.current
        if (current.scope === scope && current.sequence === sequence) {
          lastReportedReadRef.current = { scope: '', sequence: '0' }
        }
      })
  }, [active, membershipId, messages, roomLastSequence, roomId, scope])

  const sendMessage = useCallback(async (input: RoomSendInput) => {
    if (!isCurrent()) throw new Error('Room conversation changed.')
    const message = await roomAccountClient.sendMessage(roomId, input)
    if (!isCurrent()) throw new Error('Room conversation changed.')
    setMessages((current) => mergeMessages(current, [message]))
    if (compareSequence(message.sequence, incrementSequence(latestSequenceRef.current)) > 0) {
      pendingGapRef.current = true
      void recoverNewMessages()
    } else {
      latestSequenceRef.current = maxSequence(latestSequenceRef.current, message.sequence)
      setRoom((current) => current && compareSequence(message.sequence, current.lastSequence) > 0
        ? { ...current, lastSequence: message.sequence }
        : current)
    }
    if (accountId) await db.saveRoomMessages(accountId, roomId, [message])
    return message
  }, [accountId, isCurrent, recoverNewMessages, roomId])
  return { room, membershipId, members, messages, hasOlder, loadingOlder, olderLoadFailed, state,
    setRoom, setMembers, loadInitial, loadOlderMessages, sendMessage, isCurrent }
}
