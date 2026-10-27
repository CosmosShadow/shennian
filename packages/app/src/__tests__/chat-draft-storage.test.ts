// @arch docs/architecture/app/chat-draft-storage.md
// @covers packages/app/src/features/chat/utils/draftStorage.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'shennian:chatDrafts:v2'
const ACCOUNT_ID = 'account-a'
const ATTACHMENT_META = { byteSize: 123, sha256: 'a'.repeat(64) }
const activeWebModules: Array<{ flushChatDraftStorage(): void }> = []

function resetChatDraftStorageTestContext() {
  for (const module of activeWebModules.splice(0)) module.flushChatDraftStorage()
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

async function importWebChatDraftStorage(store = new Map<string, string>()) {
  vi.doMock('react-native', () => ({
    Platform: { OS: 'web' },
  }))
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
  })

  const module = await import('../features/chat/utils/draftStorage')
  activeWebModules.push(module)
  return {
    module,
    store,
  }
}

async function importNativeChatDraftStorage(store = new Map<string, string>()) {
  const getItem = vi.fn(async (key: string) => store.get(key) ?? null)
  const setItem = vi.fn(async (key: string, value: string) => {
    store.set(key, value)
  })

  vi.doMock('react-native', () => ({
    Platform: { OS: 'ios' },
  }))
  vi.doMock('@react-native-async-storage/async-storage', () => ({
    default: { getItem, setItem },
  }))

  return {
    module: await import('../features/chat/utils/draftStorage'),
    store,
    getItem,
    setItem,
  }
}

afterEach(() => {
  resetChatDraftStorageTestContext()
  vi.useRealTimers()
})

describe('chat draft storage', () => {
  it('restores web chat drafts from localStorage after a reload', async () => {
    const persisted = new Map<string, string>()

    const firstLoad = await importWebChatDraftStorage(persisted)
    firstLoad.module.saveChatDraft(ACCOUNT_ID, 'session-1', {
      text: '还没发出去',
      attachments: [
        {
          path: '/tmp/project/.uploads/shot.png',
          name: 'shot.png',
          mimeType: 'image/png',
          kind: 'image',
          ...ATTACHMENT_META,
        },
      ],
    })
    firstLoad.module.flushChatDraftStorage()

    resetChatDraftStorageTestContext()

    const secondLoad = await importWebChatDraftStorage(persisted)
    expect(secondLoad.module.getChatDraft(ACCOUNT_ID, 'session-1')).toEqual({
      text: '还没发出去',
      attachments: [
        {
          path: '/tmp/project/.uploads/shot.png',
          name: 'shot.png',
          mimeType: 'image/png',
          kind: 'image',
          ...ATTACHMENT_META,
        },
      ],
    })
  })

  it('hydrates native chat drafts from AsyncStorage and removes empty drafts', async () => {
    const persisted = new Map<string, string>([
      [
        STORAGE_KEY,
        JSON.stringify({
          [ACCOUNT_ID]: {
            'session-1': {
              text: 'draft',
              attachments: [
                {
                  path: '/tmp/project/.uploads/readme.md',
                  name: 'readme.md',
                  mimeType: 'text/markdown',
                  kind: 'file',
                  ...ATTACHMENT_META,
                },
              ],
            },
          },
        }),
      ],
    ])

    const firstLoad = await importNativeChatDraftStorage(persisted)
    await firstLoad.module.hydrateChatDraftStorage()
    expect(firstLoad.module.getChatDraft(ACCOUNT_ID, 'session-1')).toEqual({
      text: 'draft',
      attachments: [
        {
          path: '/tmp/project/.uploads/readme.md',
          name: 'readme.md',
          mimeType: 'text/markdown',
          kind: 'file',
          ...ATTACHMENT_META,
        },
      ],
    })

    firstLoad.module.saveChatDraft(ACCOUNT_ID, 'session-1', { text: '', attachments: [] })
    expect(firstLoad.module.getChatDraft(ACCOUNT_ID, 'session-1')).toBeNull()
    expect(firstLoad.setItem).toHaveBeenCalled()
  })

  it('filters invalid attachment payloads when hydrating', async () => {
    const persisted = new Map<string, string>([
      [
        STORAGE_KEY,
        JSON.stringify({
          [ACCOUNT_ID]: {
            'session-1': {
              text: 'draft',
              attachments: [
                {
                  path: '/tmp/project/.uploads/shot.png',
                  name: 'shot.png',
                  mimeType: 'image/png',
                  kind: 'image',
                  ...ATTACHMENT_META,
                },
                {
                  path: '/tmp/project/.uploads/bad.png',
                  name: 'bad.png',
                  mimeType: 'image/png',
                  kind: 'video',
                },
              ],
            },
          },
        }),
      ],
    ])

    const { module } = await importWebChatDraftStorage(persisted)
    expect(module.getChatDraft(ACCOUNT_ID, 'session-1')).toEqual({
      text: 'draft',
      attachments: [
        {
          path: '/tmp/project/.uploads/shot.png',
          name: 'shot.png',
          mimeType: 'image/png',
          kind: 'image',
          ...ATTACHMENT_META,
        },
      ],
    })
  })

  it('keeps folder attachments in saved drafts', async () => {
    const { module } = await importWebChatDraftStorage()

    module.saveChatDraft(ACCOUNT_ID, 'session-folder', {
      text: '继续处理这个目录',
      attachments: [
        {
          path: '/home/zb-工作包',
          name: 'zb-工作包',
          mimeType: 'inode/directory',
          kind: 'folder',
          ...ATTACHMENT_META,
        },
      ],
    })

    expect(module.getChatDraft(ACCOUNT_ID, 'session-folder')).toEqual({
      text: '继续处理这个目录',
      attachments: [
        {
          path: '/home/zb-工作包',
          name: 'zb-工作包',
          mimeType: 'inode/directory',
          kind: 'folder',
          ...ATTACHMENT_META,
        },
      ],
    })
  })

  it('removes a single draft without touching other sessions', async () => {
    const { module } = await importWebChatDraftStorage()

    module.saveChatDraft(ACCOUNT_ID, 'session-1', { text: 'one', attachments: [] })
    module.saveChatDraft(ACCOUNT_ID, 'session-2', { text: 'two', attachments: [] })
    module.removeChatDraft(ACCOUNT_ID, 'session-1')

    expect(module.getChatDraft(ACCOUNT_ID, 'session-1')).toBeNull()
    expect(module.getChatDraft(ACCOUNT_ID, 'session-2')).toEqual({
      text: 'two',
      attachments: [],
    })
  })

  it('publishes draft preview updates to subscribers', async () => {
    const { module } = await importWebChatDraftStorage()
    const listener = vi.fn()
    const unsubscribe = module.subscribeChatDrafts(listener)

    module.saveChatDraft(ACCOUNT_ID, 'session-1', { text: ' 第一行\n第二行 ', attachments: [] })

    expect(module.getChatDraftPreview(ACCOUNT_ID, 'session-1')).toBe('第一行 第二行')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    module.removeChatDraft(ACCOUNT_ID, 'session-1')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('wakes only the changed session preview subscriber while typing', async () => {
    const { module } = await importWebChatDraftStorage()
    const current = vi.fn()
    const unrelated = vi.fn()
    module.subscribeChatDraft(ACCOUNT_ID, 'session-1', current)
    module.subscribeChatDraft(ACCOUNT_ID, 'session-2', unrelated)

    module.saveChatDraft(ACCOUNT_ID, 'session-1', { text: 'a', attachments: [] })
    module.saveChatDraft(ACCOUNT_ID, 'session-1', { text: 'ab', attachments: [] })

    expect(current).toHaveBeenCalledTimes(2)
    expect(unrelated).not.toHaveBeenCalled()
  })

  it('keeps preview reads in memory and coalesces web persistence while typing', async () => {
    vi.useFakeTimers()
    const { module } = await importWebChatDraftStorage()
    const getItem = vi.mocked(localStorage.getItem)
    const setItem = vi.mocked(localStorage.setItem)

    expect(getItem).toHaveBeenCalledTimes(1)
    module.saveChatDraft(ACCOUNT_ID, 'session-1', { text: 'a', attachments: [] })
    module.saveChatDraft(ACCOUNT_ID, 'session-1', { text: 'ab', attachments: [] })
    module.saveChatDraft(ACCOUNT_ID, 'session-1', { text: 'abc', attachments: [] })
    for (let index = 0; index < 100; index += 1) {
      expect(module.getChatDraftPreview(ACCOUNT_ID, 'session-1')).toBe('abc')
    }

    expect(getItem).toHaveBeenCalledTimes(1)
    expect(setItem).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(149)
    expect(setItem).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject({
      [ACCOUNT_ID]: { 'session-1': { text: 'abc' } },
    })
  })

  it('isolates equal session ids by account and clears only the selected account', async () => {
    const { module } = await importWebChatDraftStorage()
    module.saveChatDraft('account-a', 'same-session', { text: 'A', attachments: [] })
    module.saveChatDraft('account-b', 'same-session', { text: 'B', attachments: [] })

    expect(module.getChatDraft('account-a', 'same-session')?.text).toBe('A')
    expect(module.getChatDraft('account-b', 'same-session')?.text).toBe('B')

    module.clearChatDraftAccount('account-a')
    expect(module.getChatDraft('account-a', 'same-session')).toBeNull()
    expect(module.getChatDraft('account-b', 'same-session')?.text).toBe('B')
  })
})
