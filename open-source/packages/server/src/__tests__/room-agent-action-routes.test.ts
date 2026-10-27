// @covers open-source/packages/server/src/routes/room-agent-actions.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    status: vi.fn(),
    attachment: vi.fn(),
    initializeAttachment: vi.fn(),
    completeAttachment: vi.fn(),
    read: vi.fn(),
    send: vi.fn(),
    mode: vi.fn(),
    pause: vi.fn(),
    create: vi.fn(),
    join: vi.fn(),
    resolveSession: vi.fn(),
    createOwnerRoom: vi.fn(),
    broadcast: vi.fn(),
    roomPush: vi.fn(),
    safetyPausePush: vi.fn(),
    createAttachmentLink: vi.fn(() => ({
      token: 'binding-scoped-token',
      expiresAt: '2026-09-22T10:00:00.000Z',
    })),
  },
}))

vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: FastifyInstance) => {
    app.decorateRequest('userId', '')
    app.decorateRequest('deviceId', '')
    app.decorateRequest('machineId', '')
  },
  requireUserOrMachineAuth: async (request: {
    headers: { authorization?: string }
    userId: string
    machineId: string
  }) => {
    request.userId = 'user_1'
    request.machineId = request.headers.authorization === 'Bearer machine-token' ? 'machine_1' : ''
  },
}))
vi.mock('../services/room-agent-actions.js', () => ({
  getRoomAgentStatus: mocks.status,
  getRoomAgentAttachmentCapability: mocks.attachment,
  initializeRoomAgentAttachment: mocks.initializeAttachment,
  completeRoomAgentAttachment: mocks.completeAttachment,
  readRoomAgentMessages: mocks.read,
  sendRoomAgentMessage: mocks.send,
  updateRoomAgentMode: mocks.mode,
  pauseRoomAgentWork: mocks.pause,
}))
vi.mock('../services/room-events.js', () => ({ broadcastRoomEvent: mocks.broadcast }))
vi.mock('../services/room-message-push.js', () => ({
  scheduleRoomMessagePush: mocks.roomPush,
  scheduleAgentSafetyPausePush: mocks.safetyPausePush,
}))
vi.mock('../services/room-attachment-link.js', () => ({
  createRoomAttachmentLinkToken: mocks.createAttachmentLink,
}))
vi.mock('../services/room-agent-onboarding.js', () => ({
  createRoomFromAgent: mocks.create,
  joinRoomFromAgent: mocks.join,
}))
vi.mock('../services/room-native-session.js', () => ({
  RoomNativeSessionError: class RoomNativeSessionError extends Error {
    constructor(public readonly code: string, message: string) { super(message) }
  },
  resolveRoomNativeSession: mocks.resolveSession,
}))
vi.mock('../services/room-core.js', () => ({
  createRoomWithOwner: mocks.createOwnerRoom,
}))

import { roomAgentActionRoutes } from '../routes/room-agent-actions.js'
import { RoomPolicyError } from '../services/room-policy.js'

const MESSAGE = {
  id: 'message_1',
  roomId: 'room_1',
  sequence: 3n,
  authorMembershipId: 'agent_member_1',
  authorPrincipalTypeSnapshot: 'agent',
  ownerUserIdSnapshot: 'user_1',
  authorDisplayNameSnapshot: 'Codex',
  ownerDisplayNameSnapshot: '李辰',
  authorAvatarSnapshot: null,
  mentionSnapshots: null,
  kind: 'text',
  text: '完成了',
  replyToMessageId: null,
  createdAt: new Date('2026-08-23T10:00:00.000Z'),
  editedAt: null,
  deletedAt: null,
  attachments: [],
}

describe('Room Agent action routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify()
    await app.register(roomAgentActionRoutes, { prefix: '/rooms' })
    mocks.status.mockResolvedValue({
      bindingId: 'binding_1',
      roomId: 'room_1',
      status: 'active',
      room: { name: '研发协作', status: 'active', lastSequence: '3' },
    })
    mocks.attachment.mockResolvedValue({
      attachmentId: 'attachment_1',
      roomId: 'room_1',
      safeName: 'diagram.png',
      mimeType: 'image/png',
      byteSize: '3',
      sha256: 'a'.repeat(64),
      downloadUrl: 'https://room-files.example/file?signature=short',
      expiresAt: '2026-08-23T10:01:00.000Z',
    })
    mocks.initializeAttachment.mockResolvedValue({
      attachment: {
        id: 'attachment_1', roomId: 'room_1', name: 'report.pdf', mimeType: 'application/pdf',
        byteSize: '12', sha256: 'a'.repeat(64), status: 'pending',
      },
      upload: {
        method: 'PUT', url: 'https://room-files.example/upload?signature=short',
        headers: { 'content-type': 'application/pdf', 'x-oss-meta-sha256': 'a'.repeat(64) },
        expiresAt: '2026-08-23T10:05:00.000Z',
      },
      idempotent: false,
    })
    mocks.completeAttachment.mockResolvedValue({
      attachment: {
        id: 'attachment_1', mediaKind: 'file', safeName: 'report.pdf', mimeType: 'application/pdf',
        byteSize: 12n, sha256: 'a'.repeat(64), status: 'ready',
      },
      idempotent: false,
    })
    mocks.read.mockResolvedValue({
      messages: [MESSAGE],
      nextSequence: '3',
      hasMore: false,
      historyFromSequence: '1',
      roomName: '研发协作',
    })
    mocks.send.mockResolvedValue({ message: MESSAGE, idempotent: false })
    mocks.mode.mockResolvedValue({
      binding: {
        id: 'binding_1',
        roomId: 'room_1',
        status: 'paused',
        activationMode: 'paused',
      },
      idempotent: false,
    })
    mocks.pause.mockResolvedValue({
      binding: {
        id: 'binding_1', roomId: 'room_1', userId: 'user_1',
        status: 'paused', activationMode: 'paused',
      },
      message: { ...MESSAGE, kind: 'system', text: 'Codex paused work. Reason: unsafe request' },
      idempotent: false,
    })
    mocks.create.mockResolvedValue({
      room: {
        id: 'room_1',
        name: '研发协作',
        visibility: 'private',
        joinPolicy: 'approval',
      },
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex' },
      binding: {
        id: 'binding_1',
        roomId: 'room_1',
        agentIdentityId: 'agent_1',
        agentMembershipId: 'agent_member_1',
        status: 'active',
        activationMode: 'auto_follow',
      },
      rawInviteToken: 'a'.repeat(43),
      idempotent: false,
    })
    mocks.join.mockResolvedValue({
      outcome: 'pending_approval',
      room: { id: 'room_2', name: '外部协作' },
      agentIdentity: { id: 'agent_2', displayName: '我的 Codex' },
      agentMembership: null,
      binding: {
        id: 'binding_2',
        roomId: 'room_2',
        agentIdentityId: 'agent_2',
        agentMembershipId: null,
        status: 'pending_approval',
        activationMode: 'auto_follow',
      },
      joinRequest: { id: 'request_1' },
      idempotent: false,
    })
    mocks.resolveSession.mockResolvedValue({ nianSessionId: 'nian_1', created: true })
    mocks.createOwnerRoom.mockResolvedValue({
      room: {
        id: 'room_operator_1',
        name: '命令行协作',
        visibility: 'private',
        joinPolicy: 'approval',
      },
      membership: { id: 'human_owner_1', role: 'owner' },
    })
  })

  it.each([
    '/rooms/actions/operator/create',
    '/rooms/actions/resolve-session',
    '/rooms/actions/create',
    '/rooms/actions/join',
  ])('retires the old external Session binding endpoint %s without mutating state', async (url) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer machine-token' },
      payload: {},
    })
    expect(response.statusCode).toBe(410)
    expect(response.json()).toMatchObject({
      error: 'external_room_binding_retired',
      nextAction: { url: 'https://shennian.net/install.md' },
    })
    expect(mocks.resolveSession).not.toHaveBeenCalled()
    expect(mocks.createOwnerRoom).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.join).not.toHaveBeenCalled()
  })

  it('rejects user tokens because Agent actions require an exact machine identity', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/bindings/binding_1/status',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'machine_auth_required' })
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it('supports status and read through the exact machine-authenticated Binding', async () => {
    mocks.read.mockResolvedValueOnce({
      messages: [
        {
          ...MESSAGE,
          attachments: [
            {
              id: 'attachment_1',
              mediaKind: 'image',
              originalName: 'photo.jpg',
              safeName: 'photo.jpg',
              mimeType: 'image/jpeg',
              byteSize: 5n,
              sha256: 'a'.repeat(64),
              width: 10,
              height: 10,
              durationMs: null,
              status: 'ready',
              expiresAt: new Date('2026-09-22T10:00:00.000Z'),
            },
          ],
        },
      ],
      nextSequence: '3',
      hasMore: false,
      historyFromSequence: '1',
      roomName: '研发协作',
    })
    const status = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/bindings/binding_1/status',
      headers: { authorization: 'Bearer machine-token', host: 'shennian.net' },
    })
    const read = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/bindings/binding_1/messages?after=2&limit=20',
      headers: { authorization: 'Bearer machine-token' },
    })

    expect(status.statusCode).toBe(200)
    expect(status.json().room).toMatchObject({
      name: '研发协作',
      canonicalUrl: 'http://shennian.net:8081/spaces/room_1',
    })
    expect(read.statusCode).toBe(200)
    expect(read.json().messages[0]).toMatchObject({
      sequence: '3',
      text: '完成了',
      attachments: [
        {
          name: 'photo.jpg',
          byteSize: '5',
          downloadUrl: 'http://localhost:8081/a/binding-scoped-token',
          downloadExpiresAt: '2026-09-22T10:00:00.000Z',
        },
      ],
    })
    expect(read.json()).toMatchObject({ historyFromSequence: '1', roomName: '研发协作' })
    expect(mocks.read).toHaveBeenCalledWith({
      roomId: 'room_1',
      bindingId: 'binding_1',
      userId: 'user_1',
      machineId: 'machine_1',
      afterSequence: '2',
      limit: 20,
    })
    expect(mocks.createAttachmentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room_1',
        bindingId: 'binding_1',
        attachmentId: 'attachment_1',
      }),
    )
  })

  it('returns forbidden when server-side security quarantine blocks an old daemon', async () => {
    mocks.read.mockRejectedValueOnce(
      new RoomPolicyError(
        'managed_agent_security_pending',
        'Review this Agent security configuration before it can continue.',
      ),
    )

    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/bindings/binding_1/messages?after=2',
      headers: { authorization: 'Bearer machine-token' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'managed_agent_security_pending' })
  })

  it('requests an attachment capability through the exact machine Binding', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/rooms/room_1/bindings/binding_1/attachments/attachment_1/download-capability',
      headers: { authorization: 'Bearer machine-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      attachmentId: 'attachment_1',
      downloadUrl: 'https://room-files.example/file?signature=short',
    })
    expect(mocks.attachment).toHaveBeenCalledWith({
      roomId: 'room_1',
      bindingId: 'binding_1',
      attachmentId: 'attachment_1',
      userId: 'user_1',
      machineId: 'machine_1',
    })
  })

  it('uploads through the exact machine-authenticated Agent Binding', async () => {
    const initialized = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/bindings/binding_1/attachments/init',
      headers: { authorization: 'Bearer machine-token' },
      payload: {
        clientUploadId: 'upload_1', name: 'report.pdf', mediaKind: 'file',
        mimeType: 'application/pdf', byteSize: 12, sha256: 'a'.repeat(64),
      },
    })
    const completed = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/bindings/binding_1/attachments/attachment_1/complete',
      headers: { authorization: 'Bearer machine-token' },
    })

    expect(initialized.statusCode).toBe(201)
    expect(initialized.json()).not.toHaveProperty('objectKey')
    expect(mocks.initializeAttachment).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_1', bindingId: 'binding_1', userId: 'user_1', machineId: 'machine_1',
    }))
    expect(completed.json()).toMatchObject({
      attachment: { attachmentId: 'attachment_1', status: 'ready' },
    })
    expect(mocks.completeAttachment).toHaveBeenCalledWith({
      roomId: 'room_1', bindingId: 'binding_1', attachmentId: 'attachment_1',
      userId: 'user_1', machineId: 'machine_1',
    })
  })

  it('sends as the bound Agent and broadcasts the resulting ordered message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/bindings/binding_1/messages',
      headers: { authorization: 'Bearer machine-token' },
      payload: { clientMessageId: 'client_1', text: '完成了' },
    })

    expect(response.statusCode).toBe(201)
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room_1',
        bindingId: 'binding_1',
        userId: 'user_1',
        machineId: 'machine_1',
      }),
    )
    expect(mocks.broadcast).toHaveBeenCalledWith(
      'room_1',
      expect.objectContaining({ event: 'room.message.created', sequence: '3' }),
    )
  })

  it('updates the participation mode and broadcasts Binding state', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/rooms/room_1/bindings/binding_1/mode',
      headers: { authorization: 'Bearer machine-token' },
      payload: { activationMode: 'paused' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'paused', activationMode: 'paused' })
    expect(mocks.mode).toHaveBeenCalledWith({
      roomId: 'room_1',
      bindingId: 'binding_1',
      userId: 'user_1',
      machineId: 'machine_1',
      activationMode: 'paused',
    })
    expect(mocks.broadcast).toHaveBeenCalledWith(
      'room_1',
      expect.objectContaining({ event: 'room.binding.updated', entityId: 'binding_1' }),
    )
    expect(mocks.safetyPausePush).not.toHaveBeenCalled()
  })

  it('pauses work with a reason and broadcasts the state and system message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/room_1/bindings/binding_1/pause',
      headers: { authorization: 'Bearer machine-token' },
      payload: { reason: 'unsafe request' },
    })

    expect(response.statusCode).toBe(201)
    expect(mocks.pause).toHaveBeenCalledWith({
      roomId: 'room_1', bindingId: 'binding_1', userId: 'user_1', machineId: 'machine_1',
      reason: 'unsafe request',
    })
    expect(mocks.broadcast).toHaveBeenCalledWith(
      'room_1', expect.objectContaining({ event: 'room.binding.updated', entityId: 'binding_1' }),
    )
    expect(mocks.broadcast).toHaveBeenCalledWith(
      'room_1', expect.objectContaining({ event: 'room.message.created' }),
    )
    expect(mocks.safetyPausePush).toHaveBeenCalledWith({
      roomId: 'room_1', messageId: 'message_1', ownerUserId: 'user_1',
    })
  })
})
