// @arch docs/features/conversation-schedules.md
// @test src/__tests__/session-details-modal.test.ts
import { useEffect, useState } from 'react'
import { scheduleClient } from './scheduleClient'
import { hasActiveSchedule } from './scheduleVisibility'

/**
 * Whether a session currently has any non-ended schedule. Used to decide whether a standalone
 * "定时任务" menu entry should render at all, since ConversationSchedules itself only renders
 * once opened — an always-visible menu item would still expose the feature to new users with
 * zero schedules even though the dialog behind it ends up empty.
 */
export function useHasActiveSchedules(
  sessionId: string | undefined,
  enabled: boolean,
): { hasActiveSchedules: boolean; refresh: () => void } {
  const [hasActiveSchedules, setHasActiveSchedules] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  useEffect(() => {
    if (!enabled || !sessionId) {
      setHasActiveSchedules(false)
      return
    }
    let active = true
    void scheduleClient
      .list({ sessionId })
      .then((tasks) => {
        if (active) setHasActiveSchedules(hasActiveSchedule(tasks))
      })
      .catch(() => {
        // A failed lookup is not evidence that the session has no schedules. Keep the management
        // entry available so historical schedules retain the dialog's existing retry path.
        if (active) setHasActiveSchedules(true)
      })
    return () => {
      active = false
    }
  }, [enabled, sessionId, refreshToken])
  return { hasActiveSchedules, refresh: () => setRefreshToken((token) => token + 1) }
}
