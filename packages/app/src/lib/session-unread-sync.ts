// @arch docs/features/unread-notification-center.md
// @test src/__tests__/session-unread-sync.test.ts

import type { NianSession } from '@shennian/wire'
import { scheduleNativeBadgeSync } from './push-badge'
import { refreshSessionUnreadCounts } from './session-unread-count-cache'

export async function syncSessionUnreadProjection(
  sessions: NianSession[],
  dependencies: {
    refresh?: typeof refreshSessionUnreadCounts
    scheduleBadge?: typeof scheduleNativeBadgeSync
  } = {},
): Promise<void> {
  await (dependencies.refresh ?? refreshSessionUnreadCounts)(sessions)
  const scheduleBadge = dependencies.scheduleBadge ?? scheduleNativeBadgeSync
  scheduleBadge()
}
