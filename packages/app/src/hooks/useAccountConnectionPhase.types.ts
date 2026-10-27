import type { RelayConnectivityReason } from '@shennian/wire'

export type AccountConnectionPhase =
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'blocked'
  | 'offline'
  | 'signed-out'

export type AccountConnectionPhaseSnapshot = {
  phase: AccountConnectionPhase
  reason: RelayConnectivityReason | string | null
}
