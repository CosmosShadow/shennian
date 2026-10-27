// @covers src/services/agent-runtime-availability.ts

import { describe, expect, it } from 'vitest'
import {
  deriveAgentRepairAction,
  deriveAgentRuntimeAvailability,
  deriveRoomBindingAvailability,
} from '../services/agent-runtime-availability.js'

describe('Agent runtime availability', () => {
  it('requires a paired online machine', () => {
    expect(deriveAgentRuntimeAvailability({ paired: true, online: true })).toBe('available')
    expect(deriveAgentRuntimeAvailability({ paired: true, online: false })).toBe('unavailable')
    expect(deriveAgentRuntimeAvailability({ paired: false, online: true })).toBe('unavailable')
    expect(deriveAgentRuntimeAvailability(null)).toBe('unavailable')
  })

  it('keeps paused work available while detached work is unavailable', () => {
    const machine = { paired: true, online: true }
    expect(deriveRoomBindingAvailability({ status: 'paused', machine })).toBe('available')
    expect(deriveRoomBindingAvailability({ status: 'detached', machine })).toBe('unavailable')
    expect(deriveRoomBindingAvailability({ status: 'active', machine, recovering: true })).toBe(
      'recovering',
    )
  })

  it('returns exactly one owner repair action without exposing technical detail', () => {
    expect(deriveAgentRepairAction({ availability: 'recovering' })).toBeNull()
    expect(deriveAgentRepairAction({ availability: 'available' })).toBeNull()
    expect(deriveAgentRepairAction({ availability: 'unavailable' })).toBe('configure')
    expect(
      deriveAgentRepairAction({
        availability: 'unavailable',
        detachedReason: 'recovery_failed',
      }),
    ).toBe('retry')
  })
})
