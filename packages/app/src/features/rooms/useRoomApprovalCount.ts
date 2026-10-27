// @arch docs/features/network-rooms/ui.md#入群审批提醒
// @test src/__tests__/room-approval-counts.test.ts

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuthStore } from '../../config/auth'
import {
  roomAccountClient,
  isRoomAccountForbidden,
  isRoomAccountNotFound,
} from './roomAccountClient'
import { roomApprovalCounts } from './roomApprovalCounts'
import { subscribeRoomEvents } from './roomEvents'
import { getRoomListSnapshot, subscribeRoomListSnapshots } from './roomListCache'

const watchers = new Map<string, { release: () => void; users: number }>()
function watch(accountId: string, roomId: string) {
  const key = JSON.stringify([accountId, roomId])
  let watcher = watchers.get(key)
  if (!watcher) {
    const refresh = () =>
      void roomApprovalCounts.refresh(accountId, roomId, async () => {
        try {
          return await roomAccountClient.listPendingJoinRequests(roomId)
        } catch (error) {
          if (isRoomAccountForbidden(error) || isRoomAccountNotFound(error)) return []
          throw error
        }
      })
    const unsubscribe = subscribeRoomEvents((event) => {
      if (
        event.event === 'room.sync.request' ||
        (event.event === 'room.replica.updated' && event.roomId === null) ||
        ('roomId' in event &&
          event.roomId === roomId &&
          (event.event.startsWith('room.join_request.') ||
            event.event === 'room.membership.updated' ||
            event.event === 'room.updated' ||
            event.event === 'room.replica.updated'))
      )
        refresh()
    })
    refresh()
    watcher = { release: unsubscribe, users: 0 }
    watchers.set(key, watcher)
  }
  watcher.users++
  return () => {
    if (--watcher.users === 0) {
      watcher.release()
      watchers.delete(key)
    }
  }
}

/** No roomId aggregates only active rooms the current account owns. */
export function useRoomApprovalCount(roomId?: string, canApprove = true) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const getIds = useCallback(
    () =>
      JSON.stringify(
        !accountId || !canApprove
          ? []
          : roomId
            ? [roomId]
            : (getRoomListSnapshot(accountId)?.rooms ?? [])
                .filter((room) => room.status === 'active' && room.membershipRole === 'owner')
                .map((room) => room.id)
                .sort(),
      ),
    [accountId, canApprove, roomId],
  )
  const ids = useSyncExternalStore(subscribeRoomListSnapshots, getIds, getIds)
  useEffect(() => {
    if (!accountId) return
    const releases = (JSON.parse(ids) as string[]).map((id) => watch(accountId, id))
    return () => releases.forEach((release) => release())
  }, [accountId, ids])
  const getCount = useCallback(
    () =>
      accountId
        ? (JSON.parse(ids) as string[]).reduce(
            (sum, id) => sum + roomApprovalCounts.get(accountId, id),
            0,
          )
        : 0,
    [accountId, ids],
  )
  return useSyncExternalStore(roomApprovalCounts.subscribe, getCount, getCount)
}
