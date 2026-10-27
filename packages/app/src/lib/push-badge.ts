// @test src/__tests__/push-badge.test.ts
import { Platform } from 'react-native'
import { db } from '../storage/db'
import { countUnreadVisibleMessages } from './push-badge-count'
import { createBadgeSyncScheduler } from './badge-sync-scheduler'
import { useAuthStore } from '../config/auth'
import { getRoomListSnapshot } from '../features/rooms/roomListCache'
import { filterProjectSessions } from '@shennian/shared'
import { nativePushEnabled } from './native-push-policy'

async function calculateAndApplyNativeBadgeCount(): Promise<number> {
  if (Platform.OS === 'web' || !nativePushEnabled()) return 0

  const nextBadge = await (async () => {
    const accountId = useAuthStore.getState().user?.id ?? null
    const sessions = await db.getSessions()
    const eligibleSessionIds = new Set(
      filterProjectSessions(sessions).map((session) => session.id),
    )
    const sessionCount = countUnreadVisibleMessages({
      sessions: sessions.filter((session) => eligibleSessionIds.has(session.id)),
    })
    const roomCount =
      getRoomListSnapshot(accountId)?.rooms.reduce(
        (total, room) => total + ((room.unreadCount ?? 0) > 0 ? 1 : 0),
        0,
      ) ?? 0
    return sessionCount + roomCount
  })().catch(() => 0)

  try {
    const Notifications = await import('expo-notifications')
    // Denied badge permission is an expected user choice, not a repeatedly failing sync.
    if (Platform.OS === 'ios') {
      const permission = await Notifications.getPermissionsAsync()
      if (permission.ios?.allowsBadge === false || (!permission.granted && permission.ios?.allowsBadge !== true)) return nextBadge
    }
    const applied = await Notifications.setBadgeCountAsync(nextBadge)
    if (!applied) {
      console.warn('[push] native badge update was rejected', {
        platform: Platform.OS,
        badge: nextBadge,
      })
    }
  } catch (error) {
    console.warn('[push] native badge update failed', {
      platform: Platform.OS,
      badge: nextBadge,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return nextBadge
}

const scheduler = createBadgeSyncScheduler(calculateAndApplyNativeBadgeCount)

export function syncNativeBadgeCount(): Promise<number> {
  if (Platform.OS === 'web') return Promise.resolve(0)
  return scheduler.runNow()
}

export function scheduleNativeBadgeSync(delayMs = 150): void {
  if (Platform.OS === 'web') return
  scheduler.schedule(delayMs)
}
