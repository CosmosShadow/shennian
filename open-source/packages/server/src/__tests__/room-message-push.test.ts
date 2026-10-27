// @covers open-source/packages/server/src/services/room-message-push.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  redisSetMock,
  findRoomMock,
  findMessageMock,
  countUnreadMock,
  sendPushMock,
  writeLogMock,
} = vi.hoisted(() => ({
  redisSetMock: vi.fn(),
  findRoomMock: vi.fn(),
  findMessageMock: vi.fn(),
  countUnreadMock: vi.fn(),
  sendPushMock: vi.fn(),
  writeLogMock: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({ redis: { set: redisSetMock } }))
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    room: { findUnique: findRoomMock },
    roomMessage: { findUnique: findMessageMock },
  },
}))
vi.mock('../services/unread-badge.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/unread-badge.js')>()
  return { ...original, countUnreadVisibleMessages: countUnreadMock }
})
vi.mock('../services/push.js', () => ({ sendPushNotification: sendPushMock }))
vi.mock('../services/log.js', () => ({ writeLog: writeLogMock }))

import { roomMessageMentionsRecipient, scheduleAgentSafetyPausePush, scheduleRoomMessagePush } from '../services/room-message-push.js'

describe('room-message-push', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    redisSetMock.mockResolvedValue('OK')
    countUnreadMock.mockResolvedValue(3)
    findRoomMock.mockResolvedValue({
      name: '研发群',
      status: 'active',
      memberships: [
        { id: 'author', userId: 'u1', readState: { lastReadSequence: 4n }, agentChildren: [], muteRegularNotifications: false, muteMentionNotifications: false },
        { id: 'recipient', userId: 'u2', readState: { lastReadSequence: 4n }, agentChildren: [], muteRegularNotifications: false, muteMentionNotifications: false },
        { id: 'already-read', userId: 'u3', readState: { lastReadSequence: 5n }, agentChildren: [], muteRegularNotifications: false, muteMentionNotifications: false },
      ],
    })
    findMessageMock.mockResolvedValue({
      roomId: 'room-1',
      sequence: 5n,
      authorMembershipId: 'author',
      ownerUserIdSnapshot: 'u1',
      authorDisplayNameSnapshot: '小念',
      mentionSnapshots: [],
      text: '**已经完成**',
      deletedAt: null,
      _count: { attachments: 0 },
    })
  })

  it('notifies unread human recipients, excluding the author and readers already caught up', async () => {
    await scheduleRoomMessagePush({ roomId: 'room-1', messageId: 'message-5', delayMs: 10 })
    await vi.advanceTimersByTimeAsync(10)

    expect(sendPushMock).toHaveBeenCalledTimes(1)
    expect(sendPushMock).toHaveBeenCalledWith(
      'u2',
      '研发群',
      '小念: 已经完成',
      { roomId: 'room-1', messageId: 'message-5' },
      expect.objectContaining({ audience: 'mobile', badge: 3 }),
    )
    expect(writeLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2', path: 'push.room-message' }),
    )
  })

  it('notifies only the Agent Owner about a self-pause without exposing the reason', async () => {
    await scheduleAgentSafetyPausePush({
      roomId: 'room-1', messageId: 'pause-1', ownerUserId: 'u1',
    })
    expect(redisSetMock).toHaveBeenCalledWith(
      'push:agent-safety-pause:pause-1', '1', 'EX', expect.any(Number), 'NX',
    )
    expect(sendPushMock).toHaveBeenCalledWith(
      'u1',
      '智能体已暂停工作',
      expect.not.stringContaining('越权诱导'),
      { roomId: 'room-1', messageId: 'pause-1', kind: 'agent_safety_pause' },
      { audience: 'mobile' },
    )
    redisSetMock.mockResolvedValueOnce(null)
    await scheduleAgentSafetyPausePush({ roomId: 'room-1', messageId: 'pause-1', ownerUserId: 'u1' })
    expect(sendPushMock).toHaveBeenCalledTimes(1)
  })

  it('uses an attachment-safe preview and deduplicates repeated scheduling', async () => {
    findRoomMock.mockResolvedValue({
      name: '研发群',
      status: 'active',
      memberships: [{ id: 'recipient', userId: 'u2', readState: null, agentChildren: [], muteRegularNotifications: false, muteMentionNotifications: false }],
    })
    findMessageMock.mockResolvedValue({
      roomId: 'room-1',
      sequence: 5n,
      authorMembershipId: 'agent',
      ownerUserIdSnapshot: 'u1',
      authorDisplayNameSnapshot: '神念客服',
      mentionSnapshots: [],
      text: '',
      deletedAt: null,
      _count: { attachments: 1 },
    })

    await scheduleRoomMessagePush({ roomId: 'room-1', messageId: 'message-5', delayMs: 10 })
    redisSetMock.mockResolvedValueOnce(null)
    await scheduleRoomMessagePush({ roomId: 'room-1', messageId: 'message-5', delayMs: 10 })
    await vi.advanceTimersByTimeAsync(10)

    expect(sendPushMock).toHaveBeenCalledTimes(1)
    expect(sendPushMock).toHaveBeenCalledWith(
      'u2',
      '研发群',
      '神念客服: 发送了附件',
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('classifies mentions of the human or any of their managed Agents', () => {
    expect(roomMessageMentionsRecipient([{ membershipId: 'managed-agent' }], 'human', ['managed-agent'])).toBe(true)
    expect(roomMessageMentionsRecipient([{ membershipId: 'human' }], 'human', ['managed-agent'])).toBe(true)
    expect(roomMessageMentionsRecipient([{ membershipId: 'someone-else' }], 'human', ['managed-agent'])).toBe(false)
  })

  it('applies regular and mention mute preferences independently', async () => {
    findRoomMock.mockResolvedValue({
      name: '研发群', status: 'active',
      memberships: [{ id: 'recipient', userId: 'u2', readState: null, agentChildren: [{ id: 'managed-agent' }], muteRegularNotifications: true, muteMentionNotifications: false }],
    })
    findMessageMock.mockResolvedValue({
      roomId: 'room-1', sequence: 5n, authorMembershipId: 'author', ownerUserIdSnapshot: 'u1',
      authorDisplayNameSnapshot: '小念', text: '@助手 请处理', mentionSnapshots: [{ membershipId: 'managed-agent' }],
      deletedAt: null, _count: { attachments: 0 },
    })
    await scheduleRoomMessagePush({ roomId: 'room-1', messageId: 'mention', delayMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect(sendPushMock).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    redisSetMock.mockResolvedValue('OK')
    findRoomMock.mockResolvedValue({
      name: '研发群', status: 'active',
      memberships: [{ id: 'recipient', userId: 'u2', readState: null, agentChildren: [{ id: 'managed-agent' }], muteRegularNotifications: false, muteMentionNotifications: true }],
    })
    findMessageMock.mockResolvedValue({
      roomId: 'room-1', sequence: 6n, authorMembershipId: 'author', ownerUserIdSnapshot: 'u1',
      authorDisplayNameSnapshot: '小念', text: '@助手 请处理', mentionSnapshots: [{ membershipId: 'managed-agent' }],
      deletedAt: null, _count: { attachments: 0 },
    })
    await scheduleRoomMessagePush({ roomId: 'room-1', messageId: 'muted-mention', delayMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect(sendPushMock).not.toHaveBeenCalled()
  })
})
