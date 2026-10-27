// @arch docs/architecture/desktop/unified-desktop.md

import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'
import { useAuthStore } from '../src/config/auth'

export default function DesktopEntryRoute() {
  const [mounted, setMounted] = useState(false)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return <Redirect href={isAuthenticated ? '/(main)' : '/(auth)/login?desktop=1'} />
}
