import type { DesktopAccountRuntimeState } from '../features/desktop-control/desktopAccountRuntime'
import type { AccountConnectionPhaseSnapshot } from './useAccountConnectionPhase.types'

const UNKNOWN: AccountConnectionPhaseSnapshot = { phase: 'connecting', reason: null }

export function resolveDesktopAccountConnectionPhase(
  state: Pick<DesktopAccountRuntimeState, 'status' | 'bootstrapped' | 'error'>,
): AccountConnectionPhaseSnapshot {
  const { status } = state
  if (state.error) return { phase: 'blocked', reason: state.error.message }
  if (state.bootstrapped && !status) {
    return { phase: 'blocked', reason: 'Desktop account runtime returned no status' }
  }
  if (!status) return UNKNOWN
  if (status.phase === 'ready') {
    if (status.connectivity?.phase !== 'connected') {
      return {
        phase: 'blocked',
        reason: 'Desktop account runtime reported ready without Relay connectivity',
      }
    }
    return { phase: 'connected', reason: status.connectivity?.reason ?? null }
  }
  return {
    phase: status.phase,
    reason: status.connectivity?.reason ?? null,
  }
}
