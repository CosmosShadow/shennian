// @arch docs/architecture/mobile-navigation.md
// @covers src/components/mobileRootTabNavigation.ts
// @covers src/components/mobileRootTabPreference.ts
// @covers src/components/mobileFeatureRegistry.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StackActions, StackRouter, TabActions, TabRouter } from '@react-navigation/routers'
import { mobileRootTabAction, type MobileRootTab } from '../components/mobileRootTabNavigation'
import { DEFAULT_MOBILE_TABS, MOBILE_TAB_ROUTES, mobileDestinationHref, mobileRootScreenOptions } from '../components/mobileFeatureRegistry'

afterEach(() => { vi.resetModules(); vi.restoreAllMocks() })
const names = Object.values(MOBILE_TAB_ROUTES)
function tabs() {
  const router = TabRouter({ initialRouteName: 'home', backBehavior: 'none' })
  const options = { routeNames: names, routeParamList: {}, routeGetIdList: {} }
  let state = router.getInitialState(options)
  return { get state() { return state }, press(target: MobileRootTab) {
    const action = mobileRootTabAction(state, target)
    if (action) state = router.getRehydratedState(router.getStateForAction(state, action, options) ?? state, options)
  }, router, options }
}
describe('fixed mobile directory navigation', () => {
  it('keeps all four branch identities for rapid switches without growing or replacing a stack', () => {
    const nav = tabs(), key = nav.state.key, keys = nav.state.routes.map(route => route.key)
    for (let round = 0; round < 100; round++) {
      for (const target of ['contacts', 'projects', 'settings', 'shennian', 'shennian'] as const) nav.press(target)
      expect(nav.state.routes.map(route => route.key)).toEqual(keys)
      expect(nav.state.key).toBe(key)
      expect(nav.state.routes[nav.state.index].name).toBe('home')
    }
    expect(nav.router.getStateForAction(nav.state, { type: 'GO_BACK' }, nav.options)).toBeNull()
  })
  it('pushes details above the entire tab directory and pops to the same active tab', () => {
    const nav = tabs(); nav.press('projects')
    const router = StackRouter({ initialRouteName: '(tabs)' })
    const options = { routeNames: ['(tabs)', 'project', 'steward'], routeParamList: {}, routeGetIdList: {} }
    const root = router.getInitialState(options)
    const withTabs = { ...root, routes: [{ ...root.routes[0], state: nav.state }] }
    const pushed = router.getRehydratedState(router.getStateForAction(withTabs, StackActions.push('project', { workDir: '/fixture' }), options)!, options)
    expect(mobileRootTabAction(pushed, 'contacts')).toBeUndefined()
    const popped = router.getStateForAction(pushed, StackActions.pop(), options)!
    expect(popped.routes).toEqual(withTabs.routes)
    expect(popped.routes[0].state).toBe(nav.state)
  })
  it('routes root navigation separately from pushed personal functions and chat', () => {
    for (const key of Object.keys(MOBILE_TAB_ROUTES) as MobileRootTab[]) {
      expect(mobileDestinationHref(key)).toEqual({ pathname: `/(main)/(tabs)/${MOBILE_TAB_ROUTES[key]}` })
    }
    expect(mobileDestinationHref('diary', 'push')).toEqual({ pathname: '/(main)/personal-workspace', params: { kind: 'diary', __mobileEntry: 'push' } })
    expect(mobileRootScreenOptions('steward')).toEqual({ animation: 'slide_from_right', gestureEnabled: true })
    expect(mobileRootScreenOptions('project', { __mobileEntry: 'tab' })).toEqual({ animation: 'slide_from_right', gestureEnabled: true })
    expect(mobileRootScreenOptions('(tabs)')).toEqual({ animation: 'none', gestureEnabled: false })
    expect(TabActions.jumpTo('home').type).toBe('JUMP_TO')
  })
  it('ignores retired last tabs while preserving valid root choices by account', async () => {
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }))
    vi.doMock('@react-native-async-storage/async-storage', () => ({ default: {
      getItem: async (key: string) => key.includes('lastMobileRootTab') ? JSON.stringify({ a: 'recording', b: 'contacts', c: 'projects' }) : JSON.stringify({ b: ['shennian'] }),
      setItem: vi.fn(async () => {}),
    } }))
    const preference = await import('../components/mobileRootTabPreference')
    await preference.hydrateMobileRootTabPreference()
    expect(preference.getPreferredMobileRootTab('a')).toBe('shennian')
    expect(preference.getPreferredMobileRootTab('b')).toBe('contacts')
    expect(preference.getPreferredMobileRootTab('c')).toBe('projects')
    expect(preference.getPreferredMobileRootTab('new')).toBe('shennian')
    expect(DEFAULT_MOBILE_TABS).toHaveLength(4)
  })
})
