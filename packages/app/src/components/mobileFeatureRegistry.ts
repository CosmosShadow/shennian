// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/mobile-root-tab-navigation.test.ts

import type { Href } from 'expo-router'

export const mobileFeatures = [
  { key: 'scheduledTasks', label: 'schedules_title', icon: 'time-outline', selectedIcon: 'time', path: '/scheduled-tasks' },
  {
    key: 'schedules',
    label: 'mobile_schedules',
    icon: 'calendar-outline',
    selectedIcon: 'calendar',
    path: '/personal-modules',
    params: { tab: 'reminders' },
  },
  {
    key: 'projects',
    label: 'workspace_agents',
    icon: 'folder-outline',
    selectedIcon: 'folder',
    path: '/',
  },
  {
    key: 'rooms',
    label: 'mobile_conversations',
    icon: 'chatbubble-ellipses-outline',
    selectedIcon: 'chatbubble-ellipses',
    path: '/spaces',
  },
  {
    key: 'folders',
    label: 'mobile_folders',
    icon: 'folder-open-outline',
    selectedIcon: 'folder-open',
    path: '/folders',
  },
  {
    key: 'computers',
    label: 'mobile_my_computers',
    icon: 'desktop-outline',
    selectedIcon: 'desktop',
    path: '/machines',
  },
  {
    key: 'plaza',
    label: 'mobile_ai_plaza',
    icon: 'compass-outline',
    selectedIcon: 'compass',
    path: '/plaza',
  },
  {
    key: 'agents',
    label: 'mobile_my_agents',
    icon: 'sparkles-outline',
    selectedIcon: 'sparkles',
    path: '/agents',
  },
  {
    key: 'contacts',
    label: 'mobile_saved_contacts',
    icon: 'person-outline',
    selectedIcon: 'person',
    path: '/contacts',
  },
  {
    key: 'content',
    label: 'content_entry',
    icon: 'code-slash-outline',
    selectedIcon: 'code-slash',
    path: '/content',
  },
  {
    key: 'diary',
    label: 'personal_diary',
    icon: 'book-outline',
    selectedIcon: 'book',
    path: '/personal-workspace',
    params: { kind: 'diary' },
  },
  {
    key: 'memory',
    label: 'personal_memory',
    icon: 'folder-open-outline',
    selectedIcon: 'folder-open',
    path: '/personal-workspace',
    params: { kind: 'memory' },
  },
  {
    key: 'english',
    label: 'personal_entry_english',
    icon: 'language-outline',
    selectedIcon: 'language',
    path: '/personal-modules',
    params: { tab: 'english' },
  },
  {
    key: 'recording',
    label: 'personal_entry_recording',
    icon: 'mic-outline',
    selectedIcon: 'mic',
    path: '/personal-modules',
    params: { tab: 'recording' },
  },
] as const

export const mobileDestinations = [
  {
    key: 'shennian',
    label: 'mobile_tab_shennian',
    icon: 'chatbubble-outline',
    selectedIcon: 'chatbubble',
    path: '/home',
  },
  ...mobileFeatures,
  {
    key: 'features',
    label: 'mobile_features',
    icon: 'grid-outline',
    selectedIcon: 'grid',
    path: '/features',
  },
  {
    key: 'settings',
    label: 'settings',
    icon: 'settings-outline',
    selectedIcon: 'settings',
    path: '/profile',
  },
] as const

export type MobileDestination = (typeof mobileDestinations)[number]
export type MobileTabKey = MobileDestination['key']
export const DEFAULT_MOBILE_TABS: readonly MobileTabKey[] = [
  'shennian', 'contacts', 'projects', 'settings',
]
export const MOBILE_TAB_ROUTES = {
  shennian: 'home', contacts: 'people', projects: 'projects', settings: 'settings',
} as const

export function mobileDestinationHref(key: MobileTabKey, entry: 'tab' | 'push' = 'tab') {
  if (entry === 'tab' && key in MOBILE_TAB_ROUTES) {
    const route = MOBILE_TAB_ROUTES[key as keyof typeof MOBILE_TAB_ROUTES]
    return { pathname: `/(main)/(tabs)/${route}` } as Href
  }
  const destination = mobileDestinations.find((item) => item.key === key)!
  const pathname = destination.path === '/' ? '/(main)' : `/(main)${destination.path}`
  return {
    pathname,
    params: { ...('params' in destination ? destination.params : {}), __mobileEntry: entry },
  } as Href
}

export function isMobileTabEntry(name: string, _params?: { __mobileEntry?: unknown }): boolean {
  return name === '(tabs)'
}

export function mobileRootScreenOptions(name: string, params?: { __mobileEntry?: unknown }) {
  const tab = isMobileTabEntry(name, params)
  return {
    animation: tab ? ('none' as const) : ('slide_from_right' as const),
    gestureEnabled: !tab,
  }
}
