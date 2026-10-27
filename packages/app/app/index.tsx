import { Platform } from 'react-native'
import { Redirect } from 'expo-router'
import { useAuthStore } from '../src/config/auth'
import { isCanonicalWebAppHost } from '../src/config/server'
import { PublicSiteRedirect } from '../src/components/PublicSiteRedirect'
import {
  getPreferredMobileRootTab,
  mobileRootTabHref,
} from '../src/components/mobileRootTabPreference'

export default function IndexRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const accountId = useAuthStore((s) => s.user?.id ?? null)
  if (isAuthenticated) {
    const href = Platform.OS === 'web'
      ? '/(main)' as const
      : mobileRootTabHref(getPreferredMobileRootTab(accountId))
    return <Redirect href={href} />
  }
  if (isCanonicalWebAppHost()) return <Redirect href="/(auth)/login" />
  if (Platform.OS === 'web') return <PublicSiteRedirect />
  return <Redirect href="/(auth)/login" />
}
