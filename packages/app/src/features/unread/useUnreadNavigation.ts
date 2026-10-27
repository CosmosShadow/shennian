import { useOwnerDirectUnread } from '../published-agents/useOwnerDirectUnread'
// @arch docs/features/unread-notification-center.md
// @test src/__tests__/unread-navigation.test.ts

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useSessionsStore } from '@shennian/shared'
import type { RoomSummary } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import {
  getRoomListSnapshot,
  subscribeRoomListSnapshots,
} from '../rooms/roomListCache'
import { getUnreadNavigationSummary } from './unreadNavigation'
import { syncSessionUnreadProjection } from '../../lib/session-unread-sync'
import { useSessionUnreadCounts } from './useSessionUnreadCounts'

const EMPTY_ROOMS: RoomSummary[] = []

export function useUnreadNavigation() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const ownerDirectUnread = useOwnerDirectUnread()
  const sessions = useSessionsStore((state) => state.sessions)
  const getRoomsSnapshot = useCallback(
    () => getRoomListSnapshot(accountId)?.rooms ?? EMPTY_ROOMS,
    [accountId],
  )
  const rooms = useSyncExternalStore(
    subscribeRoomListSnapshots,
    getRoomsSnapshot,
    getRoomsSnapshot,
  )
  const sessionUnreadCounts = useSessionUnreadCounts()
  const sessionUnreadRevision = useMemo(
    () =>
      sessions
        .map(
          (session) =>
            `${session.id}:${session.attentionCount ?? 0}:${session.lastAttentionId ?? ''}:${session.userState?.lastReadAttentionCount ?? 0}:${session.userState?.lastReadAttentionId ?? ''}:${session.userState?.manualUnread ? 1 : 0}`,
        )
        .join('|'),
    [sessions],
  )

  useEffect(() => {
    void syncSessionUnreadProjection(sessions).catch(() => {})
    // Session activity pulses do not affect unread counts. The revision only
    // changes when a message/read watermark can change the visible count.
  }, [sessionUnreadRevision])

  return useMemo(
    () => getUnreadNavigationSummary(sessions, rooms, sessionUnreadCounts, ownerDirectUnread),
    [rooms, sessionUnreadCounts, sessions, ownerDirectUnread],
  )
}
