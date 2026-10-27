// @arch docs/features/desktop-local-first-client.md#81-信息架构
// @test ../../../__tests__/desktop-notification-integration.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDesktopControlBridge } from '../bridge'

export function useDesktopNotificationPreference() {
  const notifications = useMemo(() => getDesktopControlBridge()?.notifications, [])
  const [enabled, setEnabledState] = useState<boolean | null>(null)
  const [showBody, setShowBodyState] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lifecycle = useRef(0)
  const pending = useRef<number | null>(null)
  const mounted = useRef(false)
  const perform = useCallback(
    async (next?: { enabled: boolean; showBody: boolean }) => {
      const generation = lifecycle.current
      if (!mounted.current || pending.current === generation) return false
      pending.current = generation
      setLoading(true)
      setError(null)
      try {
        if (!notifications) throw new Error('Desktop notifications are unavailable')
        const result = next === undefined
          ? await notifications.getPreference()
          : await notifications.setPreference(next)
        if (!result.ok) throw new Error(result.error.message)
        if (!mounted.current || generation !== lifecycle.current) return false
        setEnabledState(result.value.enabled)
        setShowBodyState(result.value.showBody)
        return true
      } catch (cause) {
        if (mounted.current && generation === lifecycle.current)
          setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        if (pending.current === generation) pending.current = null
        if (mounted.current && generation === lifecycle.current) setLoading(false)
      }
    },
    [notifications],
  )

  const retry = useCallback(async () => { await perform() }, [perform])
  useEffect(() => {
    lifecycle.current += 1
    mounted.current = true
    void retry()
    return () => { mounted.current = false; lifecycle.current += 1 }
  }, [retry])

  return {
    available: Boolean(notifications),
    enabled,
    showBody,
    loading,
    error,
    retry,
    setEnabled: (next: boolean) => enabled === null || showBody === null
      ? Promise.resolve(false)
      : perform({ enabled: next, showBody }),
    setShowBody: (next: boolean) => enabled === null || showBody === null
      ? Promise.resolve(false)
      : perform({ enabled, showBody: next }),
  }
}
