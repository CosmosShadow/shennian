// @arch docs/architecture/session-list.md
// @test src/__tests__/session-activity-expiry.test.ts

import { useEffect, useReducer } from 'react'
import { SESSION_ACTIVITY_STALE_MS } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'

type ActivitySession = Pick<NianSession, 'activity'>

export function nextSessionActivityExpiry(sessions: readonly ActivitySession[], now: number): number | null {
  let next = Infinity
  for (const session of sessions) {
    const updatedAt = Date.parse(session.activity?.updatedAt ?? '')
    // Match getLiveSessionActivitySnapshot: only positive, valid timestamps expire.
    const expiresAt = updatedAt + SESSION_ACTIVITY_STALE_MS + 1
    if (updatedAt > 0 && expiresAt > now) next = Math.min(next, expiresAt)
  }
  return Number.isFinite(next) ? next : null
}

/** Re-evaluate cached activity even if weak network produces no further events. */
export function useSessionActivityNow(sessions: readonly ActivitySession[]): number {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0)
  const now = Date.now()
  const expiresAt = nextSessionActivityExpiry(sessions, now)
  useEffect(() => {
    if (expiresAt === null) return
    const timer = setTimeout(refresh, Math.min(2_147_483_647, Math.max(0, expiresAt - Date.now())))
    return () => clearTimeout(timer)
  }, [expiresAt])
  return now
}
