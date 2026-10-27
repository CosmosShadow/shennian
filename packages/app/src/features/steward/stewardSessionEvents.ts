// @test ../../__tests__/steward-navigation.test.ts

import type { EventFrame } from '@shennian/wire'

type SessionUpdateListener = (machineId: string) => void
type ResyncListener = () => void

const sessionListeners = new Set<SessionUpdateListener>()
const resyncListeners = new Set<ResyncListener>()

/**
 * The relay already pushes every steward session change (an AI-failover
 * moving the steward to a new conversation, a title change, etc.) as an
 * ordinary `session.update` event; the generic sync engine drops it because
 * steward sessions are marked internal there. Forward the ones that matter
 * so the steward page can refresh on the actual event instead of polling.
 */
export function publishStewardSessionEvent(frame: EventFrame): boolean {
  if (frame.event !== 'session.update' || !frame.payload || typeof frame.payload !== 'object') return false
  const payload = frame.payload as { machineId?: string; session?: { sessionScope?: string | null } }
  if (!payload.machineId || payload.session?.sessionScope !== 'steward') return false
  for (const listener of sessionListeners) listener(payload.machineId)
  return true
}

export function subscribeStewardSessionEvents(listener: SessionUpdateListener): () => void {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

/** Relay reconnect / app-foreground: catch up on anything missed while disconnected. */
export function publishStewardResync(): void {
  for (const listener of resyncListeners) listener()
}

export function subscribeStewardResync(listener: ResyncListener): () => void {
  resyncListeners.add(listener)
  return () => resyncListeners.delete(listener)
}
