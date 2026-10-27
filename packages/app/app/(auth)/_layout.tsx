import { renderRecoverableScreen } from '../../src/components/RecoverableScreen'
import { Redirect, Stack, useLocalSearchParams } from 'expo-router'
import { useAuthStore } from '../../src/config/auth'
import { sanitizeAuthRedirect } from '../../src/features/auth/utils/redirect'
import { useTheme } from '../../src/hooks/useTheme'
import { getNativeStatusBarOptions } from '../../src/theme/nativeStatusBar'

export default function AuthLayout({
  defaultRedirect,
}: {
  defaultRedirect?: string
} = {}) {
  const params = useLocalSearchParams<{ redirect?: string | string[] }>()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const { colors, isDark } = useTheme()

  if (isAuthenticated) {
    return <Redirect href={sanitizeAuthRedirect(params.redirect, defaultRedirect) as never} />
  }

  return (
    <Stack
          screenLayout={renderRecoverableScreen}
      screenOptions={{
        ...getNativeStatusBarOptions(isDark),
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  )
}
