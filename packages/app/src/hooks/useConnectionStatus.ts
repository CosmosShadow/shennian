import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '@shennian/shared'
import { useNetworkStatus } from './useNetworkStatus'
import { useAccountConnectionPhase } from './useAccountConnectionPhase'

/**
 * Global connection status for the header indicator.
 *
 * - 'connecting': the active relay client is trying to connect
 * - 'syncing':    relay connected, server sync in progress (boot or reconnect)
 * - 'ready':      everything is ready
 * - 'offline':    the account runtime is explicitly offline or the network is unavailable
 */
export type ConnectionStatus = 'connecting' | 'syncing' | 'ready' | 'offline' | 'blocked'

/** Avoid showing the sync label for short background refreshes such as tab focus. */
const SHOW_SYNCING_DELAY_MS = 900
/** Once visible, hold briefly so the label does not flicker. */
const MIN_SYNCING_MS = 300

export function useConnectionStatus(): ConnectionStatus {
  const serverSyncing = useSessionsStore((s) => s.serverSyncing)
  const networkStatus = useNetworkStatus()
  const accountConnection = useAccountConnectionPhase()

  const [displaySyncing, setDisplaySyncing] = useState(false)
  const syncingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncingVisibleAtRef = useRef(0)

  useEffect(() => {
    const clearTimer = () => {
      if (syncingTimerRef.current) {
        clearTimeout(syncingTimerRef.current)
        syncingTimerRef.current = null
      }
    }

    if (serverSyncing) {
      if (displaySyncing || syncingTimerRef.current) return clearTimer
      syncingTimerRef.current = setTimeout(() => {
        syncingVisibleAtRef.current = Date.now()
        setDisplaySyncing(true)
        syncingTimerRef.current = null
      }, SHOW_SYNCING_DELAY_MS)
      return clearTimer
    }

    clearTimer()

    if (!displaySyncing) {
      return clearTimer
    }

    const visibleFor = Date.now() - syncingVisibleAtRef.current
    const remaining = Math.max(0, MIN_SYNCING_MS - visibleFor)
    if (remaining === 0) {
      setDisplaySyncing(false)
    } else {
      syncingTimerRef.current = setTimeout(() => {
        setDisplaySyncing(false)
        syncingTimerRef.current = null
      }, remaining)
    }
    return clearTimer
  }, [displaySyncing, serverSyncing])

  if (networkStatus === 'offline') return 'offline'
  if (accountConnection.phase === 'blocked') return 'blocked'
  if (accountConnection.phase === 'offline' || accountConnection.phase === 'signed-out') {
    return 'offline'
  }
  if (accountConnection.phase === 'connecting') return 'connecting'
  if (accountConnection.phase === 'syncing' || displaySyncing) return 'syncing'
  return 'ready'
}
