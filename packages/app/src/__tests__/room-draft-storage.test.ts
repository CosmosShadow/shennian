// @arch docs/features/network-rooms/local-first-persistence.md#本机草稿
// @covers src/features/rooms/roomDraftStorage.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'shennian:roomDrafts:v1'

async function loadNative(persisted = new Map<string, string>()) {
  const getItem = vi.fn(async (key: string) => persisted.get(key) ?? null)
  const setItem = vi.fn(async (key: string, value: string) => {
    persisted.set(key, value)
  })
  vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }))
  vi.doMock('@react-native-async-storage/async-storage', () => ({
    default: { getItem, setItem },
  }))
  return {
    module: await import('../features/rooms/roomDraftStorage'),
    persisted,
    setItem,
  }
}

async function loadWeb(persisted = new Map<string, string>()) {
  vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }))
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => persisted.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => persisted.set(key, value)),
  })
  return { module: await import('../features/rooms/roomDraftStorage'), persisted }
}

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('room draft device-local storage', () => {
  it('hides the active Room preview without discarding its saved draft', async () => {
    const { module } = await loadNative()
    await module.hydrateRoomDraftStorage()
    module.saveRoomDraft('account', 'room', { text: '你好', attachments: [], mentionMembershipIds: [] })
    expect(module.getRoomDraftPreview('account', 'room', true)).toBe('')
    expect(module.getRoomDraft('account', 'room')?.text).toBe('你好')
    expect(module.getRoomDraftPreview('account', 'room', false)).toBe('你好')
    expect(module.getRoomDraftPreview('account', 'room', true)).toBe('')
    module.removeRoomDraft('account', 'room')
    expect(module.getRoomDraftPreview('account', 'room', false)).toBe('')
  })

  it('hydrates text, completed attachments and mention identities from this device', async () => {
    const persisted = new Map([
      [
        KEY,
        JSON.stringify({
          account: {
            room: {
              text: '稍后发送',
              attachments: [
                { attachmentId: 'attachment-1', name: 'a.png', mimeType: 'image/png', size: 12 },
              ],
              mentionMembershipIds: ['member-1'],
            },
          },
        }),
      ],
    ])
    const { module } = await loadNative(persisted)

    await module.hydrateRoomDraftStorage()

    expect(module.getRoomDraft('account', 'room')).toEqual({
      text: '稍后发送',
      attachments: [
        { attachmentId: 'attachment-1', name: 'a.png', mimeType: 'image/png', size: 12 },
      ],
      mentionMembershipIds: ['member-1'],
    })
  })

  it('isolates equal room ids by account and clears only one account', async () => {
    const { module } = await loadNative()
    await module.hydrateRoomDraftStorage()
    module.saveRoomDraft('a', 'room', { text: 'A', attachments: [], mentionMembershipIds: [] })
    module.saveRoomDraft('b', 'room', { text: 'B', attachments: [], mentionMembershipIds: [] })

    module.clearRoomDraftAccount('a')

    expect(module.getRoomDraft('a', 'room')).toBeNull()
    expect(module.getRoomDraft('b', 'room')?.text).toBe('B')
  })

  it('removes an empty draft and publishes list preview changes', async () => {
    const { module } = await loadNative()
    await module.hydrateRoomDraftStorage()
    const listener = vi.fn()
    module.subscribeRoomDrafts(listener)
    module.saveRoomDraft('account', 'room', {
      text: ' 第一行\n第二行 ',
      attachments: [],
      mentionMembershipIds: [],
    })
    expect(module.getRoomDraftPreview('account', 'room')).toBe('第一行 第二行')
    module.saveRoomDraft('account', 'room', {
      text: ' 第一行\n第二行 ',
      attachments: [],
      mentionMembershipIds: [],
    })
    expect(listener).toHaveBeenCalledTimes(1)

    module.saveRoomDraft('account', 'room', {
      text: '',
      attachments: [],
      mentionMembershipIds: [],
    })
    expect(module.getRoomDraft('account', 'room')).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('wakes only the changed Room preview subscriber while typing', async () => {
    const { module } = await loadNative()
    await module.hydrateRoomDraftStorage()
    const current = vi.fn()
    const unrelated = vi.fn()
    module.subscribeRoomDraft('account', 'room-1', current)
    module.subscribeRoomDraft('account', 'room-2', unrelated)

    module.saveRoomDraft('account', 'room-1', {
      text: 'a', attachments: [], mentionMembershipIds: [],
    })
    module.saveRoomDraft('account', 'room-1', {
      text: 'ab', attachments: [], mentionMembershipIds: [],
    })

    expect(current).toHaveBeenCalledTimes(2)
    expect(unrelated).not.toHaveBeenCalled()
  })

  it('never persists uploading local file state', async () => {
    const { module } = await loadNative()
    await module.hydrateRoomDraftStorage()
    module.saveRoomDraft('account', 'room', {
      text: '',
      attachments: [{ attachmentId: '', name: 'local.png', mimeType: 'image/png', size: 5 }],
      mentionMembershipIds: [],
    })
    expect(module.getRoomDraft('account', 'room')).toBeNull()
  })

  it('coalesces desktop Room draft persistence while typing', async () => {
    vi.useFakeTimers()
    const { module } = await loadWeb()
    await module.hydrateRoomDraftStorage()
    const setItem = vi.mocked(localStorage.setItem)

    module.saveRoomDraft('account', 'room', { text: 'a', attachments: [], mentionMembershipIds: [] })
    module.saveRoomDraft('account', 'room', { text: 'ab', attachments: [], mentionMembershipIds: [] })
    module.saveRoomDraft('account', 'room', { text: 'abc', attachments: [], mentionMembershipIds: [] })

    expect(module.getRoomDraft('account', 'room')?.text).toBe('abc')
    expect(setItem).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject({
      account: { room: { text: 'abc' } },
    })
    vi.useRealTimers()
  })
})
