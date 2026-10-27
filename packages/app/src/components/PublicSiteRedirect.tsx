// @arch docs/features/official-website-positioning.md
// @test src/__tests__/landing-simplification.test.ts

import { useEffect } from 'react'
import { Platform } from 'react-native'
import { Redirect } from 'expo-router'
import { PUBLIC_SITE_URL } from '../config/server'

function publicSiteDestination(): string {
  if (typeof window === 'undefined') return PUBLIC_SITE_URL
  const hash = window.location.hash === '#get-started' ? '#downloads' : window.location.hash
  return `${PUBLIC_SITE_URL}/${hash}`
}

export function PublicSiteRedirect() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    window.location.replace(publicSiteDestination())
  }, [])

  if (Platform.OS !== 'web') return <Redirect href="/" />
  return null
}
