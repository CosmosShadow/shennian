// @arch open-source/docs/wire.md
// @test open-source/packages/shared/src/__tests__/relay.test.ts

export type RelayConnectivityPhase =
  | 'connecting'
  | 'connected'
  | 'recovering'
  | 'blocked'
  | 'offline'

export type RelayConnectivityReason =
  | 'initial_connect'
  | 'network_offline'
  | 'transient_transport'
  | 'server_unavailable'
  | 'auth_required'
  | 'version_unsupported'
  | 'permission_revoked'
  | 'plan_required'
  | 'machine_unavailable'
  | 'unknown'

export type RelayConnectivitySnapshot = {
  phase: RelayConnectivityPhase
  reason: RelayConnectivityReason
  closeCode: number | null
  closeReason: string | null
  retryable: boolean
  retryAttempt: number
  nextRetryAt: number | null
  disconnectedAt: number | null
  lastConnectedAt: number | null
  connectionId: string | null
}

export type RelayConnectivityEventName =
  | 'relay_connect_started'
  | 'relay_connected'
  | 'relay_disconnected'
  | 'relay_retry_scheduled'
  | 'relay_watchdog_rebuild'
  | 'relay_manual_retry'
  | 'relay_recovery_succeeded'
  | 'relay_recovery_failed'

export type RelayConnectivityEvent = {
  name: RelayConnectivityEventName
  snapshot: RelayConnectivitySnapshot
  at: number
  durationMs?: number
}

export type RelayCloseClassification = {
  reason: RelayConnectivityReason
  retryable: boolean
}

/**
 * The server owns close-code meaning. Keeping this map in Wire prevents App,
 * Shared and Server from drifting into different user-facing explanations.
 */
export function classifyRelayClose(code: number, closeReason = ''): RelayCloseClassification {
  if (code === 4001 || code === 4009) return { reason: 'auth_required', retryable: false }
  if (code === 4003 || code === 4403 || code === 4411) {
    return { reason: 'permission_revoked', retryable: false }
  }
  if (code === 4402) return { reason: 'plan_required', retryable: false }
  if (code === 4406) return { reason: 'version_unsupported', retryable: false }
  if (code === 4004) return { reason: 'machine_unavailable', retryable: true }
  if (code === 4008 || code === 1012 || code === 1013) {
    return { reason: 'server_unavailable', retryable: true }
  }
  if (code === 0 || code === 1006 || code === 1011) {
    return { reason: 'transient_transport', retryable: true }
  }
  if (/upgrade|required|protocol|epoch|capabilit/i.test(closeReason)) {
    return { reason: 'version_unsupported', retryable: false }
  }
  return { reason: 'unknown', retryable: true }
}
