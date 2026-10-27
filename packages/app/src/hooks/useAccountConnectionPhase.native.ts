import { useRelayConnectivitySnapshot } from './useAppConnectivityStatus'
import type { AccountConnectionPhaseSnapshot } from './useAccountConnectionPhase.types'

export function useAccountConnectionPhase(): AccountConnectionPhaseSnapshot {
  const connectivity = useRelayConnectivitySnapshot()
  if (!connectivity) return { phase: 'connecting', reason: null }
  return {
    phase: connectivity.phase === 'recovering' ? 'connecting' : connectivity.phase,
    reason: connectivity.reason,
  }
}
