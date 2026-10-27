// @arch docs/features/chat-font-size.md
// @test src/__tests__/chat-font-size.test.ts
import { useEffect, useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createChatFontPreference, chatTypography, desktopChatTypography, DESKTOP_CHAT_FONT_SIZE_KEY } from '../features/chat/preferences/chatFontSize'
import { isDesktopControlSurfaceEnabled } from '../utils/controlSurfaceLayout'

const preference = createChatFontPreference(AsyncStorage)
const desktopPreference = createChatFontPreference(AsyncStorage, DESKTOP_CHAT_FONT_SIZE_KEY)
const serverSnapshot = { size: 'medium' as const, saveFailed: false }
export function useChatFontSize(options: { desktopDensity?: boolean } = {}) {
  const desktop = isDesktopControlSurfaceEnabled() || options.desktopDensity === true
  const current = desktop ? desktopPreference : preference
  const state = useSyncExternalStore(current.subscribe, current.getSnapshot, () => serverSnapshot)
  useEffect(() => { void current.load() }, [current])
  return { ...state, desktop, typography: (desktop ? desktopChatTypography : chatTypography)[state.size], setSize: current.setSize }
}
