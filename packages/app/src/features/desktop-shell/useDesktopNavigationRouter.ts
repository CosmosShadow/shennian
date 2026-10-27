// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-settings-leave-guard.test.ts
import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { desktopNavigationGuard } from './desktopNavigationGuard'

export function useDesktopNavigationRouter() {
  const router = useRouter()
  return useMemo(() => ({
    ...router,
    navigate: (...args: Parameters<typeof router.navigate>) => desktopNavigationGuard.request(() => router.navigate(...args)),
    replace: (...args: Parameters<typeof router.replace>) => desktopNavigationGuard.request(() => router.replace(...args)),
    back: () => desktopNavigationGuard.request(() => router.back()),
  }), [router])
}
