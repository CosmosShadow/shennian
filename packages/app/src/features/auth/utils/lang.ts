// @arch docs/architecture/app/modular-features.md#登录-feature

import { Platform } from 'react-native'
import { persistWebLanguagePreference } from '../../../config/i18n'

export async function persistLang(lang: string) {
  if (Platform.OS === 'web') {
    persistWebLanguagePreference(lang === 'en' ? 'en' : 'zh')
    return
  }

  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default
    await AsyncStorage.setItem('lang', lang)
  } catch {}
}
