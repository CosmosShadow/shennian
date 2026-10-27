// @covers open-source/packages/server/src/services/room-core.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    room: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    roomInvite: { updateMany: vi.fn() },
    roomInviteBrowserState: { updateMany: vi.fn() },
    roomJoinRequest: { updateMany: vi.fn() },
    roomMembership: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    roomReadState: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    roomMessage: { findUnique: vi.fn(), create: vi.fn() },
    roomAttachment: { findMany: vi.fn(), updateMany: vi.fn() },
    roomBinding: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/room-session-cleanup.js', () => ({
  commitExclusiveRoomSessionDeletions: vi.fn(async (_tx, targets) => targets),
}))

import {
  createRoomWithOwner,
  dissolveRoom,
  normalizeRoomAccess,
  normalizeRoomName,
  removeRoomMembership,
  sendRoomTextMessage,
  updateRoomSettings,
} from '../services/room-core.js'

describe('Room core transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', name: '李辰' })
    mockPrisma.room.create.mockResolvedValue({ id: 'room_1', name: '项目空间' })
    mockPrisma.roomMembership.create.mockResolvedValue({ id: 'member_owner', role: 'owner' })
    mockPrisma.roomReadState.create.mockResolvedValue({})
    mockPrisma.roomReadState.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.roomReadState.findUnique.mockResolvedValue(null)
    mockPrisma.roomMessage.findUnique.mockResolvedValue(null)
    mockPrisma.room.update.mockResolvedValue({ nextSequence: 1n })
    mockPrisma.roomMessage.create.mockResolvedValue({ id: 'message_1', sequence: 1n })
    mockPrisma.roomAttachment.findMany.mockResolvedValue([])
    mockPrisma.roomAttachment.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.roomMembership.findMany.mockResolvedValue([])
    mockPrisma.roomMembership.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.roomBinding.findUnique.mockResolvedValue(null)
    mockPrisma.roomBinding.findMany.mockResolvedValue([])
    mockPrisma.roomInvite.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.roomInviteBrowserState.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.roomJoinRequest.updateMany.mockResolvedValue({ count: 0 })
  })

  it('creates the Room, owner membership, and read state atomically', async () => {
    await expect(
      createRoomWithOwner({ userId: 'user_1', name: '  项目空间  ' }),
    ).resolves.toMatchObject({
      room: { id: 'room_1' },
      membership: { id: 'member_owner' },
    })

    expect(mockPrisma.room.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '项目空间',
        createdByUserId: 'user_1',
        ownerUserId: 'user_1',
        visibility: 'private',
        joinPolicy: 'open',
      }),
    })
    expect(mockPrisma.roomMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        principalKey: 'human:user_1',
        role: 'owner',
      }),
    })
    expect(mockPrisma.roomReadState.create).toHaveBeenCalledWith({
      data: { roomId: 'room_1', membershipId: 'member_owner' },
    })
  })

  it('requires a user-confirmed display name before creating a Room', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', name: ' ' })

    await expect(createRoomWithOwner({ userId: 'user_1', name: '项目空间' })).rejects.toMatchObject(
      {
        code: 'profile_name_required',
      },
    )
    expect(mockPrisma.room.create).not.toHaveBeenCalled()
  })

  it('reuses the same Room for a retried CLI create operation', async () => {
    const existingRoom = {
      id: `room_cli_${'a'.repeat(32)}`,
      name: '项目空间',
      createdByUserId: 'user_1',
      ownerUserId: 'user_1',
      visibility: 'private',
      joinPolicy: 'open',
    }
    mockPrisma.room.findUnique.mockResolvedValue(existingRoom)
    mockPrisma.roomMembership.findUnique.mockResolvedValue({ id: 'member_owner', status: 'active' })

    const result = await createRoomWithOwner({
      userId: 'user_1',
      name: '项目空间',
      clientOperationId: 'operation-1234',
    })

    expect(result).toMatchObject({ room: existingRoom, idempotent: true })
    expect(mockPrisma.room.create).not.toHaveBeenCalled()
  })

  it('notifies the Room when its name changes, without a separate access-settings notice', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_owner',
      status: 'active',
      role: 'owner',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: '李辰',
      room: {
        id: 'room_1',
        name: '项目空间',
        status: 'active',
        visibility: 'private',
        joinPolicy: 'approval',
      },
    })
    mockPrisma.room.update.mockResolvedValue({
      id: 'room_1',
      name: '开放协作',
      status: 'active',
      visibility: 'public_read',
      joinPolicy: 'open',
      nextSequence: 4n,
    })

    const result = await updateRoomSettings({
      roomId: 'room_1',
      actorUserId: 'user_1',
      name: '  开放协作  ',
      visibility: 'public_read',
      joinPolicy: 'open',
    })

    expect(result.idempotent).toBe(false)
    expect(result.message).toMatchObject({ id: 'message_1', sequence: 1n })
    expect(mockPrisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room_1' },
      data: {
        name: '开放协作',
        visibility: 'public_read',
        joinPolicy: 'open',
      },
    })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'system',
        source: 'system',
        authorMembershipId: 'member_owner',
        authorDisplayNameSnapshot: '李辰',
        text: '李辰 changed the group chat name to “开放协作”.',
        clientMessageId: expect.stringMatching(/^system:room-renamed:/),
      }),
    })
  })

  it('does not notify for unchanged names or access-only changes', async () => {
    const room = {
      id: 'room_1', name: '项目空间', status: 'active', visibility: 'private',
      joinPolicy: 'approval', maxAgentsPerUser: 1,
    }
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_owner', status: 'active', role: 'owner', principalType: 'human',
      ownerUserId: 'user_1', displayAlias: '李辰', room,
    })
    mockPrisma.room.update.mockResolvedValue({ ...room, joinPolicy: 'open', nextSequence: 4n })

    await expect(updateRoomSettings({
      roomId: room.id, actorUserId: 'user_1', name: '  项目空间  ',
    })).resolves.toMatchObject({ idempotent: true, message: null })
    await expect(updateRoomSettings({
      roomId: room.id, actorUserId: 'user_1', joinPolicy: 'open',
    })).resolves.toMatchObject({ idempotent: false, message: null })
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
  })

  it('lets an ordinary member rename the Room but not change access settings', async () => {
    const room = {
      id: 'room_1',
      name: '旧名称',
      status: 'active',
      visibility: 'private',
      joinPolicy: 'approval',
    }
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_1',
      status: 'active',
      role: 'member',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: '成员',
      room,
    })
    mockPrisma.room.update.mockResolvedValue({ ...room, name: '新名称', nextSequence: 1n })

    await expect(
      updateRoomSettings({ roomId: 'room_1', actorUserId: 'user_1', name: '新名称' }),
    ).resolves.toMatchObject({ room: { name: '新名称' }, idempotent: false })

    await expect(
      updateRoomSettings({ roomId: 'room_1', actorUserId: 'user_1', joinPolicy: 'open' }),
    ).rejects.toMatchObject({ code: 'room_admin_forbidden' })
    await expect(
      updateRoomSettings({
        roomId: 'room_1',
        actorUserId: 'user_1',
        maxAgentsPerMember: 2,
      }),
    ).rejects.toMatchObject({ code: 'room_admin_forbidden' })
  })

  it('lets the owner set the regular-member Agent quota from zero to five', async () => {
    const room = {
      id: 'room_1',
      name: '项目空间',
      status: 'active',
      visibility: 'private',
      joinPolicy: 'approval',
      maxAgentsPerUser: 1,
    }
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_owner',
      status: 'active',
      role: 'owner',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: '群主',
      room,
    })
    mockPrisma.room.update.mockResolvedValue({
      ...room,
      maxAgentsPerUser: 5,
      nextSequence: 2n,
    })
    mockPrisma.roomMessage.create.mockResolvedValue({ id: 'message_settings', sequence: 2n })

    await expect(
      updateRoomSettings({
        roomId: 'room_1',
        actorUserId: 'user_1',
        maxAgentsPerMember: 5,
      }),
    ).resolves.toMatchObject({ room: { maxAgentsPerUser: 5 } })
    expect(mockPrisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room_1' },
      data: expect.objectContaining({ maxAgentsPerUser: 5 }),
    })
    await expect(
      updateRoomSettings({
        roomId: 'room_1',
        actorUserId: 'user_1',
        maxAgentsPerMember: 6,
      }),
    ).rejects.toMatchObject({ code: 'invalid_member_agent_limit' })
  })

  it('does not allocate a sequence or audit message for an unchanged settings retry', async () => {
    const room = {
      id: 'room_1',
      name: '项目空间',
      status: 'active',
      visibility: 'private',
      joinPolicy: 'approval',
    }
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_owner',
      status: 'active',
      role: 'owner',
      room,
    })

    await expect(
      updateRoomSettings({
        roomId: 'room_1',
        actorUserId: 'user_1',
        name: '项目空间',
        visibility: 'private',
        joinPolicy: 'approval',
      }),
    ).resolves.toEqual({ room, message: null, idempotent: true })
    expect(mockPrisma.room.update).not.toHaveBeenCalled()
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
  })

  it('rejects an update when the caller used a stale Room version', async () => {
    const updatedAt = new Date('2026-09-22T00:00:00.000Z')
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_owner',
      status: 'active',
      role: 'owner',
      room: {
        id: 'room_1', name: '项目空间', status: 'active', visibility: 'private',
        joinPolicy: 'open', updatedAt,
      },
    })

    await expect(updateRoomSettings({
      roomId: 'room_1',
      actorUserId: 'user_1',
      expectedUpdatedAt: new Date('2026-09-21T00:00:00.000Z'),
      name: '新名称',
    })).rejects.toMatchObject({ code: 'room_version_conflict' })
    expect(mockPrisma.room.update).not.toHaveBeenCalled()
  })

  it('allocates sequence and writes a text message in one serializable transaction', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_1',
      roomId: 'room_1',
      status: 'active',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: '李辰',
      room: { status: 'active' },
      ownerUser: {
        id: 'user_1',
        name: '李辰',
        avatarVersion: 'v'.repeat(24),
        avatarUpdatedAt: new Date('2026-08-23T12:00:00.000Z'),
      },
    })

    const result = await sendRoomTextMessage({
      roomId: 'room_1',
      authorMembershipId: 'member_1',
      clientMessageId: 'client_1',
      text: '  hello  ',
    })

    expect(result.idempotent).toBe(false)
    expect(mockPrisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room_1' },
      data: { nextSequence: { increment: 1 } },
      select: { nextSequence: true },
    })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequence: 1n,
        clientMessageId: 'client_1',
        text: 'hello',
        ownerDisplayNameSnapshot: '李辰',
        authorAvatarSnapshot: {
          version: 'v'.repeat(24),
          smallUrl: `/public/profile-avatars/user_1/${'v'.repeat(24)}/96`,
          mediumUrl: `/public/profile-avatars/user_1/${'v'.repeat(24)}/256`,
          updatedAt: '2026-08-23T12:00:00.000Z',
        },
      }),
      include: { attachments: true },
    })
  })

  it('moves the sender watermark onto their own message only when they had read everything before it', async () => {
    const humanMembership = {
      id: 'member_1',
      roomId: 'room_1',
      status: 'active',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: '李辰',
      room: { status: 'active' },
      ownerUser: { id: 'user_1', name: '李辰', avatarVersion: null, avatarUpdatedAt: null },
    }
    mockPrisma.roomMembership.findUnique.mockResolvedValue(humanMembership)
    mockPrisma.room.update.mockResolvedValue({ nextSequence: 8n })
    mockPrisma.roomMessage.create.mockResolvedValue({ id: 'message_8', sequence: 8n })
    mockPrisma.roomReadState.updateMany.mockResolvedValue({ count: 1 })

    const read = await sendRoomTextMessage({
      roomId: 'room_1', authorMembershipId: 'member_1', clientMessageId: 'client_8', text: 'hi',
    })
    expect(read.authorReadAdvanced).toBe(true)
    expect(mockPrisma.roomReadState.updateMany).toHaveBeenCalledWith({
      where: { membershipId: 'member_1', lastReadSequence: 7n },
      data: { lastReadSequence: 8n },
    })

    mockPrisma.roomReadState.updateMany.mockResolvedValue({ count: 0 })
    const unread = await sendRoomTextMessage({
      roomId: 'room_1', authorMembershipId: 'member_1', clientMessageId: 'client_9', text: 'hi again',
    })
    expect(unread.authorReadAdvanced).toBe(false)
    expect(mockPrisma.roomReadState.create).not.toHaveBeenCalled()
  })

  it('does not touch any watermark for Agent-authored messages', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'agent_1',
      roomId: 'room_1',
      status: 'active',
      principalType: 'agent',
      ownerUserId: 'user_1',
      displayAlias: 'Agent',
      room: { status: 'active' },
      ownerUser: { id: 'user_1', name: '李辰', avatarVersion: null, avatarUpdatedAt: null },
      agentIdentity: null,
    })

    const result = await sendRoomTextMessage({
      roomId: 'room_1', authorMembershipId: 'agent_1', clientMessageId: 'client_a', text: 'done',
    })

    expect(result.authorReadAdvanced).toBe(false)
    expect(mockPrisma.roomReadState.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.roomReadState.create).not.toHaveBeenCalled()
  })

  it('returns an existing message without allocating another sequence', async () => {
    mockPrisma.roomMessage.findUnique.mockResolvedValue({ id: 'message_existing', sequence: 4n })

    const result = await sendRoomTextMessage({
      roomId: 'room_1',
      authorMembershipId: 'member_1',
      clientMessageId: 'client_1',
      text: 'hello',
    })

    expect(result).toMatchObject({ idempotent: true, message: { id: 'message_existing' } })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('stores only exact active Membership mentions without expanding a human to their Agents', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_sender',
      roomId: 'room_1',
      status: 'active',
      principalType: 'human',
      ownerUserId: 'user_sender',
      displayAlias: '发送者',
      room: { status: 'active' },
      ownerUser: {
        id: 'user_sender',
        name: '发送者',
        avatarVersion: null,
        avatarUpdatedAt: null,
      },
    })
    mockPrisma.roomMembership.findMany.mockResolvedValue([
      { id: 'human_2', principalType: 'human', displayAlias: '张三' },
      { id: 'agent_2', principalType: 'agent', displayAlias: '服务端开发' },
    ])

    await sendRoomTextMessage({
      roomId: 'room_1',
      authorMembershipId: 'member_sender',
      clientMessageId: 'client_mentions',
      text: '@张三 @服务端开发 请看一下',
      mentionMembershipIds: ['human_2', 'agent_2', 'human_2'],
    })

    expect(mockPrisma.roomMembership.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['human_2', 'agent_2'] },
        roomId: 'room_1',
        status: 'active',
      },
      select: { id: true, principalType: true, displayAlias: true },
    })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mentionSnapshots: [
            { membershipId: 'human_2', principalType: 'human', displayName: '张三' },
            { membershipId: 'agent_2', principalType: 'agent', displayName: '服务端开发' },
          ],
        }),
      }),
    )
  })

  it('atomically commits ready owned attachments into an attachment-only message', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_1',
      roomId: 'room_1',
      status: 'active',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: '李辰',
      room: { status: 'active' },
      ownerUser: { id: 'user_1', name: '李辰', avatarVersion: null, avatarUpdatedAt: null },
    })
    mockPrisma.roomAttachment.findMany.mockResolvedValue([
      {
        id: 'attachment_1',
        roomId: 'room_1',
        uploaderMembershipId: 'member_1',
        status: 'ready',
        messageId: null,
        expiresAt: new Date('2099-01-01'),
      },
    ])
    mockPrisma.roomAttachment.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomMessage.create.mockResolvedValue({
      id: 'message_1',
      sequence: 1n,
      attachments: [],
    })
    await expect(
      sendRoomTextMessage({
        roomId: 'room_1',
        authorMembershipId: 'member_1',
        clientMessageId: 'client_attachment',
        text: '',
        attachmentIds: ['attachment_1'],
      }),
    ).resolves.toMatchObject({ message: { id: 'message_1' }, idempotent: false })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'attachment', text: null }),
      }),
    )
    expect(mockPrisma.roomAttachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ messageId: null, status: 'ready' }),
        data: { messageId: 'message_1' },
      }),
    )
  })

  it('rejects a mention outside the active Room membership set', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_sender',
      roomId: 'room_1',
      status: 'active',
      principalType: 'human',
      ownerUserId: 'user_sender',
      displayAlias: '发送者',
      room: { status: 'active' },
      ownerUser: { id: 'user_sender', name: '发送者' },
    })
    mockPrisma.roomMembership.findMany.mockResolvedValue([])

    await expect(
      sendRoomTextMessage({
        roomId: 'room_1',
        authorMembershipId: 'member_sender',
        clientMessageId: 'client_invalid_mention',
        text: '@未知成员',
        mentionMembershipIds: ['member_other_room'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_room_mention' })
    expect(mockPrisma.room.update).not.toHaveBeenCalled()
  })

  it('rejects an invisible structured mention that is absent from message text', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_sender',
      roomId: 'room_1',
      status: 'active',
      principalType: 'human',
      ownerUserId: 'user_sender',
      displayAlias: '发送者',
      room: { status: 'active' },
      ownerUser: { id: 'user_sender', name: '发送者' },
    })
    mockPrisma.roomMembership.findMany.mockResolvedValue([
      { id: 'agent_hidden', principalType: 'agent', displayAlias: '隐藏 Agent' },
    ])

    await expect(
      sendRoomTextMessage({
        roomId: 'room_1',
        authorMembershipId: 'member_sender',
        clientMessageId: 'client_hidden_mention',
        text: '请处理一下',
        mentionMembershipIds: ['agent_hidden'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_room_mention' })
    expect(mockPrisma.room.update).not.toHaveBeenCalled()
  })

  it('requires a confirmed display alias before the first Room message', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'member_1',
      roomId: 'room_1',
      status: 'active',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: ' ',
      room: { status: 'active' },
    })

    await expect(
      sendRoomTextMessage({
        roomId: 'room_1',
        authorMembershipId: 'member_1',
        clientMessageId: 'client_1',
        text: 'hello',
      }),
    ).rejects.toMatchObject({ code: 'profile_name_required' })
    expect(mockPrisma.room.update).not.toHaveBeenCalled()
  })

  it('recovers a concurrent duplicate using the database uniqueness result', async () => {
    mockPrisma.roomMessage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'message_winner', sequence: 5n })
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2002' })

    await expect(
      sendRoomTextMessage({
        roomId: 'room_1',
        authorMembershipId: 'member_1',
        clientMessageId: 'client_1',
        text: 'hello',
      }),
    ).resolves.toMatchObject({ idempotent: true, message: { id: 'message_winner' } })
  })

  it('removes a human, all child Agents, and their bindings in one transaction', async () => {
    mockPrisma.roomMembership.findUnique
      .mockResolvedValueOnce({
        id: 'member_owner',
        roomId: 'room_1',
        status: 'active',
        role: 'owner',
        principalType: 'human',
        ownerUserId: 'owner_1',
        displayAlias: 'Owner',
      })
      .mockResolvedValueOnce({
        id: 'member_user',
        roomId: 'room_1',
        status: 'active',
        role: 'member',
        principalType: 'human',
        ownerUserId: 'user_2',
        displayAlias: 'Member',
        membershipEpoch: 1,
      })
    mockPrisma.roomMembership.findMany.mockResolvedValue([
      {
        id: 'member_agent_1',
        principalType: 'agent',
        ownerUserId: 'user_2',
        displayAlias: 'Agent One',
        membershipEpoch: 1,
        binding: { nianSessionId: 'session_1', userId: 'user_2' },
      },
      {
        id: 'member_agent_2',
        principalType: 'agent',
        ownerUserId: 'user_2',
        displayAlias: 'Agent Two',
        membershipEpoch: 1,
        binding: null,
      },
    ])
    mockPrisma.roomMembership.updateMany.mockResolvedValue({ count: 3 })
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 2 })

    const result = await removeRoomMembership({
      roomId: 'room_1',
      actorMembershipId: 'member_owner',
      targetMembershipId: 'member_user',
    })

    expect(result).toEqual({
      removedMembershipIds: ['member_user', 'member_agent_1', 'member_agent_2'],
      removedHumanUserIds: ['user_2'],
      detachedBindingCount: 2,
      committedSessionDeletions: [{ sessionId: 'session_1', userId: 'user_2' }],
      messages: [
        { id: 'message_1', sequence: 1n },
        { id: 'message_1', sequence: 1n },
        { id: 'message_1', sequence: 1n },
      ],
      idempotent: false,
    })
    expect(mockPrisma.roomMembership.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['member_user', 'member_agent_1', 'member_agent_2'] },
        status: 'active',
      },
      data: { status: 'removed', removedAt: expect.any(Date), historyThroughSequence: 1n },
    })
    expect(mockPrisma.roomMembership.findMany).toHaveBeenCalledWith({
      where: {
        roomId: 'room_1',
        parentHumanMembershipId: 'member_user',
        status: 'active',
      },
      select: {
        id: true,
        principalType: true,
        ownerUserId: true,
        displayAlias: true,
        membershipEpoch: true,
        binding: { select: { nianSessionId: true, userId: true } },
      },
    })
    expect(mockPrisma.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { agentMembershipId: { in: ['member_user', 'member_agent_1', 'member_agent_2'] } },
      data: { status: 'detached', activationMode: 'paused' },
    })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledTimes(3)
    expect(mockPrisma.roomMessage.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'system',
          text: 'Agent One was removed from the Room.',
          clientMessageId: 'system:membership-removed:member_agent_1:1',
        }),
      }),
    )
  })

  it('removes only the selected Agent without touching its human or sibling Agents', async () => {
    mockPrisma.roomMembership.findUnique
      .mockResolvedValueOnce({
        id: 'member_owner',
        roomId: 'room_1',
        status: 'active',
        role: 'owner',
        principalType: 'human',
        ownerUserId: 'owner_1',
        displayAlias: 'Owner',
      })
      .mockResolvedValueOnce({
        id: 'member_agent_1',
        roomId: 'room_1',
        status: 'active',
        role: 'member',
        principalType: 'agent',
        ownerUserId: 'user_2',
        parentHumanMembershipId: 'member_user',
        displayAlias: 'Agent One',
        membershipEpoch: 1,
      })
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      nianSessionId: 'session_agent_1',
      userId: 'user_2',
    })

    await expect(
      removeRoomMembership({
        roomId: 'room_1',
        actorMembershipId: 'member_owner',
        targetMembershipId: 'member_agent_1',
      }),
    ).resolves.toEqual({
      removedMembershipIds: ['member_agent_1'],
      removedHumanUserIds: [],
      detachedBindingCount: 1,
      committedSessionDeletions: [{ sessionId: 'session_agent_1', userId: 'user_2' }],
      messages: [{ id: 'message_1', sequence: 1n }],
      idempotent: false,
    })

    expect(mockPrisma.roomMembership.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.roomMembership.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['member_agent_1'] }, status: 'active' },
      data: { status: 'removed', removedAt: expect.any(Date), historyThroughSequence: 1n },
    })
    expect(mockPrisma.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { agentMembershipId: { in: ['member_agent_1'] } },
      data: { status: 'detached', activationMode: 'paused' },
    })
  })

  it('never removes the active owner', async () => {
    const owner = {
      id: 'member_owner',
      roomId: 'room_1',
      status: 'active',
      role: 'owner',
      principalType: 'human',
      ownerUserId: 'owner_1',
      displayAlias: 'Owner',
      membershipEpoch: 1,
    }
    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)

    await expect(
      removeRoomMembership({
        roomId: 'room_1',
        actorMembershipId: 'member_owner',
        targetMembershipId: 'member_owner',
      }),
    ).rejects.toMatchObject({ code: 'membership_remove_forbidden' })
    expect(mockPrisma.roomMembership.updateMany).not.toHaveBeenCalled()
  })

  it('rejects member removal when its listed version is stale', async () => {
    mockPrisma.roomMembership.findUnique
      .mockResolvedValueOnce({
        id: 'member_owner', roomId: 'room_1', status: 'active', role: 'owner',
        principalType: 'human', ownerUserId: 'owner_1', displayAlias: 'Owner',
      })
      .mockResolvedValueOnce({
        id: 'member_user', roomId: 'room_1', status: 'active', role: 'member',
        principalType: 'human', ownerUserId: 'user_2', displayAlias: 'Member', membershipEpoch: 3,
      })

    await expect(removeRoomMembership({
      roomId: 'room_1',
      actorMembershipId: 'member_owner',
      targetMembershipId: 'member_user',
      expectedTargetVersion: 2,
    })).rejects.toMatchObject({ code: 'room_member_version_conflict' })
    expect(mockPrisma.roomMembership.updateMany).not.toHaveBeenCalled()
  })

  it('archives a dissolved Room, detaches bindings, and returns exact cleanup targets', async () => {
    const now = new Date('2026-08-25T00:30:00.000Z')
    mockPrisma.room.findUnique.mockResolvedValue({
      id: 'room_1',
      status: 'active',
      createdByUserId: 'owner_1',
      ownerUserId: 'owner_1',
    })
    mockPrisma.room.update.mockResolvedValue({ id: 'room_1', status: 'archived' })
    mockPrisma.roomBinding.findMany.mockResolvedValue([
      { nianSessionId: 'session_1', userId: 'user_1' },
    ])

    await expect(dissolveRoom({ roomId: 'room_1', actorUserId: 'owner_1', now })).resolves.toEqual({
      roomId: 'room_1',
      status: 'archived',
      committedSessionDeletions: [{ sessionId: 'session_1', userId: 'user_1' }],
      idempotent: false,
    })

    expect(mockPrisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room_1' },
      data: { status: 'archived', joinPolicy: 'closed', archivedAt: now },
    })
    expect(mockPrisma.roomInvite.updateMany).toHaveBeenCalledWith({
      where: { roomId: 'room_1', status: 'active' },
      data: { status: 'revoked', revokedAt: now },
    })
    expect(mockPrisma.roomJoinRequest.updateMany).toHaveBeenCalledWith({
      where: { roomId: 'room_1', status: 'pending' },
      data: { status: 'cancelled', pendingKey: null, reviewedAt: now },
    })
    expect(mockPrisma.roomMembership.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.roomBinding.updateMany).toHaveBeenCalledWith({
      where: {
        roomId: 'room_1',
        status: { in: ['pending_approval', 'active', 'paused'] },
      },
      data: { status: 'detached', activationMode: 'paused' },
    })
  })

  it('replays cleanup targets idempotently when a dissolved Room request is retried', async () => {
    mockPrisma.room.findUnique.mockResolvedValue({
      id: 'room_1',
      status: 'archived',
      createdByUserId: 'owner_1',
      ownerUserId: 'owner_1',
    })
    mockPrisma.roomBinding.findMany.mockResolvedValue([
      { nianSessionId: 'session_pending_cleanup', userId: 'user_2' },
    ])

    await expect(
      dissolveRoom({ roomId: 'room_1', actorUserId: 'owner_1' }),
    ).resolves.toEqual({
      roomId: 'room_1',
      status: 'archived',
      committedSessionDeletions: [
        { sessionId: 'session_pending_cleanup', userId: 'user_2' },
      ],
      idempotent: true,
    })
    expect(mockPrisma.room.update).not.toHaveBeenCalled()
    expect(mockPrisma.roomBinding.updateMany).not.toHaveBeenCalled()
  })
})

describe('Room input normalization', () => {
  it('keeps user-facing names short and meaningful', () => {
    expect(normalizeRoomName('  项目空间  ')).toBe('项目空间')
    expect(() => normalizeRoomName(' ')).toThrow(/required/)
    expect(() => normalizeRoomName('undefined')).toThrow(/invalid/)
    expect(() => normalizeRoomName(' NULL ')).toThrow(/invalid/)
    expect(() => normalizeRoomName('x'.repeat(81))).toThrow(/too long/)
  })

  it('accepts only the explicit visibility and join-policy matrix', () => {
    expect(normalizeRoomAccess({})).toEqual({ visibility: 'private', joinPolicy: 'open' })
    expect(normalizeRoomAccess({ visibility: 'public_read', joinPolicy: 'open' })).toEqual({
      visibility: 'public_read',
      joinPolicy: 'open',
    })
    expect(() => normalizeRoomAccess({ visibility: 'public' })).toThrow(/visibility/)
    expect(() => normalizeRoomAccess({ joinPolicy: 'anyone' })).toThrow(/join policy/)
  })
})
