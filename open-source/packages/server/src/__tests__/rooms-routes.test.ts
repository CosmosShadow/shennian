// @covers open-source/packages/server/src/routes/rooms.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const now = new Date('2026-08-23T00:00:00.000Z')

const {
  mockPrisma,
  mockCreateRoom,
  mockUpdateRoomSettings,
  mockDissolveRoom,
  mockCreateBinding,
  mockRestartBinding,
  mockSendMessage,
  mockInitializeAttachment,
  mockCompleteAttachment,
  mockDownloadAttachment,
  mockRemoveMembership,
  mockDeleteSession,
  mockCleanupRoomSessions,
  mockCreateInvite,
  mockGetCanonicalInvite,
  mockResetCanonicalInvite,
  mockCancelJoinRequest,
  mockRevokeInvite,
  mockReviewJoinRequest,
  mockLeaveRoom,
  mockDeleteRoomRecord,
  mockListBrowserSessions,
  mockRevokeBrowserSession,
  mockCloseBrowserSessionSockets,
  mockCloseRoomBrowserSockets,
  mockPublishRoomBrowserSessionRevoked,
  mockConnections,
  mockPubsub,
  mockAdvanceRoomReadState,
} = vi.hoisted(() => ({
  mockPrisma: {
    device: { findUnique: vi.fn() },
    machine: { findUnique: vi.fn() },
    roomMembership: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    roomBinding: { findFirst: vi.fn(), findMany: vi.fn() },
    room: { findUnique: vi.fn() },
    roomMessage: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    roomReadState: { upsert: vi.fn() },
    roomInvite: { findMany: vi.fn() },
    roomJoinRequest: { findMany: vi.fn() },
  },
  mockCreateRoom: vi.fn(),
  mockUpdateRoomSettings: vi.fn(),
  mockDissolveRoom: vi.fn(),
  mockCreateBinding: vi.fn(),
  mockRestartBinding: vi.fn(),
  mockSendMessage: vi.fn(),
  mockInitializeAttachment: vi.fn(),
  mockCompleteAttachment: vi.fn(),
  mockDownloadAttachment: vi.fn(),
  mockRemoveMembership: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockCleanupRoomSessions: vi.fn(),
  mockCreateInvite: vi.fn(),
  mockGetCanonicalInvite: vi.fn(),
  mockResetCanonicalInvite: vi.fn(),
  mockCancelJoinRequest: vi.fn(),
  mockRevokeInvite: vi.fn(),
  mockReviewJoinRequest: vi.fn(),
  mockLeaveRoom: vi.fn(),
  mockDeleteRoomRecord: vi.fn(),
  mockListBrowserSessions: vi.fn(),
  mockRevokeBrowserSession: vi.fn(),
  mockCloseBrowserSessionSockets: vi.fn(),
  mockCloseRoomBrowserSockets: vi.fn(),
  mockPublishRoomBrowserSessionRevoked: vi.fn(),
  mockConnections: { broadcastToClientsOfUser: vi.fn() },
  mockPubsub: { isActive: false, publishToUser: vi.fn() },
  mockAdvanceRoomReadState: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/room-read-state.js', () => ({
  advanceRoomReadState: mockAdvanceRoomReadState,
}))
vi.mock('../services/room-core.js', async () => {
  const actual = await vi.importActual<typeof import('../services/room-core.js')>(
    '../services/room-core.js',
  )
  return {
    ...actual,
    createRoomWithOwner: mockCreateRoom,
    updateRoomSettings: mockUpdateRoomSettings,
    dissolveRoom: mockDissolveRoom,
    sendRoomTextMessage: mockSendMessage,
    removeRoomMembership: mockRemoveMembership,
  }
})
vi.mock('../services/room-binding.js', () => ({
  createRoomBindingAtomic: mockCreateBinding,
  restartRoomBindingSession: mockRestartBinding,
}))
vi.mock('../services/sessions.js', () => ({ deleteSessionForUser: mockDeleteSession }))
vi.mock('../services/room-session-cleanup.js', () => ({
  finalizeExclusiveRoomSessionDeletions: mockCleanupRoomSessions,
}))
vi.mock('../services/room-attachments.js', () => ({
  initializeRoomAttachment: mockInitializeAttachment,
  completeRoomAttachment: mockCompleteAttachment,
  getRoomAttachmentDownload: mockDownloadAttachment,
}))
vi.mock('../services/room-membership.js', () => ({
  cancelRoomJoinRequest: mockCancelJoinRequest,
  createRoomInvite: mockCreateInvite,
  getCanonicalRoomInvite: mockGetCanonicalInvite,
  resetCanonicalRoomInvite: mockResetCanonicalInvite,
  revokeRoomInvite: mockRevokeInvite,
  reviewRoomJoinRequest: mockReviewJoinRequest,
  leaveRoom: mockLeaveRoom,
  deleteRoomRecord: mockDeleteRoomRecord,
}))
vi.mock('../services/room-browser-session.js', () => ({
  listRoomBrowserSessionsForUser: mockListBrowserSessions,
  revokeRoomBrowserSessionForUser: mockRevokeBrowserSession,
}))
vi.mock('../services/room-browser-events.js', async () => {
  const actual = await vi.importActual<typeof import('../services/room-browser-events.js')>(
    '../services/room-browser-events.js',
  )
  return {
    ...actual,
    closeRoomBrowserSessionSockets: mockCloseBrowserSessionSockets,
    closeRoomBrowserSockets: mockCloseRoomBrowserSockets,
  }
})
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) =>
    token === 'user-token' ? { userId: 'user_1', deviceId: 'device_1' } : null,
  ),
  verifyMachineToken: vi.fn((token: string) =>
    token === 'machine-token' ? { machineId: 'machine_1', type: 'machine' } : null,
  ),
}))
vi.mock('../relay/connections.js', () => ({ connections: mockConnections }))
vi.mock('../relay/pubsub.js', () => ({ pubsub: mockPubsub }))
vi.mock('../relay/connection-control.js', () => ({
  publishRoomBrowserSessionRevoked: mockPublishRoomBrowserSessionRevoked,
}))

import { roomRoutes } from '../routes/rooms.js'

const ROOM = {
  id: 'room_1',
  name: '项目空间',
  description: '',
  status: 'active',
  visibility: 'private',
  joinPolicy: 'approval',
  nextSequence: 4n,
  maxHumanMembers: 100,
  maxAgentsPerUser: 1,
  maxAgentsPerRoom: 20,
  maxAutoFollowAgents: 3,
  updatedAt: now,
}

const MEMBERSHIP = {
  id: 'member_1',
  roomId: 'room_1',
  userId: 'user_1',
  principalType: 'human',
  status: 'active',
  role: 'owner',
  historyFromSequence: 2n,
  room: ROOM,
}

const MESSAGE = {
  id: 'message_1',
  roomId: 'room_1',
  sequence: 4n,
  authorMembershipId: 'member_1',
  authorPrincipalTypeSnapshot: 'human',
  ownerUserIdSnapshot: 'user_1',
  authorDisplayNameSnapshot: '李辰',
  ownerDisplayNameSnapshot: '李辰',
  authorAvatarSnapshot: null,
  mentionSnapshots: [{ membershipId: 'agent_1', principalType: 'agent', displayName: '服务端' }],
  kind: 'text',
  text: 'hello',
  replyToMessageId: null,
  createdAt: now,
  editedAt: null,
  deletedAt: null,
  attachments: [],
}

describe('Room REST routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPubsub.isActive = false
    mockPrisma.device.findUnique.mockResolvedValue({
      id: 'device_1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mockPrisma.machine.findUnique.mockResolvedValue({ id: 'machine_1', userId: 'user_1' })
    mockPrisma.roomMembership.findUnique.mockResolvedValue(MEMBERSHIP)
    mockPrisma.room.findUnique.mockResolvedValue(null)
    mockPrisma.roomMembership.findMany.mockResolvedValue([{ ownerUserId: 'user_1' }])
    mockPrisma.roomBinding.findMany.mockResolvedValue([])
    mockPrisma.roomBinding.findFirst.mockResolvedValue(null)
    mockPrisma.roomMessage.findMany.mockResolvedValue([])
    mockPrisma.roomMessage.count.mockResolvedValue(0)
    mockPrisma.roomReadState.upsert.mockResolvedValue({ lastReadSequence: 4n })
    mockAdvanceRoomReadState.mockResolvedValue({ lastReadSequence: 4n, advanced: true })
    mockPrisma.roomInvite.findMany.mockResolvedValue([])
    mockPrisma.roomJoinRequest.findMany.mockResolvedValue([])
    mockCancelJoinRequest.mockResolvedValue({
      request: { id: 'request_1', status: 'cancelled' },
      idempotent: false,
    })
    mockCreateRoom.mockResolvedValue({
      room: { ...ROOM, nextSequence: 0n },
      membership: MEMBERSHIP,
    })
    mockUpdateRoomSettings.mockResolvedValue({
      room: {
        ...ROOM,
        name: '新名称',
        visibility: 'public_read',
        joinPolicy: 'open',
        nextSequence: 4n,
      },
      message: null,
      idempotent: false,
    })
    mockCreateBinding.mockResolvedValue({
      binding: {
        id: 'binding_1',
        roomId: 'room_1',
        agentIdentityId: 'agent_1',
        agentMembershipId: 'agent_member_1',
        nianSessionId: 'nian_1',
        runtimeAdapter: 'codex',
        activationCapability: 'idle_resume',
        activationMode: 'auto_follow',
        status: 'active',
      },
      message: { ...MESSAGE, id: 'agent_joined', kind: 'system', text: 'Agent joined the Room.' },
      resumeSequence: '4',
      idempotent: false,
    })
    mockRestartBinding.mockResolvedValue({
      binding: {
        id: 'binding_1',
        roomId: 'room_1',
        agentIdentityId: 'agent_1',
        agentMembershipId: 'agent_member_1',
        nianSessionId: 'nian_2',
        runtimeAdapter: 'codex',
        activationCapability: 'managed',
        activationMode: 'mention_only',
        status: 'active',
      },
      resumeSequence: '4',
      committedSessionDeletions: [{ sessionId: 'nian_1', userId: 'user_1' }],
      idempotent: false,
    })
    mockSendMessage.mockResolvedValue({ message: MESSAGE, idempotent: false })
    mockInitializeAttachment.mockResolvedValue({
      attachment: {
        id: 'attachment_1',
        roomId: 'room_1',
        name: 'note.txt',
        mimeType: 'text/plain',
        byteSize: '5',
        sha256: 'a'.repeat(64),
        status: 'pending',
      },
      upload: {
        method: 'PUT',
        url: 'https://private-oss.example/upload?signature=short',
        headers: { 'content-type': 'text/plain', 'x-oss-meta-sha256': 'a'.repeat(64) },
        expiresAt: '2026-08-23T00:05:00.000Z',
      },
      idempotent: false,
    })
    mockCompleteAttachment.mockResolvedValue({
      attachment: {
        id: 'attachment_1',
        mediaKind: 'file',
        safeName: 'note.txt',
        mimeType: 'text/plain',
        byteSize: 5n,
        sha256: 'a'.repeat(64),
        status: 'ready',
      },
      idempotent: false,
    })
    mockDownloadAttachment.mockResolvedValue({
      attachmentId: 'attachment_1',
      name: 'note.txt',
      mimeType: 'text/plain',
      byteSize: '5',
      sha256: 'a'.repeat(64),
      downloadUrl: 'https://private-oss.example/download?signature=short',
      expiresAt: '2026-08-23T00:01:00.000Z',
    })
    mockRemoveMembership.mockResolvedValue({
      removedMembershipIds: ['member_2'],
      detachedBindingCount: 1,
      committedSessionDeletions: [],
      messages: [],
      idempotent: false,
    })
    mockCreateInvite.mockResolvedValue({
      invite: {
        id: 'invite_1',
        roomId: 'room_1',
        status: 'active',
        expiresAt: new Date('2026-08-30T00:00:00.000Z'),
        maxUses: 20,
        useCount: 0,
      },
      rawToken: 't'.repeat(43),
    })
    mockGetCanonicalInvite.mockResolvedValue({
      invite: { id: 'invite_canonical_1', status: 'active', createdAt: now },
      rawToken: 'c'.repeat(43),
      version: 1,
    })
    mockResetCanonicalInvite.mockResolvedValue({
      invite: {
        id: 'invite_canonical_2',
        status: 'active',
        createdAt: new Date('2026-08-23T00:01:00.000Z'),
      },
      rawToken: 'd'.repeat(43),
      version: 2,
    })
    mockDissolveRoom.mockResolvedValue({
      roomId: 'room_1',
      status: 'archived',
      committedSessionDeletions: [],
    })
    mockRevokeInvite.mockResolvedValue({
      invite: { id: 'invite_1', status: 'revoked' },
      idempotent: false,
    })
    mockReviewJoinRequest.mockResolvedValue({
      outcome: 'approved',
      membership: { id: 'member_2' },
      idempotent: false,
    })
    mockLeaveRoom.mockResolvedValue({
      leftMembershipIds: ['member_1'],
      detachedBindingCount: 1,
      committedSessionDeletions: [],
      messages: [],
      idempotent: false,
    })
    mockListBrowserSessions.mockResolvedValue([])
    mockRevokeBrowserSession.mockResolvedValue(null)
    app = Fastify()
    await app.register(roomRoutes, { prefix: '/rooms' })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('creates a safe private approval Room by default', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms',
      headers: { authorization: 'Bearer user-token' },
      payload: { name: '项目空间' },
    })

    expect(response.statusCode).toBe(201)
    expect(mockCreateRoom).toHaveBeenCalledWith({
      userId: 'user_1',
      name: '项目空间',
      visibility: undefined,
      joinPolicy: undefined,
    })
    expect(response.json()).toMatchObject({
      room: { id: 'room_1', visibility: 'private', joinPolicy: 'approval', lastSequence: '0' },
      membershipId: 'member_1',
    })
  })

  it('lists each Room with a binary membership-scoped unread indicator', async () => {
    mockPrisma.roomMembership.findMany.mockResolvedValueOnce([
      {
        status: 'active',
        historyFromSequence: 1n,
        role: 'owner',
        pinnedAt: now,
        readState: { lastReadSequence: 1n },
        room: {
          ...ROOM,
          memberships: [
            {
              id: 'human_1',
              principalType: 'human',
              displayAlias: '用户',
              joinedAt: new Date('2026-08-01T00:00:00.000Z'),
              user: null,
              ownerUser: null,
              agentIdentity: null,
            },
            {
              id: 'agent_1',
              principalType: 'agent',
              displayAlias: '助手',
              joinedAt: new Date('2026-08-02T00:00:00.000Z'),
              user: null,
              ownerUser: null,
              agentIdentity: null,
            },
          ],
          messages: [],
        },
      },
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/rooms',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().rooms[0]).toMatchObject({
      id: 'room_1',
      humanCount: 1,
      agentCount: 1,
      lastSequence: '4',
      historyFromSequence: '1',
      lastReadSequence: '1',
      unreadCount: 1,
      membershipRole: 'owner',
      membershipStatus: 'active',
      pinnedAt: now.toISOString(),
      latestMessage: null,
      avatarMembers: [{ id: 'human_1', joinedAt: '2026-08-01T00:00:00.000Z' }],
    })
    expect(mockPrisma.roomMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          readState: true,
          room: expect.objectContaining({
            include: expect.objectContaining({
              memberships: expect.objectContaining({
                orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
              }),
            }),
          }),
        }),
      }),
    )
    expect(mockPrisma.roomMessage.count).not.toHaveBeenCalled()
  })

  it('keeps an active Room in the inventory after its visible history is cleared', async () => {
    mockPrisma.roomMembership.findMany.mockResolvedValueOnce([
      {
        status: 'active',
        historyFromSequence: 5n,
        role: 'member',
        pinnedAt: now,
        readState: { lastReadSequence: 4n },
        room: { ...ROOM, memberships: [], messages: [] },
      },
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/rooms',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().rooms).toEqual([
      expect.objectContaining({
        id: 'room_1',
        membershipStatus: 'active',
        historyFromSequence: '5',
        latestMessage: null,
        pinnedAt: now.toISOString(),
      }),
    ])
  })

  it('selects the earliest four humans without letting agents consume avatar slots', async () => {
    const humans = Array.from({ length: 5 }, (_, index) => ({
      id: `human_${index}`,
      principalType: 'human',
      displayAlias: `User ${index}`,
      joinedAt: new Date(`2026-08-0${index + 1}T00:00:00.000Z`),
      user: null,
    }))
    const agents = Array.from({ length: 4 }, (_, index) => ({
      id: `agent_${index}`,
      principalType: 'agent',
      displayAlias: 'Agent',
      joinedAt: now,
      user: null,
      ownerUser: null,
      agentIdentity: null,
    }))
    mockPrisma.roomMembership.findMany.mockResolvedValueOnce([
      {
        status: 'active',
        historyFromSequence: 1n,
        role: 'member',
        pinnedAt: null,
        readState: null,
        room: { ...ROOM, memberships: [...agents, ...humans], messages: [] },
      },
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/rooms',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(response.statusCode).toBe(200)
    const room = response.json().rooms[0]
    expect(room.avatarMembers.map((member: { id: string }) => member.id)).toEqual(
      humans.slice(0, 4).map((member) => member.id),
    )
    expect(room).toMatchObject({ humanCount: 5, agentCount: 4 })
  })

  it('shows the other participant\'s avatar instead of our own in a direct chat', async () => {
    mockPrisma.roomMembership.findMany.mockResolvedValueOnce([
      {
        status: 'active',
        historyFromSequence: 1n,
        role: 'member',
        pinnedAt: null,
        readState: null,
        room: {
          ...ROOM,
          memberships: [
            {
              id: 'member_self',
              principalType: 'human',
              displayAlias: 'Me',
              joinedAt: new Date('2026-08-01T00:00:00.000Z'),
              user: { id: 'user_1', avatarVersion: 1, avatarUpdatedAt: now },
            },
            {
              id: 'member_other',
              principalType: 'human',
              displayAlias: 'Chenge',
              joinedAt: new Date('2026-08-02T00:00:00.000Z'),
              user: { id: 'user_2', avatarVersion: 1, avatarUpdatedAt: now },
            },
          ],
          messages: [],
        },
      },
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/rooms',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(response.statusCode).toBe(200)
    const room = response.json().rooms[0]
    expect(room.avatarMembers.map((member: { id: string }) => member.id)).toEqual(['member_other'])
  })

  it('includes our own avatar alongside others in a group chat with 3+ humans', async () => {
    mockPrisma.roomMembership.findMany.mockResolvedValueOnce([
      {
        status: 'active',
        historyFromSequence: 1n,
        role: 'member',
        pinnedAt: null,
        readState: null,
        room: {
          ...ROOM,
          memberships: [
            {
              id: 'member_self',
              principalType: 'human',
              displayAlias: 'Me',
              joinedAt: new Date('2026-08-01T00:00:00.000Z'),
              user: { id: 'user_1', avatarVersion: 1, avatarUpdatedAt: now },
            },
            {
              id: 'member_other_1',
              principalType: 'human',
              displayAlias: 'Chenge',
              joinedAt: new Date('2026-08-02T00:00:00.000Z'),
              user: { id: 'user_2', avatarVersion: 1, avatarUpdatedAt: now },
            },
            {
              id: 'member_other_2',
              principalType: 'human',
              displayAlias: 'Biao',
              joinedAt: new Date('2026-08-03T00:00:00.000Z'),
              user: { id: 'user_3', avatarVersion: 1, avatarUpdatedAt: now },
            },
          ],
          messages: [],
        },
      },
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/rooms',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(response.statusCode).toBe(200)
    const room = response.json().rooms[0]
    expect(room.avatarMembers.map((member: { id: string }) => member.id)).toEqual([
      'member_self',
      'member_other_1',
      'member_other_2',
    ])
  })

  it('falls back to our own avatar when we are the only human in the Room', async () => {
    mockPrisma.roomMembership.findMany.mockResolvedValueOnce([
      {
        status: 'active',
        historyFromSequence: 1n,
        role: 'member',
        pinnedAt: null,
        readState: null,
        room: {
          ...ROOM,
          memberships: [
            {
              id: 'member_self',
              principalType: 'human',
              displayAlias: 'Me',
              joinedAt: new Date('2026-08-01T00:00:00.000Z'),
              user: { id: 'user_1', avatarVersion: 1, avatarUpdatedAt: now },
            },
          ],
          messages: [],
        },
      },
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/rooms',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(response.statusCode).toBe(200)
    const room = response.json().rooms[0]
    expect(room.avatarMembers.map((member: { id: string }) => member.id)).toEqual(['member_self'])
  })

  it('stores Room pinning on the authenticated human membership', async () => {
    mockPrisma.roomMembership.update.mockResolvedValue({ pinnedAt: now, muteRegularNotifications: false, muteMentionNotifications: false })
    const response = await app.inject({
      method: 'PATCH',
      url: '/rooms/room_1/preferences',
      headers: { authorization: 'Bearer user-token' },
      payload: { pinned: true },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().pinnedAt).toEqual(expect.any(String))
    expect(mockPrisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 'member_1' },
      data: { pinnedAt: expect.any(Date) },
      select: { pinnedAt: true, muteRegularNotifications: true, muteMentionNotifications: true },
    })
  })

  it('stores account-scoped Room notification preferences without changing pinning', async () => {
    mockPrisma.roomMembership.update.mockResolvedValue({ pinnedAt: null, muteRegularNotifications: true, muteMentionNotifications: false })
    const response = await app.inject({
      method: 'PATCH', url: '/rooms/room_1/preferences',
      headers: { authorization: 'Bearer user-token' }, payload: { muteRegularNotifications: true },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ muteRegularNotifications: true, muteMentionNotifications: false })
    expect(mockPrisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 'member_1' }, data: { muteRegularNotifications: true },
      select: { pinnedAt: true, muteRegularNotifications: true, muteMentionNotifications: true },
    })
  })

  it('updates Room settings through the authenticated admin service and broadcasts the change', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/rooms/room_1',
      headers: { authorization: 'Bearer user-token' },
      payload: { name: '新名称', visibility: 'public_read', joinPolicy: 'open' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockUpdateRoomSettings).toHaveBeenCalledWith({
      roomId: 'room_1',
      actorUserId: 'user_1',
      name: '新名称',
      visibility: 'public_read',
      joinPolicy: 'open',
    })
    expect(response.json()).toMatchObject({
      room: { name: '新名称', visibility: 'public_read', joinPolicy: 'open', lastSequence: '4' },
      idempotent: false,
    })
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('room.updated'),
    )
    expect(mockConnections.broadcastToClientsOfUser).not.toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('room.message.created'),
    )
  })

  it('broadcasts a renamed-Room system message to all Room clients', async () => {
    const renamedMessage = {
      ...MESSAGE,
      kind: 'system',
      source: 'system',
      mentionSnapshots: [],
      text: '李辰 changed the group chat name to “新名称”.',
    }
    mockUpdateRoomSettings.mockResolvedValueOnce({
      room: { ...ROOM, name: '新名称', nextSequence: 4n },
      message: renamedMessage,
      idempotent: false,
    })

    const response = await app.inject({
      method: 'PATCH',
      url: '/rooms/room_1',
      headers: { authorization: 'Bearer user-token' },
      payload: { name: '新名称' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('room.message.created'),
    )
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('李辰 changed the group chat name to “新名称”.'),
    )
  })

  it('maps the owner-facing per-member Agent quota without exposing the internal column name', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/rooms/room_1',
      headers: { authorization: 'Bearer user-token' },
      payload: { maxAgentsPerMember: 5 },
    })

    expect(response.statusCode).toBe(200)
    expect(mockUpdateRoomSettings).toHaveBeenCalledWith(
      expect.objectContaining({ maxAgentsPerMember: 5 }),
    )
    expect(response.json().room.limits).toEqual({
      maxHumanMembers: 100,
      maxAgentsPerMember: 1,
      maxAgentsPerRoom: 20,
      maxAutoFollowAgents: 3,
    })
    expect(response.body).not.toContain('maxAgentsPerUser')
  })

  it('creates an exact Binding only with machine authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/bindings',
      headers: { authorization: 'Bearer machine-token' },
      payload: {
        bindingIntentId: 'room-bind:intent_1',
        agentIdentityId: 'agent_1',
        nianSessionId: 'nian_1',
        runtimeAdapter: 'codex',
        sessionRegistryKey: 'a'.repeat(64),
        activationCapability: 'idle_resume',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(mockCreateBinding).toHaveBeenCalledWith({
      bindingIntentId: 'room-bind:intent_1',
      roomId: 'room_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentIdentityId: 'agent_1',
      nianSessionId: 'nian_1',
      runtimeAdapter: 'codex',
      sessionRegistryKey: 'a'.repeat(64),
      activationCapability: 'idle_resume',
      activationMode: undefined,
    })
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('room.message.created'),
    )
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('Agent joined the Room.'),
    )
    expect(response.json()).not.toHaveProperty('sourceSessionKey')
  })

  it('deletes the previous dedicated Session only after an atomic Binding restart', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/rooms/room_1/bindings/binding_1/session',
      headers: { authorization: 'Bearer machine-token' },
      payload: {
        agentIdentityId: 'agent_1',
        previousNianSessionId: 'nian_1',
        nianSessionId: 'nian_2',
        runtimeAdapter: 'codex',
        sessionRegistryKey: 'b'.repeat(64),
      },
    })

    expect(response.statusCode).toBe(200)
    expect(mockRestartBinding).toHaveBeenCalledWith({
      roomId: 'room_1',
      bindingId: 'binding_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentIdentityId: 'agent_1',
      previousNianSessionId: 'nian_1',
      nianSessionId: 'nian_2',
      runtimeAdapter: 'codex',
      sessionRegistryKey: 'b'.repeat(64),
    })
    expect(mockCleanupRoomSessions).toHaveBeenCalledWith([
      { sessionId: 'nian_1', userId: 'user_1' },
    ])
    expect(response.json()).not.toHaveProperty('sessionCleanupTargets')
  })

  it('returns only the authenticated user binding for an exact NianSession', async () => {
    mockPrisma.roomBinding.findFirst.mockResolvedValueOnce({
      id: 'binding_1',
      status: 'active',
      activationMode: 'auto_follow',
      agentIdentity: { displayName: '服务端开发' },
      room: { id: 'room_1', name: '神念产品', status: 'active' },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/session/nian_1/binding',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      binding: {
        id: 'binding_1',
        status: 'active',
        activationMode: 'auto_follow',
        agentDisplayName: '服务端开发',
        room: { id: 'room_1', name: '神念产品', status: 'active' },
      },
    })
    expect(mockPrisma.roomBinding.findFirst).toHaveBeenCalledWith({
      where: { nianSessionId: 'nian_1', userId: 'user_1' },
      select: {
        id: true,
        status: true,
        activationMode: true,
        agentIdentity: { select: { displayName: true } },
        room: { select: { id: true, name: true, status: true } },
      },
    })
    expect(JSON.stringify(response.json())).not.toContain('sourceSessionKey')
  })

  it('does not reveal whether another user has a Binding for a NianSession', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/rooms/session/nian_other/binding',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ binding: null })
    expect(mockPrisma.roomBinding.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nianSessionId: 'nian_other', userId: 'user_1' },
      }),
    )
  })

  it('rejects a browser user token for native Session Binding', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/bindings',
      headers: { authorization: 'Bearer user-token' },
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'machine_auth_required' })
    expect(mockCreateBinding).not.toHaveBeenCalled()
  })

  it('never accepts an author membership id from the message body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/messages',
      headers: { authorization: 'Bearer user-token' },
      payload: {
        authorMembershipId: 'attacker_selected_membership',
        clientMessageId: 'client_1',
        text: 'hello',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(mockSendMessage).toHaveBeenCalledWith({
      roomId: 'room_1',
      authorMembershipId: 'member_1',
      clientMessageId: 'client_1',
      text: 'hello',
      mentionMembershipIds: undefined,
      replyToMessageId: undefined,
      attachmentIds: undefined,
    })
    expect(response.json().message.sequence).toBe('4')
    expect(response.json().message.mentions).toEqual([
      { membershipId: 'agent_1', principalType: 'agent', displayName: '服务端' },
    ])
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('room.message.created'),
    )
  })

  it('initializes, completes, and authorizes attachment capabilities as the authenticated user', async () => {
    const initialized = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/attachments/init',
      headers: { authorization: 'Bearer user-token' },
      payload: {
        clientUploadId: 'upload_1',
        name: 'note.txt',
        mediaKind: 'file',
        mimeType: 'text/plain',
        byteSize: 5,
        sha256: 'a'.repeat(64),
      },
    })
    const completed = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/attachments/attachment_1/complete',
      headers: { authorization: 'Bearer user-token' },
    })
    const downloaded = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/attachments/attachment_1/download',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(initialized.statusCode).toBe(201)
    expect(initialized.json()).not.toHaveProperty('objectKey')
    expect(mockInitializeAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room_1',
        userId: 'user_1',
        clientUploadId: 'upload_1',
      }),
    )
    expect(completed.json()).toMatchObject({
      attachment: { attachmentId: 'attachment_1', status: 'ready' },
    })
    expect(mockCompleteAttachment).toHaveBeenCalledWith({
      roomId: 'room_1',
      attachmentId: 'attachment_1',
      userId: 'user_1',
    })
    expect(downloaded.json()).toMatchObject({
      attachmentId: 'attachment_1',
      downloadUrl: 'https://private-oss.example/download?signature=short',
    })
  })

  it('uses membership historyFromSequence as the minimum readable cursor', async () => {
    mockPrisma.roomMessage.findMany.mockResolvedValue([MESSAGE])

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/messages?after=0&limit=20',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockPrisma.roomMessage.findMany).toHaveBeenCalledWith({
      where: {
        roomId: 'room_1',
        sequence: { gt: 1n },
        createdAt: { gte: expect.any(Date) },
      },
      include: {
        attachments: true,
        authorMembership: { select: { displayAlias: true, status: true } },
      },
      orderBy: { sequence: 'asc' },
      take: 20,
    })
  })

  it('returns the latest active membership name while preserving message snapshots as fallback', async () => {
    mockPrisma.roomMessage.findMany.mockResolvedValue([
      {
        ...MESSAGE,
        authorDisplayNameSnapshot: '辰哥',
        authorMembership: { displayAlias: '李辰', status: 'active' },
      },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/messages?after=0&limit=20',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().messages[0].author.displayName).toBe('李辰')
  })

  it('returns the attachment retention deadline for deterministic expiry presentation', async () => {
    const expiresAt = new Date('2026-10-17T00:00:00.000Z')
    mockPrisma.roomMessage.findMany.mockResolvedValue([
      {
        ...MESSAGE,
        attachments: [
          {
            id: 'attachment_1',
            mediaKind: 'image',
            originalName: 'photo.png',
            mimeType: 'image/png',
            byteSize: 12n,
            sha256: 'a'.repeat(64),
            width: 100,
            height: 80,
            durationMs: null,
            status: 'ready',
            expiresAt,
          },
        ],
      },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/messages?after=0&limit=20',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().messages[0].attachments[0]).toMatchObject({
      attachmentId: 'attachment_1',
      status: 'ready',
      expiresAt: expiresAt.toISOString(),
    })
  })

  it('loads the newest backward page without crossing membership history', async () => {
    mockPrisma.roomMessage.findMany.mockResolvedValue([
      MESSAGE,
      { ...MESSAGE, id: 'message_3', sequence: 3n },
      { ...MESSAGE, id: 'message_2', sequence: 2n },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/messages?before=5&limit=2',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockPrisma.roomMessage.findMany).toHaveBeenCalledWith({
      where: {
        roomId: 'room_1',
        sequence: { gt: 1n, lt: 5n },
        createdAt: { gte: expect.any(Date) },
      },
      include: {
        attachments: true,
        authorMembership: { select: { displayAlias: true, status: true } },
      },
      orderBy: { sequence: 'desc' },
      take: 3,
    })
    expect(response.json()).toMatchObject({
      messages: [{ sequence: '3' }, { sequence: '4' }],
      hasMore: true,
    })
  })

  it('rejects combining forward and backward message cursors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/messages?after=1&before=4',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'ambiguous_sequence_cursor' })
    expect(mockPrisma.roomMessage.findMany).not.toHaveBeenCalled()
  })
})
