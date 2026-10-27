// @arch docs/architecture/app/render-resilience.md
// @test src/__tests__/render-resilience.test.ts
import { useCallback, type ReactNode } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { RecoverableSection } from './RecoverableSection'

function RecoverableScreen({ children, routeKey, routeParams }: { children: ReactNode; routeKey: string; routeParams?: object }) {
  const router = useRouter()
  const focused = useIsFocused()
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(main)')
  }, [router])
  return <RecoverableSection scope="screen" resetKey={routeKey} resetToken={routeParams} fill
    autoLeaveAfterMs={focused ? 3000 : undefined} onLeave={leave}>{children}</RecoverableSection>
}

/** Module-stable screenLayout keeps navigator/history outside the failed screen subtree. */
export function renderRecoverableScreen({ children, route }: { children: ReactNode; route: { key: string; params?: object } }) {
  return <RecoverableScreen routeKey={route.key} routeParams={route.params}>{children}</RecoverableScreen>
}
