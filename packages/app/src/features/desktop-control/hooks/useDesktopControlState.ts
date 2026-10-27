// @arch docs/architecture/desktop/unified-desktop.md

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDesktopControlAvailability } from '../bridge'
import type {
  DaemonStatus,
  DesktopBridge,
  DesktopConnectorSource,
  DesktopSetupEvent,
  DesktopSetupPersistence,
} from '../types'

type UseDesktopControlStateResult = {
  available: boolean
  loading: boolean
  status: DaemonStatus | null
  appVersion: string | null
  connectorSource: DesktopConnectorSource | null
  setupRunning: boolean
  setupLog: DesktopSetupEvent[]
  setupState: DesktopSetupPersistence | null
  error: string | null
  bridge: DesktopBridge | null
  refresh: () => Promise<void>
}

export function useDesktopControlState(): UseDesktopControlStateResult {
  const availability = useMemo(() => getDesktopControlAvailability(), [])
  const [status, setStatus] = useState<DaemonStatus | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [connectorSource, setConnectorSource] = useState<DesktopConnectorSource | null>(null)
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupLog, setSetupLog] = useState<DesktopSetupEvent[]>([])
  const [setupState, setSetupState] = useState<DesktopSetupPersistence | null>(null)
  const [loading, setLoading] = useState(availability.available)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!availability.bridge) return

    if (!hasLoadedRef.current) setLoading(true)
    try {
      const state = await availability.bridge.getState()
      hasLoadedRef.current = true
      setStatus(state.status)
      if (state.appVersion) setAppVersion(state.appVersion)
      setConnectorSource(state.connectorSource ?? null)
      setSetupRunning(Boolean(state.setupRunning))
      setSetupLog(state.setupLog ?? [])
      setSetupState(state.setupState ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [availability.bridge])

  useEffect(() => {
    if (!availability.bridge) {
      setLoading(false)
      return
    }

    void refresh()
    if (!availability.bridge.onStateChange) {
      setError('当前桌面版本不支持本机状态订阅')
      return
    }
    const unsubscribe = availability.bridge.onStateChange((state) => {
      hasLoadedRef.current = true
      setStatus(state.status)
      if (state.appVersion) setAppVersion(state.appVersion)
      setConnectorSource(state.connectorSource ?? null)
      setSetupRunning(Boolean(state.setupRunning))
      setSetupLog(state.setupLog ?? [])
      setSetupState(state.setupState ?? null)
      setError(null)
      setLoading(false)
    })
    const unsubscribeSetup = availability.bridge.onSetupEvent?.((event) => {
      setSetupRunning(event.type === 'completed' ? false : true)
      setSetupLog((current) => [...current, event].slice(-80))
    })
    return () => {
      unsubscribe()
      unsubscribeSetup?.()
    }
  }, [availability.bridge, refresh])

  return {
    available: availability.available,
    loading,
    status,
    appVersion,
    connectorSource,
    setupRunning,
    setupLog,
    setupState,
    error,
    bridge: availability.bridge,
    refresh,
  }
}
