// @arch docs/architecture/app/modular-features.md#聊天-feature
// @covers packages/app/src/features/chat/utils/scrollPositionStorage.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'shennian:chatScrollPositions'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('chat scroll position storage', () => {
  it('never restores or persists a position between conversation entries', async () => {
    vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }))
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const storage = await import('../features/chat/utils/scrollPositionStorage')

    await storage.hydrateChatScrollPositionStorage()
    storage.saveChatScrollPosition('session-1', {
      scrollTop: 320,
      distanceFromBottom: 900,
    })

    expect(storage.getChatScrollPosition('session-1')).toBeNull()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('still clears legacy native position data during personal-data reset', async () => {
    const setItem = vi.fn(async () => undefined)
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }))
    vi.doMock('@react-native-async-storage/async-storage', () => ({
      default: { setItem },
    }))
    const storage = await import('../features/chat/utils/scrollPositionStorage')

    await storage.clearAllChatScrollPositions()

    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, '{}')
  })
})
