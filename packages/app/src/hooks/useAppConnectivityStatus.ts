// @arch docs/design/components.md#9-状态组件
// @test src/__tests__/app-connectivity-status.test.ts

import { useEffect, useRef, useState } from 'react'
import type { RelayConnectivitySnapshot } from '@shennian/wire'
import { accountRuntime } from '../features/account-runtime/accountRuntime'
import { useNetworkStatus } from './useNetworkStatus'
import { useAppIsActive } from './useAppIsActive'
import {
  DISCONNECTED_DELAY_MS,
  CONNECTING_FEEDBACK_DELAY_MS,
  resolveAppConnectivityStatus,
  resolveRelayConnectivityFeedback,
  type AppConnectivityStatus,
  type RelayConnectivityFeedbackStatus,
} from './appConnectivityState'

export type { AppConnectivityStatus } from './appConnectivityState'

export function useRelayConnectivitySnapshot(): RelayConnectivitySnapshot | null {
  const [snapshot, setSnapshot] = useState<RelayConnectivitySnapshot | null>(() =>
    accountRuntime.getConnectivitySnapshot(),
  )

  useEffect(() => {
    setSnapshot(accountRuntime.getConnectivitySnapshot())
    return accountRuntime.subscribeConnectivity(setSnapshot)
  }, [])

  return snapshot
}

export function useRelayConnectivityFeedbackStatus(
  snapshot: RelayConnectivitySnapshot | null,
): RelayConnectivityFeedbackStatus {
  const isActive = useAppIsActive()
  const isPending = snapshot?.phase === 'connecting' || snapshot?.phase === 'recovering'
  // Retry attempts must share one foreground waiting window. Reset only on
  // entry, foreground, or a transition out of transient connection recovery.
  const phaseKey = `${isActive}:${isPending}`
  const observedKeyRef = useRef(phaseKey)
  const observedAtRef = useRef(Date.now())
  if (observedKeyRef.current !== phaseKey) {
    observedKeyRef.current = phaseKey
    observedAtRef.current = Date.now()
  }
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    setNow(Date.now())
    if (!isActive || !isPending) return
    const timers = [CONNECTING_FEEDBACK_DELAY_MS, DISCONNECTED_DELAY_MS].map((threshold) => {
      const delay = Math.max(0, threshold - (Date.now() - observedAtRef.current))
      return setTimeout(() => setNow(Date.now()), delay)
    })
    return () => timers.forEach(clearTimeout)
  }, [phaseKey, isActive, isPending])

  if (!isActive && isPending) return 'hidden'
  return resolveRelayConnectivityFeedback(snapshot, now, observedAtRef.current)
}

export function useAppConnectivityStatus(): AppConnectivityStatus {
  const networkStatus = useNetworkStatus()
  const isActive = useAppIsActive()
  const connectivity = useRelayConnectivitySnapshot()
  const relayState = connectivity?.phase === 'connected'
    ? 'connected'
    : connectivity?.phase === 'connecting'
      ? 'connecting'
      : connectivity
        ? 'disconnected'
        : 'unknown'
  const [relayUnavailableLongEnough, setRelayUnavailableLongEnough] = useState(false)
  // Retry attempts alternate connecting/recovering; share one unavailable window.
  const relayUnavailable = relayState === 'connecting' || relayState === 'disconnected'

  useEffect(() => {
    if (!isActive || !relayUnavailable) {
      setRelayUnavailableLongEnough(false)
      return
    }
    const timer = setTimeout(() => setRelayUnavailableLongEnough(true), DISCONNECTED_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isActive, relayUnavailable])

  return resolveAppConnectivityStatus(
    networkStatus,
    relayState,
    relayUnavailableLongEnough,
  )
}
