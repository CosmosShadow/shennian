// @covers src/features/agents/agentEvents.ts

import { describe, expect, it, vi } from 'vitest'
import {
  publishAgentRefreshEvent,
  subscribeAgentRefresh,
} from '../features/agents/agentEvents'

describe('Agent refresh events', () => {
  it('notifies Agent projections for machine and Room binding changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAgentRefresh(listener)
    expect(publishAgentRefreshEvent({ type: 'event', event: 'machine.removed' })).toBe(true)
    expect(publishAgentRefreshEvent({ type: 'event', event: 'room.binding.updated' })).toBe(true)
    expect(listener).toHaveBeenNthCalledWith(1, { type: 'event', event: 'machine.removed' })
    expect(listener).toHaveBeenNthCalledWith(2, { type: 'event', event: 'room.binding.updated' })
    unsubscribe()
  })

  it('ignores unrelated personal events', () => {
    expect(publishAgentRefreshEvent({ type: 'event', event: 'session.update' })).toBe(false)
  })
})
