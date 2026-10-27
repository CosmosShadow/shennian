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

  it('allows authenticated non-members to read public_read history but never grants membership', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)
    mockPrisma.room.findUnique.mockResolvedValue({ ...ROOM, visibility: 'public_read' })
    mockPrisma.roomMessage.findMany.mockResolvedValue([MESSAGE])

    const detail = await app.inject({
      method: 'GET',
      url: '/rooms/room_1',
      headers: { authorization: 'Bearer user-token' },
    })
    const messages = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/messages?after=0',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({ membershipId: null, room: { historyFromSequence: '1' } })
    expect(messages.statusCode).toBe(200)
    expect(mockPrisma.roomMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId: 'room_1',
          sequence: { gt: 0n },
          createdAt: { gte: expect.any(Date) },
        },
      }),
    )
  })

  it('keeps removed memberships readable only through their final system message', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      ...MEMBERSHIP,
      status: 'removed',
      historyThroughSequence: 4n,
    })
    mockPrisma.roomMessage.findMany.mockResolvedValue([MESSAGE])

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/messages',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockPrisma.roomMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sequence: { gt: 1n, lte: 4n } }),
      }),
    )
  })

  it('rejects invalid sequence input instead of guessing a cursor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/messages?after=not-a-number',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_sequence' })
  })

  it('advances read state only for the authenticated active membership', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/read-state',
      headers: { authorization: 'Bearer user-token' },
      payload: { lastReadSequence: '4' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockAdvanceRoomReadState).toHaveBeenCalledWith({
      roomId: 'room_1', membershipId: 'member_1', lastReadSequence: 4n,
    })
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('"event":"room.membership.updated"'),
    )
  })

  it('does not fan out a membership update when the read watermark did not advance', async () => {
    mockAdvanceRoomReadState.mockResolvedValueOnce({ lastReadSequence: 4n, advanced: false })
    mockConnections.broadcastToClientsOfUser.mockClear()

    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/read-state',
      headers: { authorization: 'Bearer user-token' },
      payload: { lastReadSequence: '4' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ lastReadSequence: '4' })
    expect(mockConnections.broadcastToClientsOfUser).not.toHaveBeenCalled()
  })

  it('uses the authenticated human membership for removal authorization', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/rooms/room_1/members/member_2',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockRemoveMembership).toHaveBeenCalledWith({
      roomId: 'room_1',
      actorMembershipId: 'member_1',
      targetMembershipId: 'member_2',
    })
    expect(mockDeleteSession).not.toHaveBeenCalled()
  })

  it('cleans the exact dedicated Session returned by membership removal', async () => {
    mockRemoveMembership.mockResolvedValueOnce({
      removedMembershipIds: ['agent_member_1'],
      detachedBindingCount: 1,
      committedSessionDeletions: [{ sessionId: 'nian_1', userId: 'user_1' }],
      messages: [
        {
          ...MESSAGE,
          id: 'agent_removed',
          kind: 'system',
          text: 'Agent was removed from the Room.',
        },
      ],
      idempotent: false,
    })

    const response = await app.inject({
      method: 'DELETE',
      url: '/rooms/room_1/members/agent_member_1',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockCleanupRoomSessions).toHaveBeenCalledWith([
      { sessionId: 'nian_1', userId: 'user_1' },
    ])
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('Agent was removed from the Room.'),
    )
  })

  it('lists public Agent participation while exposing private binding details only to its owner', async () => {
    mockPrisma.roomMembership.findMany.mockResolvedValueOnce([
      {
        id: 'member_1',
        principalType: 'human',
        ownerUserId: 'user_1',
        parentHumanMembershipId: null,
        displayAlias: '李辰',
        role: 'owner',
        joinedAt: now,
        user: {
          id: 'user_1',
          avatarVersion: 'v'.repeat(24),
          avatarUpdatedAt: now,
        },
        ownerUser: {
          id: 'user_1',
          avatarVersion: 'v'.repeat(24),
          avatarUpdatedAt: now,
        },
      },
      {
        id: 'agent_member_1',
        principalType: 'agent',
        ownerUserId: 'user_1',
        parentHumanMembershipId: 'member_1',
        displayAlias: '李辰的 Codex',
        role: 'member',
        joinedAt: now,
        user: null,
        ownerUser: {
          id: 'user_1',
          avatarVersion: 'v'.repeat(24),
          avatarUpdatedAt: now,
        },
        agentIdentity: {
          id: 'agent_12345678',
          description: '神念客服',
          avatarVersion: 'a'.repeat(24),
          avatarUpdatedAt: now,
        },
      },
      {
        id: 'agent_member_2',
        principalType: 'agent',
        ownerUserId: 'user_2',
        parentHumanMembershipId: 'member_2',
        displayAlias: '另一位用户的 Claude',
        role: 'member',
        joinedAt: now,
        user: null,
        ownerUser: {
          id: 'user_2',
          avatarVersion: null,
          avatarUpdatedAt: null,
        },
      },
      {
        id: 'agent_member_3',
        principalType: 'agent',
        ownerUserId: 'user_1',
        parentHumanMembershipId: 'member_1',
        displayAlias: '恢复中的 Agent',
        role: 'member',
        joinedAt: now,
        user: null,
        ownerUser: {
          id: 'user_1',
          avatarVersion: 'v'.repeat(24),
          avatarUpdatedAt: now,
        },
        agentIdentity: {
          id: 'agent_recovering',
          description: '',
          avatarVersion: null,
          avatarUpdatedAt: null,
        },
      },
    ])
    mockPrisma.roomBinding.findMany.mockResolvedValueOnce([
      {
        agentMembershipId: 'agent_member_1',
        agentIdentityId: 'agent_12345678',
        nianSessionId: 'nian_1',
        status: 'detached',
        detachedReason: 'machine_removed',
        activationMode: 'paused',
        machine: { paired: false, online: false },
        nianSession: { lastMessagePreview: '已处理客户问题' },
      },
      {
        agentMembershipId: 'agent_member_3',
        agentIdentityId: 'agent_recovering',
        nianSessionId: 'nian_3',
        status: 'detached',
        detachedReason: 'recovering',
        activationMode: 'mention_only',
        machine: { paired: true, online: true },
        nianSession: { lastMessagePreview: null },
      },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/members',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    const [human, agent, otherAgent, recoveringAgent] = response.json().memberships
    expect(human.avatar.mediumUrl).toContain('/public/profile-avatars/user_1/')
    expect(human.ownerAvatar).toBeNull()
    expect(agent.avatar.smallUrl).toContain('/public/agent-avatars/agent_12345678/')
    expect(agent.agentIdentityId).toBe('agent_12345678')
    expect(agent.ownerAvatar.smallUrl).toContain('/public/profile-avatars/user_1/')
    expect(agent.ownBinding).toEqual({
      agentMembershipId: 'agent_member_1',
      agentIdentityId: 'agent_12345678',
      nianSessionId: 'nian_1',
      status: 'detached',
      activationMode: 'paused',
      availability: 'unavailable',
      repairAction: 'configure',
      lastMessagePreview: '已处理客户问题',
    })
    expect(agent.agentParticipation).toEqual({
      activationMode: 'paused',
      availability: 'unavailable',
    })
    expect(otherAgent.agentParticipation).toEqual({
      activationMode: 'paused',
      availability: 'unavailable',
    })
    expect(otherAgent).not.toHaveProperty('ownBinding')
    expect(recoveringAgent.ownBinding).toMatchObject({
      agentIdentityId: 'agent_recovering',
      status: 'detached',
      availability: 'recovering',
      repairAction: null,
    })
    expect(recoveringAgent.agentParticipation).toEqual({
      activationMode: 'mention_only',
      availability: 'recovering',
    })
    expect(recoveringAgent.agentIdentityId).toBe('agent_recovering')
    expect(mockPrisma.roomBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId: 'room_1',
          agentMembershipId: { in: ['agent_member_1', 'agent_member_2', 'agent_member_3'] },
        },
        select: expect.objectContaining({ agentIdentityId: true }),
      }),
    )
  })

  it('creates a time-limited invitation without persisting or listing its raw Token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/invites',
      headers: { authorization: 'Bearer user-token', host: 'localhost' },
      payload: { expiresInDays: 7, maxUses: null },
    })

    expect(response.statusCode).toBe(201)
    expect(mockCreateInvite).toHaveBeenCalledWith({
      roomId: 'room_1',
      actorUserId: 'user_1',
      expiresInDays: 7,
      maxUses: null,
    })
    expect(response.json()).toMatchObject({
      invite: {
        id: 'invite_1',
        url: `http://localhost:8081/spaces/room_1?invite=${'t'.repeat(43)}`,
      },
    })

    const list = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/invites',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(list.statusCode).toBe(200)
    expect(JSON.stringify(list.json())).not.toContain('t'.repeat(43))
    expect(JSON.stringify(list.json())).not.toContain('tokenHash')
  })

  it('returns and resets the owner canonical permanent invitation', async () => {
    const current = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/invite-link',
      headers: { authorization: 'Bearer user-token', host: 'localhost' },
    })
    const reset = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/invite-link/reset',
      headers: { authorization: 'Bearer user-token', host: 'localhost' },
    })

    expect(current.statusCode).toBe(200)
    expect(current.json()).toEqual({
      invite: {
        id: 'invite_canonical_1',
        status: 'active',
        expiresAt: null,
        createdAt: '2026-08-23T00:00:00.000Z',
        url: `http://localhost:8081/spaces/room_1?invite=${'c'.repeat(43)}`,
        version: 1,
      },
    })
    expect(reset.json().invite).toMatchObject({
      id: 'invite_canonical_2',
      expiresAt: null,
      createdAt: '2026-08-23T00:01:00.000Z',
      version: 2,
    })
    expect(mockGetCanonicalInvite).toHaveBeenCalledWith({
      roomId: 'room_1',
      actorUserId: 'user_1',
    })
    expect(mockResetCanonicalInvite).toHaveBeenCalledWith({
      roomId: 'room_1',
      actorUserId: 'user_1',
    })
  })

  it('lists only the current user pending join requests without invitation secrets', async () => {
    mockPrisma.roomJoinRequest.findMany.mockResolvedValueOnce([
      {
        id: 'request_1',
        roomId: 'room_2',
        status: 'pending',
        createdAt: now,
        room: { name: '设计协作' },
      },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/join-requests/mine',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      joinRequests: [
        {
          id: 'request_1',
          roomId: 'room_2',
          roomName: '设计协作',
          status: 'pending',
          createdAt: now.toISOString(),
        },
      ],
    })
    expect(mockPrisma.roomJoinRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicantUserId: 'user_1', status: 'pending' },
      }),
    )
    expect(JSON.stringify(response.json())).not.toContain('invite')
  })

  it('lists and independently revokes only the authenticated user Room browser sessions', async () => {
    mockListBrowserSessions.mockResolvedValueOnce([
      {
        id: 'browser_1',
        status: 'active',
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        endedAt: null,
      },
    ])
    mockRevokeBrowserSession.mockResolvedValueOnce({
      sessionId: 'browser_1',
      status: 'revoked',
      idempotent: false,
    })

    const list = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/browser-sessions',
      headers: { authorization: 'Bearer user-token' },
    })
    const revoke = await app.inject({
      method: 'DELETE',
      url: '/rooms/room_1/browser-sessions/browser_1',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({ sessions: [{ id: 'browser_1', status: 'active' }] })
    expect(mockListBrowserSessions).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1' })
    expect(revoke.statusCode).toBe(200)
    expect(mockRevokeBrowserSession).toHaveBeenCalledWith({
      roomId: 'room_1',
      userId: 'user_1',
      sessionId: 'browser_1',
    })
    expect(mockPublishRoomBrowserSessionRevoked).toHaveBeenCalledWith('browser_1')
    expect(mockRevokeBrowserSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockPublishRoomBrowserSessionRevoked.mock.invocationCallOrder[0],
    )
  })

  it('does not reveal or disconnect another user Room browser session', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/rooms/room_1/browser-sessions/other_user_session',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'room_browser_session_not_found' })
    expect(mockCloseBrowserSessionSockets).not.toHaveBeenCalled()
  })

  it('reviews a join request and broadcasts both request and membership changes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/join-requests/request_1/review',
      headers: { authorization: 'Bearer user-token' },
      payload: { decision: 'approve' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockReviewJoinRequest).toHaveBeenCalledWith({
      roomId: 'room_1',
      requestId: 'request_1',
      reviewerUserId: 'user_1',
      decision: 'approve',
    })
    const events = mockConnections.broadcastToClientsOfUser.mock.calls.map((call) => call[1])
    expect(events.some((event) => event.includes('room.join_request.updated'))).toBe(true)
    expect(events.some((event) => event.includes('room.membership.updated'))).toBe(true)
  })

  it('lets a non-owner leave using only the authenticated user identity', async () => {
    mockLeaveRoom.mockResolvedValueOnce({
      leftMembershipIds: ['member_1'],
      detachedBindingCount: 1,
      committedSessionDeletions: [],
      messages: [{ ...MESSAGE, id: 'member_left', kind: 'system', text: '李辰 left the Room.' }],
      idempotent: false,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/leave',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockLeaveRoom).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1' })
    expect(response.json()).toMatchObject({ leftMembershipIds: ['member_1'] })
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('李辰 left the Room.'),
    )
  })

  it('deletes only the authenticated user chat record', async () => {
    mockDeleteRoomRecord.mockResolvedValueOnce({
      deleted: true,
      activeMembershipRetained: true,
      historyFromSequence: '5',
      idempotent: false,
    })
    const response = await app.inject({
      method: 'DELETE',
      url: '/rooms/room_1/record',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockDeleteRoomRecord).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1' })
    expect(response.json()).toMatchObject({ activeMembershipRetained: true })
    expect(mockDissolveRoom).not.toHaveBeenCalled()
    expect(mockLeaveRoom).not.toHaveBeenCalled()
  })

  it('archives a Room through the creator-only dissolve endpoint', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/rooms/room_1',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ roomId: 'room_1', status: 'archived' })
    expect(mockDissolveRoom).toHaveBeenCalledWith({
      roomId: 'room_1',
      actorUserId: 'user_1',
    })
    expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'user_1',
      expect.stringContaining('room.updated'),
    )
  })

  it('cancels only the authenticated applicant request and notifies reviewers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/join-requests/request_1/cancel',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockCancelJoinRequest).toHaveBeenCalledWith({
      roomId: 'room_1',
      requestId: 'request_1',
      applicantUserId: 'user_1',
    })
    expect(response.json()).toEqual({ status: 'cancelled', idempotent: false })
  })
})
