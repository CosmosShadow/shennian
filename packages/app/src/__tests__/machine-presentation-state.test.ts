// @covers src/hooks/useMachinePresentationState.ts

import { describe, expect, it } from 'vitest'
import {
  MACHINE_RECONNECTING_DELAY_MS,
  resolveMachinePresentationState,
} from '../hooks/useMachinePresentationState'

describe('machine presentation state', () => {
  it('does not turn cached objects offline when the account Relay is unavailable', () => {
    expect(
      resolveMachinePresentationState({
        relayPhase: 'recovering',
        machineOnline: false,
        offlineObservedAt: null,
        now: 20_000,
      }),
    ).toBe('unknown')
    expect(
      resolveMachinePresentationState({
        relayPhase: null,
        machineOnline: false,
        offlineObservedAt: null,
        now: 20_000,
      }),
    ).toBe('unknown')
  })

  it('shows a recent machine disconnect as reconnecting', () => {
    expect(
      resolveMachinePresentationState({
        relayPhase: 'connected',
        machineOnline: false,
        offlineObservedAt: 10_000,
        now: 10_000 + MACHINE_RECONNECTING_DELAY_MS - 1,
      }),
    ).toBe('reconnecting')
  })

  it('shows a confirmed or initially loaded offline machine as offline', () => {
    expect(
      resolveMachinePresentationState({
        relayPhase: 'connected',
        machineOnline: false,
        offlineObservedAt: 10_000,
        now: 10_000 + MACHINE_RECONNECTING_DELAY_MS,
      }),
    ).toBe('offline')
    expect(
      resolveMachinePresentationState({
        relayPhase: 'connected',
        machineOnline: false,
        offlineObservedAt: null,
        now: 20_000,
      }),
    ).toBe('offline')
  })

  it('keeps a confirmed online machine online', () => {
    expect(
      resolveMachinePresentationState({
        relayPhase: 'connected',
        machineOnline: true,
        offlineObservedAt: null,
        now: 20_000,
      }),
    ).toBe('online')
  })

  it('does not invent an offline state for a missing machine record', () => {
    expect(
      resolveMachinePresentationState({
        relayPhase: 'connected',
        machineOnline: null,
        offlineObservedAt: null,
        now: 20_000,
      }),
    ).toBe('unknown')
  })
})
