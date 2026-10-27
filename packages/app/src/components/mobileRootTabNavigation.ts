// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/mobile-root-tab-navigation.test.ts
import { TabActions, type NavigationState } from '@react-navigation/routers'
import { MOBILE_TAB_ROUTES } from './mobileFeatureRegistry'

export type MobileRootTab = keyof typeof MOBILE_TAB_ROUTES

/** Fixed siblings belong to a TabRouter. Switching never rewrites the detail stack. */
export function mobileRootTabAction(state: NavigationState | undefined, target: MobileRootTab) {
  if (!state || state.type !== 'tab') return undefined
  const name = MOBILE_TAB_ROUTES[target]
  if (!state.routeNames.includes(name) || state.routes[state.index]?.name === name) return undefined
  return { ...TabActions.jumpTo(name), target: state.key }
}
