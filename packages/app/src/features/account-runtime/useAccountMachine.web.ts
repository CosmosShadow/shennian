// @arch docs/features/desktop-local-first-client.md#33-进程职责

import { useCallback, useEffect, useState } from 'react'
import type { ReqFrame, ResFrame } from '@shennian/wire'
import type { RelayState } from '@shennian/shared'
import { accountRuntime } from './accountRuntime'
import {
  DESKTOP_ACCOUNT_MACHINE_REQUEST_METHODS,
  type DesktopAccountMachineRequestMethod as AccountMachineRequestMethod,
} from './accountRuntime.types'

const allowedMethods = new Set<string>(DESKTOP_ACCOUNT_MACHINE_REQUEST_METHODS)

/** Desktop renderer consumes main-process connectivity and fixed machine commands only. */
export function useAccountMachine(machineId: string | null) {
  const [state, setState] = useState<RelayState>(() => relayState())

  useEffect(() => accountRuntime.subscribeConnectivity(() => setState(relayState())), [])

  const send = useCallback(
    (frame: Omit<ReqFrame, 'id'>): Promise<ResFrame> => {
      if (!machineId) return Promise.reject(new Error('Machine is unavailable'))
      if (!allowedMethods.has(frame.method)) {
        return Promise.reject(new Error('Machine command is not supported by Desktop'))
      }
      return accountRuntime.requestMachine(
        machineId,
        frame.method as AccountMachineRequestMethod,
        frame.params,
      )
    },
    [machineId],
  )

  return { state, send }
}

function relayState(): RelayState {
  const phase = accountRuntime.getConnectivitySnapshot()?.phase
  if (phase === 'connected') return 'connected'
  if (phase === 'connecting' || phase === 'recovering') return 'connecting'
  return 'disconnected'
}
