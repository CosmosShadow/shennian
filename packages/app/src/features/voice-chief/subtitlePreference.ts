// @arch docs/features/voice-shennian.md
// @test src/__tests__/voice-chief-transcript.test.ts

const VOICE_CHIEF_SUBTITLES_KEY = 'shennian:voice-chief:subtitles'

export type VoiceChiefSubtitleStore = {
  getItem(key: string): Promise<string | null> | string | null
  setItem(key: string, value: string): Promise<void> | void
}

function defaultStore(): VoiceChiefSubtitleStore | null {
  const { Platform } = require('react-native') as typeof import('react-native')
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    }
  }
  try {
    const storage = require('@react-native-async-storage/async-storage').default
    return storage as VoiceChiefSubtitleStore
  } catch {
    return null
  }
}

export async function loadVoiceChiefSubtitlePreference(
  store: VoiceChiefSubtitleStore | null = defaultStore(),
): Promise<boolean> {
  if (!store) return true
  const value = await store.getItem(VOICE_CHIEF_SUBTITLES_KEY)
  return value === null ? true : value !== 'false'
}

export async function saveVoiceChiefSubtitlePreference(
  enabled: boolean,
  store: VoiceChiefSubtitleStore | null = defaultStore(),
): Promise<void> {
  if (!store) return
  await store.setItem(VOICE_CHIEF_SUBTITLES_KEY, enabled ? 'true' : 'false')
}
