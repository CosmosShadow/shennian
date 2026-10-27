// @arch docs/design/components.md#9-状态组件
// @test src/__tests__/app-connectivity-status.test.ts

import type { NetworkStatus } from './networkStatusState'
import type { RelayConnectivitySnapshot } from '@shennian/wire'

export type AppConnectivityStatus = 'connected' | 'disconnected'
export type AccountRelayState = 'connecting' | 'connected' | 'disconnected' | 'unknown'
export const DISCONNECTED_DELAY_MS = 10_000
export const CONNECTING_FEEDBACK_DELAY_MS = 5_000

export type RelayConnectivityFeedbackStatus =
  | 'hidden'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'network_offline'
  | 'auth_required'
  | 'version_unsupported'
  | 'permission_revoked'
  | 'plan_required'
  | 'machine_unavailable'

export function resolveRelayConnectivityFeedback(
  snapshot: RelayConnectivitySnapshot | null,
  now: number,
  unavailableObservedAt: number,
): RelayConnectivityFeedbackStatus {
  if (!snapshot || snapshot.phase === 'connected') return 'hidden'
  if (snapshot.phase === 'offline' || snapshot.reason === 'network_offline') return 'network_offline'
  if (snapshot.reason === 'machine_unavailable') return 'machine_unavailable'
  if (snapshot.phase === 'blocked') {
    if (snapshot.reason === 'auth_required') return 'auth_required'
    if (snapshot.reason === 'version_unsupported') return 'version_unsupported'
    if (snapshot.reason === 'permission_revoked') return 'permission_revoked'
    if (snapshot.reason === 'plan_required') return 'plan_required'
    return 'disconnected'
  }
  // UI waiting time starts on entry/foreground, not while the app was asleep.
  const elapsed = now - unavailableObservedAt
  if (elapsed < CONNECTING_FEEDBACK_DELAY_MS) return 'hidden'
  if (elapsed >= DISCONNECTED_DELAY_MS) return 'disconnected'
  return snapshot.phase === 'connecting' ? 'connecting' : 'reconnecting'
}

export function resolveAppConnectivityStatus(
  networkStatus: NetworkStatus,
  relayState: AccountRelayState,
  relayUnavailableLongEnough: boolean,
): AppConnectivityStatus {
  if (networkStatus === 'offline') return 'disconnected'
  if (relayState !== 'connected' && relayUnavailableLongEnough) return 'disconnected'
  return 'connected'
}
