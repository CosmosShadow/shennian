// @arch docs/features/desktop-settings-information-architecture.md
// @test ../../__tests__/desktop-system-settings-ui.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopSystemSettingsSnapshot } from '../desktop-control/types'
import { getDesktopControlBridge } from '../desktop-control/bridge'

export function useDesktopSystemSettings() {
  const settings = useMemo(() => getDesktopControlBridge()?.settings, [])
  const [snapshot, setSnapshot] = useState<DesktopSystemSettingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const request = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++request.current
    if (mounted.current) {
      setLoading(true)
      setError(null)
    }
    try {
      if (!settings) throw new Error('Desktop system settings are unavailable')
      const result = await settings.getSystem()
      if (!result.ok) throw new Error(result.error.message)
      if (mounted.current && id === request.current) setSnapshot(result.value)
    } catch (cause) {
      if (mounted.current && id === request.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && id === request.current) setLoading(false)
    }
  }, [settings])

  const openSystemSettings = useCallback(async (target: 'notifications' | 'microphone') => {
    const permission = target === 'notifications' ? snapshot?.notification : snapshot?.microphone
    if (!settings || !permission?.canOpenSettings) return false
    setError(null)
    const result = await settings.openSystem({ target })
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    return true
  }, [settings, snapshot])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      request.current += 1
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  return {
    available: Boolean(settings),
    snapshot,
    loading,
    error,
    refresh,
    openNotificationSettings: () => openSystemSettings('notifications'),
    openMicrophoneSettings: () => openSystemSettings('microphone'),
  }
}
