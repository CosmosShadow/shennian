import { useEffect, useState } from 'react'

const GOOGLE_PROBE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TIMEOUT_MS = 3000

/**
 * Probe whether Google OAuth is reachable from the client.
 * Returns `null` while probing, then `true` or `false`.
 */
export function useGoogleReachable(enabled: boolean): boolean | null {
  const [reachable, setReachable] = useState<boolean | null>(enabled ? null : false)

  useEffect(() => {
    if (!enabled) {
      setReachable(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    fetch(GOOGLE_PROBE_URL, { method: 'HEAD', mode: 'no-cors', signal: controller.signal })
      .then(() => { if (!cancelled) setReachable(true) })
      .catch(() => { if (!cancelled) setReachable(false) })
      .finally(() => clearTimeout(timer))

    return () => { cancelled = true; controller.abort() }
  }, [enabled])

  return reachable
}
