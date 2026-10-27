// @arch docs/features/agent-workspaces.md
// @test src/__tests__/mobile-root-tab-navigation.test.ts

import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { DEFAULT_MOBILE_TABS, mobileDestinationHref } from './mobileFeatureRegistry'
import type { MobileRootTab } from './mobileRootTabNavigation'

const STORAGE_KEY = 'shennian:lastMobileRootTabByAccount:v2'
const DEFAULT_TAB: MobileRootTab = 'shennian'
const validTabs = new Set<string>(DEFAULT_MOBILE_TABS)

type Preferences = Record<string, MobileRootTab>

let preferences: Preferences = {}
let hydrated = Platform.OS === 'web'

function parsePreferences(raw: string | null): Preferences {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, MobileRootTab] =>
          typeof entry[0] === 'string' && validTabs.has(entry[1] as MobileRootTab),
      ),
    )
  } catch {
    return {}
  }
}

export async function hydrateMobileRootTabPreference(): Promise<void> {
  if (hydrated || Platform.OS === 'web') return
  preferences = parsePreferences(await AsyncStorage.getItem(STORAGE_KEY).catch(() => null))
  hydrated = true
}

export function getPreferredMobileRootTab(accountId: string | null | undefined): MobileRootTab {
  if (!accountId) return DEFAULT_TAB
  const saved = preferences[accountId]
  return saved && validTabs.has(saved) ? saved : DEFAULT_TAB
}

export function rememberMobileRootTab(
  accountId: string | null | undefined,
  tab: MobileRootTab,
): void {
  if (!accountId) return
  preferences = { ...preferences, [accountId]: tab }
  hydrated = true
  if (Platform.OS !== 'web') {
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)).catch(() => {})
  }
}

export function mobileRootTabHref(tab: MobileRootTab) {
  return mobileDestinationHref(tab)
}
