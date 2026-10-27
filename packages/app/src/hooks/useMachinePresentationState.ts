// @arch docs/design/components.md#9-状态组件
// @test src/__tests__/machine-presentation-state.test.ts

import { useEffect, useRef, useState } from 'react'
import type { RelayConnectivityPhase } from '@shennian/wire'

export const MACHINE_RECONNECTING_DELAY_MS = 8_000

export type MachinePresentationState = 'unknown' | 'online' | 'reconnecting' | 'offline'

export function resolveMachinePresentationState(input: {
  relayPhase: RelayConnectivityPhase | null
  machineOnline: boolean | null
  offlineObservedAt: number | null
  now: number
}): MachinePresentationState {
  if (input.relayPhase !== 'connected') return 'unknown'
  if (input.machineOnline === null) return 'unknown'
  if (input.machineOnline) return 'online'
  if (
    input.offlineObservedAt !== null &&
    input.now - input.offlineObservedAt < MACHINE_RECONNECTING_DELAY_MS
  ) {
    return 'reconnecting'
  }
  return 'offline'
}

/**
 * Keeps cached machine state neutral while the account Relay is unavailable.
 * A machine that changes from online to offline gets a short reconnecting
 * presentation window; a machine already offline on first load is shown as
 * offline immediately once the account connection is authoritative.
 */
export function useMachinePresentationState(
  machineOnline: boolean | null,
  relayPhase: RelayConnectivityPhase | null,
): MachinePresentationState {
  const trackerRef = useRef({
    machineOnline,
    offlineObservedAt: null as number | null,
  })
  const [now, setNow] = useState(Date.now())

  if (trackerRef.current.machineOnline !== machineOnline) {
    trackerRef.current.machineOnline = machineOnline
    trackerRef.current.offlineObservedAt = machineOnline === false ? Date.now() : null
  }

  const offlineObservedAt = trackerRef.current.offlineObservedAt
  useEffect(() => {
    setNow(Date.now())
    if (machineOnline !== false || offlineObservedAt === null) return
    const remaining = MACHINE_RECONNECTING_DELAY_MS - (Date.now() - offlineObservedAt)
    if (remaining <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), remaining + 10)
    return () => clearTimeout(timer)
  }, [machineOnline, offlineObservedAt])

  return resolveMachinePresentationState({
    relayPhase,
    machineOnline,
    offlineObservedAt,
    now,
  })
}
