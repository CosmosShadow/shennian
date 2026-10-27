// @arch docs/features/desktop-appearance-language-preferences.md
// @arch docs/design/patterns.md#1-一级根页面
// @test src/__tests__/mobile-root-tab-appearance.test.ts

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useColorScheme, Platform } from 'react-native'

export type ThemeMode = 'light' | 'dark' | 'system'
type SystemColorScheme = 'light' | 'dark' | null | undefined

const THEME_KEY = 'shennian:theme'

// ── Shared global theme store ────────────────────────────────────────────────
let _currentMode: ThemeMode = 'system'
const _listeners = new Set<() => void>()

function notify() {
  for (const fn of _listeners) fn()
}

function subscribe(listener: () => void) {
  _listeners.add(listener)
  return () => {
    _listeners.delete(listener)
  }
}

function getSnapshot(): ThemeMode {
  return _currentMode
}

function setGlobalMode(mode: ThemeMode) {
  if (_currentMode === mode) return
  _currentMode = mode
  notify()
}

// ── Persistence ──────────────────────────────────────────────────────────────

function initFromStorage() {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(THEME_KEY) as ThemeMode | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      _currentMode = stored
    }
  }
}

initFromStorage()

function persistTheme(mode: ThemeMode) {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_KEY, mode)
    return
  }
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default
    AsyncStorage.setItem(THEME_KEY, mode).catch(() => {})
  } catch {}
}

async function loadStoredThemeNative(): Promise<ThemeMode | null> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default
    const val = await AsyncStorage.getItem(THEME_KEY)
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val
    }
  } catch {}
  return null
}

// ── Color palettes ───────────────────────────────────────────────────────────

export const lightColors = {
  bg: '#ffffff',
  groupedBackground: '#F2F2F7',
  groupedSurface: '#FFFFFF',
  groupedSeparator: '#D8D8DE',
  avatarGroupBg: '#E2E4E5',
  surface: '#fafafa',
  surfaceHover: '#f5f5f5',
  sidebarBackground: '#fafafa',
  selectionBackground: '#dce0e5',
  selectionBackgroundInactive: '#e3e5e9',
  border: '#f0f0f0',
  separator: '#D8D8DE',
  text: '#111111',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textMuted: '#707070',
  textMutedOnSurface: '#626262',
  brand: '#4f46e5',
  brandMuted: '#574ee5',
  brandDark: '#4338ca',
  brandLight: '#eef2ff',
  navigationSelected: '#0070c9',
  ownMessage: 'rgba(59,130,246,0.08)',
  notificationSurface: '#F3F3FF',
  notificationPressed: '#E8E9FC',
  error: '#ef4444',
  errorText: '#b91c1c',
  success: '#22c55e',
  successText: '#15803d',
  warning: '#f59e0b',
  warningText: '#92400e',
}

export const darkColors = {
  bg: '#0a0a0a',
  groupedBackground: '#000000',
  groupedSurface: '#1C1C1E',
  groupedSeparator: '#3A3A3C',
  avatarGroupBg: '#303234',
  surface: '#171717',
  surfaceHover: '#262626',
  sidebarBackground: '#17191c',
  selectionBackground: '#3a3f47',
  selectionBackgroundInactive: '#30353c',
  border: '#262626',
  separator: '#3A3A3C',
  text: '#fafafa',
  textSecondary: '#a3a3a3',
  textTertiary: '#737373',
  textMuted: '#969696',
  textMutedOnSurface: '#969696',
  brand: '#818cf8',
  brandMuted: '#9ca5fa',
  brandDark: '#6366f1',
  brandLight: '#1e1b4b',
  navigationSelected: '#62B9F0',
  ownMessage: 'rgba(96,165,250,0.12)',
  notificationSurface: '#252336',
  notificationPressed: '#302D48',
  error: '#f87171',
  errorText: '#f87171',
  success: '#4ade80',
  successText: '#4ade80',
  warning: '#fbbf24',
  warningText: '#fbbf24',
}

// Keep newly introduced semantic tokens optional at the shared boundary so
// existing focused test palettes and gradual theme consumers remain compatible.
type GradualColorToken =
  | 'notificationSurface'
  | 'notificationPressed'
  | 'separator'
  | 'groupedBackground'
  | 'groupedSurface'
  | 'groupedSeparator'
  | 'brandMuted'
  | 'sidebarBackground'
  | 'selectionBackground'
  | 'selectionBackgroundInactive'
export type Colors = Omit<typeof lightColors, GradualColorToken> &
  Partial<Pick<typeof lightColors, GradualColorToken>>

// ── Hook ─────────────────────────────────────────────────────────────────────

function getWebSystemScheme(): SystemColorScheme {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return undefined
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useSystemColorScheme(): SystemColorScheme {
  const nativeScheme = useColorScheme()
  const [webScheme, setWebScheme] = useState<SystemColorScheme>(() => getWebSystemScheme())

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setWebScheme(media.matches ? 'dark' : 'light')
    sync()

    if (media.addEventListener) {
      media.addEventListener('change', sync)
      return () => media.removeEventListener('change', sync)
    }

    media.addListener(sync)
    return () => media.removeListener(sync)
  }, [])

  if (Platform.OS === 'web') return webScheme
  return nativeScheme === 'light' || nativeScheme === 'dark' ? nativeScheme : undefined
}

export function useTheme() {
  const systemScheme = useSystemColorScheme()
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // On native, load persisted theme from AsyncStorage once on first mount
  useEffect(() => {
    if (Platform.OS !== 'web') {
      loadStoredThemeNative().then((stored) => {
        if (stored) setGlobalMode(stored)
      })
    }
  }, [])

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark'

  const setTheme = useCallback(
    (m: ThemeMode) => {
      setGlobalMode(m)
      persistTheme(m)
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.documentElement.classList.toggle(
          'dark',
          m === 'dark' || (m === 'system' && systemScheme === 'dark'),
        )
      }
    },
    [systemScheme],
  )

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', isDark)
    }
  }, [isDark])

  return { mode, isDark, setTheme, colors: isDark ? darkColors : lightColors }
}
