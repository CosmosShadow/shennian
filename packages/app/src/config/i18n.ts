// @arch docs/features/desktop-appearance-language-preferences.md
// @test src/__tests__/desktop-language-preference.test.ts

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
// Bundle translations from source so a native dev/OTA bundle cannot silently
// use an older, locally built @shennian/shared/dist dictionary.
import en from '../../../../open-source/packages/shared/src/i18n/en'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
import { Platform } from 'react-native'
import { isDesktopControlSurfaceEnabled } from '../utils/controlSurfaceLayout'
import { getDesktopControlBridge } from '../features/desktop-control/bridge'

const WEB_LANGUAGE_COOKIE = 'shennian_language_v2'
const DESKTOP_LANGUAGE_STORAGE_KEY = 'shennian:language'

export type SupportedLanguage = 'zh' | 'en'

export function readWebLanguagePreference(): SupportedLanguage | null {
  if (
    Platform.OS === 'web' &&
    isDesktopControlSurfaceEnabled() &&
    typeof localStorage !== 'undefined'
  ) {
    try {
      const stored = localStorage.getItem(DESKTOP_LANGUAGE_STORAGE_KEY)
      if (stored === 'zh' || stored === 'en') return stored
    } catch {
      return null
    }
    return null
  }
  if (typeof document === 'undefined') return null
  try {
    const prefix = `${WEB_LANGUAGE_COOKIE}=`
    const value = document.cookie
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(prefix))
      ?.slice(prefix.length)
    return value === 'zh' || value === 'en' ? value : null
  } catch {
    return null
  }
}

export function persistWebLanguagePreference(language: SupportedLanguage): void {
  if (
    Platform.OS === 'web' &&
    isDesktopControlSurfaceEnabled() &&
    typeof localStorage !== 'undefined'
  ) {
    try {
      localStorage.setItem(DESKTOP_LANGUAGE_STORAGE_KEY, language)
    } catch {
      // Desktop preference persistence is local-only and fails closed.
    }
    return
  }
  if (typeof document === 'undefined') return
  try {
    const hostname = typeof window === 'undefined' ? '' : window.location.hostname
    const sharedDomain = hostname === 'shennian.net' || hostname.endsWith('.shennian.net')
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:'
    document.cookie = [
      `${WEB_LANGUAGE_COOKIE}=${language}`,
      'Max-Age=31536000',
      'Path=/',
      'SameSite=Lax',
      sharedDomain ? 'Domain=.shennian.net' : '',
      secure ? 'Secure' : '',
    ].filter(Boolean).join('; ')
  } catch {}
}

function detectDefaultLng(): string {
  // SSR and the browser's first hydration render must agree. Restore a saved
  // public-Web preference after mount in RootLayout. Desktop is a bundled SPA,
  // so it can restore its device-scoped preference before the first render.
  if (Platform.OS === 'web' && isDesktopControlSurfaceEnabled()) {
    return readWebLanguagePreference() ?? 'zh'
  }
  return 'zh'
}

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: detectDefaultLng(),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
})

if (Platform.OS === 'web' && isDesktopControlSurfaceEnabled()) {
  const synchronizeMenuLanguage = () => {
    const language = i18n.language.startsWith('en') ? 'en' : 'zh'
    void getDesktopControlBridge()?.app?.setLanguage?.({ language }).catch(() => {
      console.warn('[Desktop] Unable to synchronize menu language.')
    })
  }
  synchronizeMenuLanguage()
  i18n.on('languageChanged', synchronizeMenuLanguage)
}

// Native: user's manual override takes priority over system locale
if (Platform.OS !== 'web') {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default
    AsyncStorage.getItem('lang').then((saved: string | null) => {
      if (saved && saved !== i18n.language) {
        i18n.changeLanguage(saved)
      }
    })
  } catch {}
}

export default i18n
