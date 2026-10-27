// @arch docs/features/unread-notification-center.md
// @test src/__tests__/session-unread-count-cache.test.ts

import type { NianSession } from '@shennian/wire'
import { countSessionUnreadVisibleMessages } from './push-badge-count'

export type SessionUnreadCounts = Readonly<Record<string, number>>

let snapshot: SessionUnreadCounts = Object.freeze({})
let refreshGeneration = 0
const listeners = new Set<() => void>()

export function getSessionUnreadCountSnapshot(): SessionUnreadCounts {
  return snapshot
}

export function subscribeSessionUnreadCounts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function refreshSessionUnreadCounts(sessions: NianSession[]): Promise<void> {
  const generation = ++refreshGeneration
  const entries = await Promise.all(
    sessions.map(
      async (session) =>
        [
          session.id,
          countSessionUnreadVisibleMessages({ session }),
        ] as const,
    ),
  )
  if (generation !== refreshGeneration) return

  const next = Object.freeze(Object.fromEntries(entries))
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(next)])
  if ([...keys].every((key) => snapshot[key] === next[key])) return
  snapshot = next
  listeners.forEach((listener) => listener())
}
