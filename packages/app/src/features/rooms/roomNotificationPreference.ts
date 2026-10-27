// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

import type { RoomNotificationPreferences } from './roomAccountClient.types'

export type RoomNotificationMode = 'all' | 'mentions' | 'none'

export const ROOM_NOTIFICATION_MODES: RoomNotificationMode[] = ['all', 'mentions', 'none']

export function roomNotificationModeFromPreferences(
  preferences: RoomNotificationPreferences,
): RoomNotificationMode {
  // A historical false/true pair still means mentions were intentionally muted.
  // Treat it as fully muted so a newer client never silently re-enables them.
  if (preferences.muteMentionNotifications) return 'none'
  if (preferences.muteRegularNotifications) return 'mentions'
  return 'all'
}

export function roomNotificationPreferencesForMode(
  mode: RoomNotificationMode,
): RoomNotificationPreferences {
  if (mode === 'mentions') {
    return { muteRegularNotifications: true, muteMentionNotifications: false }
  }
  if (mode === 'none') {
    return { muteRegularNotifications: true, muteMentionNotifications: true }
  }
  return { muteRegularNotifications: false, muteMentionNotifications: false }
}
