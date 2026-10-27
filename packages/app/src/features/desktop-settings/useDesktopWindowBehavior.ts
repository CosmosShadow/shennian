// @arch docs/features/desktop-settings-information-architecture.md
// @test ../../__tests__/desktop-general-settings.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDesktopControlBridge } from '../desktop-control/bridge'
import type { DesktopWindowCloseBehavior } from '../desktop-control/types'

export function useDesktopWindowBehavior() {
  const settings = useMemo(() => getDesktopControlBridge()?.settings, [])
  const mounted = useRef(false)
  const request = useRef(0)
  const savingRef = useRef(false)
  const [closeBehavior, setCloseBehavior] = useState<DesktopWindowCloseBehavior | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const id = ++request.current
    if (mounted.current) {
      setLoading(true)
      setError(null)
    }
    try {
      if (!settings) throw new Error('Desktop window settings are unavailable')
      const result = await settings.getWindowBehavior()
      if (!result.ok) throw new Error(result.error.message)
      if (mounted.current && id === request.current) setCloseBehavior(result.value.closeBehavior)
    } catch (cause) {
      if (mounted.current && id === request.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (mounted.current && id === request.current) setLoading(false)
    }
  }, [settings])

  const select = useCallback(async (next: DesktopWindowCloseBehavior) => {
    if (!settings || savingRef.current || next === closeBehavior) return
    const id = ++request.current
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await settings.setWindowBehavior({ closeBehavior: next })
      if (!result.ok) throw new Error(result.error.message)
      if (mounted.current && id === request.current) setCloseBehavior(result.value.closeBehavior)
    } catch (cause) {
      if (mounted.current && id === request.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      savingRef.current = false
      if (mounted.current && id === request.current) setSaving(false)
    }
  }, [closeBehavior, settings])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      request.current += 1
      savingRef.current = false
    }
  }, [refresh])

  return { closeBehavior, loading, saving, error, refresh, select }
}
