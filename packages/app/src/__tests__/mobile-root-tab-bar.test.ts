// @vitest-environment happy-dom
// @arch docs/architecture/mobile-navigation.md
// @covers src/components/MobileRootTabBar.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { BaseNavigationContainer, createNavigatorFactory, useNavigationBuilder } from '@react-navigation/core'
import { TabRouter } from '@react-navigation/routers'
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  View: ({ children }: any) => React.createElement('div', null, children),
  Text: ({ children }: any) => React.createElement('span', null, children),
  Pressable: ({ children, onPress, testID, accessibilityState }: any) => React.createElement('button', { onClick: onPress, 'data-testid': testID, 'aria-selected': accessibilityState?.selected }, children),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }))
vi.mock('../components/DirectoryBookIcon', () => ({ DirectoryBookIcon: () => React.createElement('i', { 'data-testid': 'contacts-book-icon' }) }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../features/mobile-navigation/useMobileUpgradeBadges', () => ({ useMobileUpgradeBadges: () => ({ any: true }) }))
vi.mock('../features/unread/useUnreadNavigation', () => ({ useUnreadNavigation: () => ({ tabs: { projects: 3, rooms: 2, agents: 1 } }) }))
vi.mock('../features/unread/UnreadCountBadge', () => ({ UnreadCountBadge: ({ count, testID }: any) => React.createElement('span', { 'data-testid': testID }, count) }))
vi.mock('../features/rooms/components/RoomApprovalDot', () => ({ RoomApprovalDot: () => null }))
vi.mock('../components/mobileRootTabPreference', () => ({ rememberMobileRootTab: vi.fn() }))
vi.mock('../config/auth', () => ({ useAuthStore: Object.assign((select: any) => select({ user: { id: 'unit-owner' } }), { getState: () => ({ user: { id: 'unit-owner' } }) }) }))
import { MobileRootTabBar } from '../components/MobileRootTabBar'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounts = new Map<string, number>()
let navigation: any
let projectNavigation: any
function Page({ route }: any) {
  const [draft, setDraft] = React.useState('')
  React.useEffect(() => { mounts.set(route.name, (mounts.get(route.name) ?? 0) + 1) }, [route.name])
  return React.createElement('input', { 'data-page': route.name, value: draft, onInput: (e: any) => setDraft(e.target.value) })
}
function Navigator(props: any) {
  const { state, descriptors, NavigationContent, navigation: nav } = useNavigationBuilder(TabRouter, props)
  navigation = nav
  projectNavigation = descriptors[state.routes.find(route => route.name === 'projects')!.key].navigation
  return React.createElement(NavigationContent, null,
    ...state.routes.map(route => React.createElement('div', { key: route.key, hidden: state.routes[state.index].key !== route.key }, descriptors[route.key].render())),
    React.createElement(MobileRootTabBar, { state, navigation: nav, descriptors, insets: { top: 0, bottom: 0, left: 0, right: 0 } } as any))
}
const Tabs = createNavigatorFactory(Navigator)()
const host = document.createElement('div')
let root: ReturnType<typeof createRoot>
afterEach(async () => { await act(async () => root?.unmount()); mounts.clear(); host.replaceChildren() })
async function render() {
  root = createRoot(host)
  await act(async () => root.render(React.createElement(BaseNavigationContainer, null,
    React.createElement(Tabs.Navigator, { initialRouteName: 'home' }, ['home', 'people', 'projects', 'settings'].map(name => React.createElement(Tabs.Screen, { key: name, name, component: Page }))))))
}
const button = (key: string) => host.querySelector<HTMLButtonElement>(`[data-testid="mobile-root-tab-${key}"]`)!
it('retains page state through batched rapid clicks and always renders four stable tabs', async () => {
  await render()
  expect(host.querySelectorAll('button')).toHaveLength(4)
  expect(button('contacts').querySelector('[data-testid="contacts-book-icon"]')).not.toBeNull()
  const input = host.querySelector<HTMLInputElement>('[data-page="home"]')!
  await act(async () => { input.value = 'unfinished'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  const stateKey = navigation.getState().key
  for (let round = 0; round < 30; round++) {
    await act(async () => { for (const key of ['contacts', 'projects', 'settings', 'shennian']) button(key).click() })
    expect(button('shennian').getAttribute('aria-selected')).toBe('true')
    expect(navigation.getState().key).toBe(stateKey)
    expect(host.querySelector<HTMLInputElement>('[data-page="home"]')!.value).toBe('unfinished')
  }
  expect([...mounts.values()]).toEqual([1, 1, 1, 1])
  expect(host.querySelector('[data-testid="mobile-root-tab-shennian-unread"]')?.textContent).toBe('3')
  expect(host.querySelector('[data-testid="mobile-root-tab-projects-unread"]')?.textContent).toBe('3')
  expect(host.querySelector('[data-testid="mobile-root-tab-contacts-unread"]')?.textContent).toBe('0')
})
it('honors tabPress prevention', async () => {
  await render()
  const remove = projectNavigation.addListener('tabPress', (event: any) => event.preventDefault())
  await act(async () => button('projects').click())
  expect(button('shennian').getAttribute('aria-selected')).toBe('true')
  remove()
  await act(async () => button('projects').click())
  expect(button('projects').getAttribute('aria-selected')).toBe('true')
})
