// @arch docs/features/machine-removal-agent-recovery.md
// @test ../../__tests__/agent-events.test.ts

import type { EventFrame } from '@shennian/wire'

type Listener = (frame: EventFrame) => void
const listeners = new Set<Listener>()
const REFRESH_EVENTS = new Set([
  'machine.removed',
  'machine.status',
  'room.binding.updated',
  'room.membership.updated',
])

export function publishAgentRefreshEvent(frame: EventFrame): boolean {
  if (!REFRESH_EVENTS.has(frame.event)) return false
  for (const listener of listeners) listener(frame)
  return true
}

export function subscribeAgentRefresh(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Emitted only after the main-process Agent projection commits. */
export function publishAgentReplicaRevision(): void {
  const frame: EventFrame = { type: 'event', event: 'agent.replica.updated', payload: { agentId: null } }
  for (const listener of listeners) listener(frame)
}
