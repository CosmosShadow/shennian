/**
 * @covers src/hooks/useAppConnectivityStatus.ts
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DISCONNECTED_DELAY_MS,
  CONNECTING_FEEDBACK_DELAY_MS,
  resolveAppConnectivityStatus,
  resolveRelayConnectivityFeedback,
} from '../hooks/appConnectivityState'
import type { RelayConnectivitySnapshot } from '@shennian/wire'

function snapshot(
  patch: Partial<RelayConnectivitySnapshot>,
): RelayConnectivitySnapshot {
  return {
    phase: 'recovering', reason: 'transient_transport', closeCode: 1006,
    closeReason: null, retryable: true, retryAttempt: 1, nextRetryAt: null,
    disconnectedAt: 1_000, lastConnectedAt: 500, connectionId: 'relay-test',
    ...patch,
  }
}

describe('app connectivity status', () => {
  it('shares one foreground grace period across retries and resets it after background', () => {
    const source = readFileSync(resolve(__dirname, '../hooks/useAppConnectivityStatus.ts'), 'utf8')
    expect(source).toContain("const relayUnavailable = relayState === 'connecting' || relayState === 'disconnected'")
    expect(source).toContain('if (!isActive || !relayUnavailable)')
    expect(source).toContain('}, [isActive, relayUnavailable])')
    expect(source).not.toContain('}, [relayState])')
  })

  it('allows ten seconds for a weak network or slow service to recover', () => {
    expect(DISCONNECTED_DELAY_MS).toBe(10_000)
  })

  it('shows disconnected immediately when the device network is unavailable', () => {
    expect(resolveAppConnectivityStatus('offline', 'connected', false)).toBe('disconnected')
  })

  it('waits through a short service reconnect before showing disconnected', () => {
    expect(resolveAppConnectivityStatus('online', 'connecting', false)).toBe('connected')
    expect(resolveAppConnectivityStatus('online', 'connecting', true)).toBe('disconnected')
    expect(resolveAppConnectivityStatus('online', 'disconnected', true)).toBe('disconnected')
  })

  it('keeps an unknown startup state quiet', () => {
    expect(resolveAppConnectivityStatus('unknown', 'unknown', false)).toBe('connected')
    expect(resolveAppConnectivityStatus('online', 'connected', false)).toBe('connected')
  })

  it('suppresses initial connection flicker, then identifies a slow connection', () => {
    const value = snapshot({ phase: 'connecting', disconnectedAt: null })
    expect(resolveRelayConnectivityFeedback(value, 5_999, 1_000)).toBe('hidden')
    expect(resolveRelayConnectivityFeedback(value, 6_000, 1_000)).toBe('connecting')
    expect(CONNECTING_FEEDBACK_DELAY_MS).toBe(5_000)
  })

  it('keeps recovery quiet for five seconds, then escalates at ten seconds', () => {
    const value = snapshot({ disconnectedAt: 1_000 })
    expect(resolveRelayConnectivityFeedback(value, 5_999, 1_000)).toBe('hidden')
    expect(resolveRelayConnectivityFeedback(value, 6_000, 1_000)).toBe('reconnecting')
    expect(resolveRelayConnectivityFeedback(value, 10_999, 1_000)).toBe('reconnecting')
    expect(resolveRelayConnectivityFeedback(value, 11_000, 1_000)).toBe('disconnected')
  })

  it('does not count a stale background disconnect against the foreground grace period', () => {
    const value = snapshot({ disconnectedAt: 1_000 })
    expect(resolveRelayConnectivityFeedback(value, 60_000, 60_000)).toBe('hidden')
    expect(resolveRelayConnectivityFeedback(value, 64_999, 60_000)).toBe('hidden')
    expect(resolveRelayConnectivityFeedback(value, 65_000, 60_000)).toBe('reconnecting')
    expect(resolveRelayConnectivityFeedback(value, 70_000, 60_000)).toBe('disconnected')
  })

  it('hides feedback immediately after recovery, including at the five-second boundary', () => {
    for (const now of [5_999, 6_000, 11_000]) {
      expect(resolveRelayConnectivityFeedback(snapshot({ phase: 'connected' }), now, 1_000)).toBe('hidden')
    }
    expect(resolveRelayConnectivityFeedback(null, 11_000, 1_000)).toBe('hidden')
  })

  it('escalates a continuously slow connection at ten seconds', () => {
    expect(resolveRelayConnectivityFeedback(
      snapshot({ phase: 'connecting' }), 11_000, 1_000,
    )).toBe('disconnected')
  })

  it('maps terminal reasons without relying on color', () => {
    expect(resolveRelayConnectivityFeedback(
      snapshot({ phase: 'blocked', reason: 'version_unsupported', retryable: false }),
      1_000,
      1_000,
    )).toBe('version_unsupported')
    expect(resolveRelayConnectivityFeedback(
      snapshot({ phase: 'offline', reason: 'network_offline' }),
      1_000,
      1_000,
    )).toBe('network_offline')
  })

  it('keeps a retryable machine failure distinct from the account relay', () => {
    expect(resolveRelayConnectivityFeedback(
      snapshot({ phase: 'recovering', reason: 'machine_unavailable', closeCode: 4004 }),
      1_000,
      1_000,
    )).toBe('machine_unavailable')
  })
})
