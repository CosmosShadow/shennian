// @covers src/lib/agent-participation.ts

import { describe, expect, it } from 'vitest'
import {
  deriveCompactAgentParticipation,
  isAgentRuntimeOffline,
} from '../lib/agent-participation'

describe('Agent participation projection', () => {
  it.each([
    ['auto_follow', 'available', 'auto'],
    ['mention_only', 'available', 'mention'],
    ['paused', 'available', 'paused'],
    ['auto_follow', 'unavailable', 'auto'],
    ['mention_only', 'recovering', 'mention'],
  ] as const)('maps %s + %s to %s', (activationMode, availability, expected) => {
    expect(deriveCompactAgentParticipation({
      principalType: 'agent', activationMode, availability,
    })).toBe(expected)
  })

  it('never assigns a work mode to a human member', () => {
    expect(deriveCompactAgentParticipation({
      principalType: 'human', activationMode: 'auto_follow', availability: 'available',
    })).toBeNull()
  })

  it('does not invent a fourth mode from detached legacy data', () => {
    expect(deriveCompactAgentParticipation({
      principalType: 'agent', bindingStatus: 'detached',
    })).toBeNull()
    expect(deriveCompactAgentParticipation({ principalType: 'agent' })).toBeNull()
  })

  it('keeps an explicit pause distinct from runtime unavailability', () => {
    expect(deriveCompactAgentParticipation({
      principalType: 'agent', activationMode: 'paused', availability: 'available',
    })).toBe('paused')
    expect(deriveCompactAgentParticipation({
      principalType: 'agent', activationMode: 'paused', availability: 'unavailable',
    })).toBe('paused')
  })

  it('treats recovery as offline in every compact UI', () => {
    expect(isAgentRuntimeOffline('recovering')).toBe(true)
    expect(isAgentRuntimeOffline('available')).toBe(false)
    expect(isAgentRuntimeOffline(undefined)).toBe(false)
  })
})
