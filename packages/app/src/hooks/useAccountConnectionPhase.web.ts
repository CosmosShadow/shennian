import { useSyncExternalStore } from 'react'
import {
  getDesktopAccountRuntimeState,
  subscribeDesktopAccountRuntimeState,
} from '../features/desktop-control/useDesktopAccountSync'
import type { AccountConnectionPhaseSnapshot } from './useAccountConnectionPhase.types'
import { resolveDesktopAccountConnectionPhase } from './accountConnectionPhase.web'

export function useAccountConnectionPhase(): AccountConnectionPhaseSnapshot {
  const state = useSyncExternalStore(
    subscribeDesktopAccountRuntimeState,
    getDesktopAccountRuntimeState,
    getDesktopAccountRuntimeState,
  )
  return resolveDesktopAccountConnectionPhase(state)
}
