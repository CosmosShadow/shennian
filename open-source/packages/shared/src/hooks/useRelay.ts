import { useEffect, useState, useCallback, useRef } from 'react'
import type { RelayState } from '../relay'
import type { EventFrame, ResFrame, ReqFrame } from '@shennian/wire'
import type { RelayManager } from '../relay-manager'

type RelayEventHandler = (event: EventFrame) => void

export function createUseRelay(getRelayManager: () => RelayManager | null) {
  return function useRelay(machineId: string | null, onEvent?: RelayEventHandler) {
    const [state, setState] = useState<RelayState>('disconnected')
    const onEventRef = useRef(onEvent)
    onEventRef.current = onEvent

    const stableHandler = useCallback((event: EventFrame) => {
      onEventRef.current?.(event)
    }, [])

    useEffect(() => {
      const mgr = getRelayManager()
      if (!machineId || !mgr) {
        setState('disconnected')
        return
      }
      const client = mgr.acquire(machineId, stableHandler)
      if (!client) {
        setState('disconnected')
        return
      }
      setState(client.getState())
      const unsub = mgr.onStateChange(machineId, setState)
      return () => {
        unsub()
        mgr.release(machineId, stableHandler)
      }
    }, [machineId, stableHandler])

    const send = useCallback(
      (frame: Omit<ReqFrame, 'id'>): Promise<ResFrame> => {
        const mgr = getRelayManager()
        if (!machineId || !mgr) return Promise.reject(new Error('Not connected'))
        return mgr.sendWhenReady(machineId, frame)
      },
      [machineId],
    )

    return { state, send }
  }
}
