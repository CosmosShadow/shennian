// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-workspace.test.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalRoomSummary } from '@shennian/shared'
import { db } from '../../storage/db'
import { getRoomListSnapshot } from './roomListCache'
import { removeRoomDraft } from './roomDraftStorage'
import { roomAccountClient, isRoomAccountForbidden, isRoomAccountNotFound } from './roomAccountClient'
import type { RoomDetailView, RoomMemberView } from './types'
import type { RoomWorkspaceDataOptions, WorkspaceLoadState } from './useRoomWorkspaceData.types'

function localRoomDetail(summary: LocalRoomSummary): RoomDetailView {
  return (
    (summary.roomDetail as RoomDetailView | undefined) ?? {
      id: summary.id,
      name: summary.name,
      conversationKind: summary.conversationKind,
      description: '',
      status: summary.status,
      visibility: summary.visibility,
      joinPolicy: summary.joinPolicy,
      lastSequence: summary.lastSequence,
      historyFromSequence: '1',
      membershipStatus: summary.membershipStatus ?? null,
    }
  )
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

export function useRoomWorkspaceData({ roomId, currentUserId }: RoomWorkspaceDataOptions) {
  const initialLocalSummary = getRoomListSnapshot(currentUserId ?? null)?.rooms.find(
    (item) => item.id === roomId,
  )
  const [room, setRoom] = useState<RoomDetailView | null>(() =>
    initialLocalSummary ? localRoomDetail(initialLocalSummary) : null,
  )
  const [members, setMembers] = useState<RoomMemberView[]>([])
  const [membersLoaded, setMembersLoaded] = useState(false)
  const [loadState, setLoadState] = useState<WorkspaceLoadState>(() =>
    initialLocalSummary ? 'ready' : 'loading',
  )
  const loadGenerationRef = useRef(0)
  const loadedRoomIdRef = useRef<string | null>(initialLocalSummary?.id ?? null)
  const membersReadyRoomIdRef = useRef<string | null>(null)

  const load = useCallback(
    async ({ preserveContent = false }: { preserveContent?: boolean } = {}) => {
      const generation = ++loadGenerationRef.current
      let restoredLocal = loadedRoomIdRef.current === roomId

      // The local cache only seeds a cold start. Once this room's members are in memory,
      // re-applying the cache would briefly replace fresh data with an older snapshot.
      if (currentUserId && membersReadyRoomIdRef.current !== roomId) {
        try {
          const [summaries, cachedMembers] = await Promise.all([
            db.getRoomSummaries(currentUserId),
            db.getRoomMembers(currentUserId, roomId),
          ])
          if (generation !== loadGenerationRef.current) return
          const cached = summaries.find((item) => item.id === roomId)
          if (cached) {
            setRoom(localRoomDetail(cached))
            setMembers(cachedMembers.map((item) => item.payload as RoomMemberView))
            setMembersLoaded(true)
            membersReadyRoomIdRef.current = roomId
            loadedRoomIdRef.current = roomId
            setLoadState('ready')
            restoredLocal = true
          }
        } catch {
          // A damaged/unavailable local store falls through to the remote cold-load path.
        }
      }

      if (!restoredLocal && !preserveContent) {
        setLoadState('loading')
        setRoom(null)
        setMembers([])
        setMembersLoaded(false)
        membersReadyRoomIdRef.current = null
      }

      try {
        const [detail, memberData] = await Promise.all([
          roomAccountClient.getRoom(roomId),
          roomAccountClient.listMembers(roomId),
        ])
        if (generation !== loadGenerationRef.current) return
        if (currentUserId) {
          const summaries = await db.getRoomSummaries(currentUserId)
          const existing = summaries.find((item) => item.id === roomId)
          await Promise.all([
            db.upsertRoomSummary(currentUserId, {
              id: detail.room.id,
              name: detail.room.name,
              status: detail.room.status,
              visibility: detail.room.visibility,
              joinPolicy: detail.room.joinPolicy,
              humanCount: memberData.filter((item) => item.principalType === 'human').length,
              agentCount: memberData.filter((item) => item.principalType === 'agent').length,
              lastSequence: detail.room.lastSequence,
              lastReadSequence: existing?.lastReadSequence,
              unreadCount: existing?.unreadCount,
              membershipRole: existing?.membershipRole,
              membershipStatus: detail.room.membershipStatus ?? existing?.membershipStatus,
              pinnedAt: existing?.pinnedAt,
              updatedAt: existing?.updatedAt ?? new Date().toISOString(),
              latestMessage: existing?.latestMessage,
              avatarMembers: existing?.avatarMembers,
              roomDetail: detail.room as unknown as Record<string, unknown>,
              membershipId: detail.membershipId,
            }),
            db.replaceRoomMembers(
              currentUserId,
              roomId,
              memberData.map((member) => ({
                id: member.id,
                roomId,
                payload: member as unknown as Record<string, unknown>,
              })),
            ),
          ])
        }
        if (generation !== loadGenerationRef.current) return
        setRoom((current) => sameJson(current, detail.room) ? current : detail.room)
        setMembers((current) => sameJson(current, memberData) ? current : memberData)
        setMembersLoaded(true)
        membersReadyRoomIdRef.current = roomId
        loadedRoomIdRef.current = roomId
        setLoadState('ready')
      } catch (error) {
        if (generation !== loadGenerationRef.current) return
        const forbidden = isRoomAccountForbidden(error)
        const unavailable = forbidden || isRoomAccountNotFound(error)
        if (unavailable) {
          if (forbidden && currentUserId) {
            await db.removeRoom(currentUserId, roomId).catch(() => {})
            removeRoomDraft(currentUserId, roomId)
          }
          setRoom(null)
          setMembers([])
          setMembersLoaded(false)
          membersReadyRoomIdRef.current = null
          loadedRoomIdRef.current = null
          setLoadState('unavailable')
          return
        }
        if (restoredLocal || preserveContent) return
        setLoadState('failed')
      }
    },
    [currentUserId, roomId],
  )

  const cancelLoad = useCallback(() => { loadGenerationRef.current += 1 }, [])
  useEffect(() => {
    membersReadyRoomIdRef.current = null
    return cancelLoad
  }, [cancelLoad, currentUserId, roomId])
  return { room, members, membersLoaded, loadState, setMembers, load, cancelLoad,
    hasCurrentRoom: loadedRoomIdRef.current === roomId }
}
