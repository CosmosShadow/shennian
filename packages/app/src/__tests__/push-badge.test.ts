import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NianSession } from '@shennian/wire'
import { countUnreadVisibleMessages } from '../lib/push-badge-count'

function session(overrides: Partial<NianSession>): NianSession {
  return {
    id: 's1',
    machineId: 'm1',
    userId: 'u1',
    agentType: 'codex',
    agentSessionId: null,
    title: 'test',
    status: 'active',
    workDir: '',
    lastMessagePreview: null,
    lastActivityAt: '2026-04-29T09:10:00.000Z',
    deletedAt: null,
    createdAt: '2026-04-29T09:00:00.000Z',
    updatedAt: '2026-04-29T09:10:00.000Z',
    ...overrides,
  }
}

describe('push badge sync', () => {
  it('counts unread attention results independently from body cardinality', () => {
    const sessions = [
      session({
        userState: {
          userId: 'u1',
          sessionId: 's1',
          lastReadAt: '2026-04-29T09:05:00.000Z',
          lastReadBodyRevision: 4,
          lastReadVisibleMessageCount: 3,
          lastReadVisibleMessageId: 'm3',
          lastReadAttentionCount: 3,
          lastReadAttentionId: 'a3',
          manualUnread: false,
          updatedAt: '2026-04-29T09:05:00.000Z',
        },
        bodyRevision: 10,
        visibleMessageCount: 5,
        lastVisibleMessageId: 'm5',
        attentionCount: 5,
        lastAttentionId: 'a5',
      }),
    ]

    const count = countUnreadVisibleMessages({ sessions })

    expect(count).toBe(2)
  })

  it('falls back to one badge for a manual unread marker', () => {
    const sessions = [
      session({
        userState: {
          userId: 'u1',
          sessionId: 's1',
          lastReadAt: '2026-04-29T09:05:00.000Z',
          manualUnread: true,
          updatedAt: '2026-04-29T09:05:00.000Z',
        },
      }),
    ]
    const count = countUnreadVisibleMessages({ sessions })

    expect(count).toBe(1)
  })

  it('collapses the reproduced 82 body states to one unread terminal result', () => {
    const reproduced = session({
      bodyRevision: 184,
      visibleMessageCount: 104,
      lastVisibleMessageId: 'message-104',
      attentionCount: 1,
      lastAttentionId: 'terminal:cleanup-run',
      userState: {
        userId: 'u1',
        sessionId: 's1',
        lastReadAt: '2026-09-02T05:00:00.000Z',
        lastReadBodyRevision: 22,
        lastReadVisibleMessageCount: 22,
        lastReadVisibleMessageId: 'message-22',
        lastReadAttentionCount: 0,
        lastReadAttentionId: null,
        manualUnread: false,
        updatedAt: '2026-09-02T05:00:00.000Z',
      },
    })

    expect(countUnreadVisibleMessages({ sessions: [reproduced] })).toBe(1)
  })

  it('clears the visible badge optimistically while the read watermark awaits reconnect', () => {
    const openedFromNotification = session({
      attentionCount: 2,
      lastAttentionId: 'a2',
      userState: {
        userId: 'u1',
        sessionId: 's1',
        lastReadAt: '2026-09-08T14:00:00.000Z',
        lastReadAttentionCount: 2,
        lastReadAttentionId: 'a2',
        manualUnread: false,
        readSyncPending: true,
        updatedAt: '2026-09-08T14:00:00.000Z',
      },
    })

    expect(countUnreadVisibleMessages({ sessions: [openedFromNotification] })).toBe(0)
  })
})


// @covers packages/app/src/lib/push-badge.ts
const native = vi.hoisted(() => ({ permission: vi.fn(), apply: vi.fn() }))
vi.mock('../lib/native-push-policy', () => ({ nativePushEnabled: () => true }))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('../storage/db', () => ({ db: { getSessions: async () => [] } }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => ({ user: { id: 'unit-user' } }) } }))
vi.mock('../features/rooms/roomListCache', () => ({ getRoomListSnapshot: () => ({ rooms: [] }) }))
vi.mock('expo-notifications', () => ({ getPermissionsAsync: native.permission, setBadgeCountAsync: native.apply }))
import { syncNativeBadgeCount } from '../lib/push-badge'
describe('native badge permission boundary', () => {
  beforeEach(() => { native.permission.mockReset(); native.apply.mockReset().mockResolvedValue(true) })
  it('does not call a setter or warn when iOS badge permission is denied', async () => {
    native.permission.mockResolvedValue({ granted: false, ios: { allowsBadge: false } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await syncNativeBadgeCount()).toBe(0)
      expect(native.apply).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })
  it('honors an explicit badge opt-out even when other notifications are permitted', async () => {
    native.permission.mockResolvedValue({ granted: true, ios: { allowsBadge: false } })
    await syncNativeBadgeCount()
    expect(native.apply).not.toHaveBeenCalled()
  })
  it('still sets permitted badges, including explicitly permitted provisional badges', async () => {
    for (const granted of [true, false]) {
      native.permission.mockResolvedValue({ granted, ios: { allowsBadge: true } })
      await syncNativeBadgeCount()
    }
    expect(native.apply).toHaveBeenCalledTimes(2)
    expect(native.apply).toHaveBeenCalledWith(0)
  })
  it('does not hide an unexpected native setter failure', async () => {
    native.permission.mockResolvedValue({ granted: true, ios: { allowsBadge: true } })
    native.apply.mockRejectedValue(new Error('native failure'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try { await syncNativeBadgeCount(); expect(warn).toHaveBeenCalledWith('[push] native badge update failed', expect.objectContaining({ error: 'native failure' })) }
    finally { warn.mockRestore() }
  })
})
