// @covers open-source/packages/server/src/routes/room-cli.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    roomMembership: { findUnique: vi.fn(), findMany: vi.fn() },
    roomMessage: { findMany: vi.fn() },
    room: { findUnique: vi.fn() },
  },
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  removeMember: vi.fn(),
  deleteRecord: vi.fn(),
  sendMessage: vi.fn(),
  canonicalInvite: vi.fn(),
  resetInvite: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  cleanupRoomSessions: vi.fn(),
  exchange: vi.fn(),
  broadcast: vi.fn(),
  authorReadAdvanced: vi.fn(),
  broadcastToUsers: vi.fn(),
  initAttachment: vi.fn(),
  completeAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
  createRoomBrowserHandoff: vi.fn(),
  listContacts: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: FastifyInstance) => {
    app.decorateRequest('userId', '')
    app.decorateRequest('machineId', '')
    app.decorateRequest('deviceId', '')
  },
  requireUserOrMachineAuth: async (request: { headers: { authorization?: string }; userId: string; machineId: string }) => {
    request.userId = 'user_1'
    request.machineId = request.headers.authorization === 'Bearer machine-token' ? 'machine_1' : ''
  },
  requireActivePlan: async () => {},
}))
vi.mock('../lib/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/room-core.js', async () => ({
  createRoomWithOwner: mocks.createRoom,
  updateRoomSettings: mocks.updateRoom,
  removeRoomMembership: mocks.removeMember,
  sendRoomTextMessage: mocks.sendMessage,
}))
vi.mock('../services/room-membership.js', () => ({
  deleteRoomRecord: mocks.deleteRecord,
  getCanonicalRoomInvite: mocks.canonicalInvite,
  resetCanonicalRoomInvite: mocks.resetInvite,
  joinRoomFromBrowserState: mocks.join,
  leaveRoom: mocks.leave,
}))
vi.mock('../services/room-session-cleanup.js', () => ({
  finalizeExclusiveRoomSessionDeletions: mocks.cleanupRoomSessions,
}))
vi.mock('../services/room-invite-browser.js', () => ({
  exchangeRoomInviteToken: mocks.exchange,
  RoomInviteBrowserError: class RoomInviteBrowserError extends Error {
    constructor(public readonly code: string, public readonly statusCode: number, message: string) { super(message) }
  },
}))
vi.mock('../services/room-events.js', () => ({
  broadcastRoomEvent: mocks.broadcast,
  broadcastRoomMessageRecord: mocks.broadcast,
  broadcastRoomEventToUsers: mocks.broadcastToUsers,
  broadcastAuthorReadAdvanced: mocks.authorReadAdvanced,
}))
vi.mock('../services/room-browser-session.js', () => ({
  createRoomBrowserHandoff: mocks.createRoomBrowserHandoff,
}))
vi.mock('../services/contacts.js', () => ({
  ContactError: class ContactError extends Error { constructor(public readonly code: string) { super(code) } },
  listContacts: mocks.listContacts,
}))
vi.mock('../services/room-attachments.js', () => ({
  initializeRoomAttachment: mocks.initAttachment,
  completeRoomAttachment: mocks.completeAttachment,
  getRoomAttachmentDownload: mocks.downloadAttachment,
}))

import { roomCliRoutes } from '../routes/room-cli.js'
import { RoomInviteBrowserError } from '../services/room-invite-browser.js'
import { RoomPolicyError } from '../services/room-policy.js'

const ROOM = {
  id: 'room_1', name: '产品讨论', status: 'active', visibility: 'private', joinPolicy: 'approval',
  nextSequence: 52n, updatedAt: new Date('2026-08-30T00:00:00.000Z'),
}
const MEMBERSHIP = {
  id: 'member_human', roomId: 'room_1', status: 'active', role: 'owner',
  historyFromSequence: 1n, room: ROOM,
}
const MESSAGE = {
  id: 'message_secret', roomId: 'room_1', sequence: 52n, authorMembershipId: 'member_human',
  authorPrincipalTypeSnapshot: 'human', ownerUserIdSnapshot: 'user_1',
  authorDisplayNameSnapshot: '临时用户', ownerDisplayNameSnapshot: '临时用户', authorAvatarSnapshot: null,
  mentionSnapshots: [{ membershipId: 'member_agent', principalType: 'agent', displayName: '研究助手' }],
  kind: 'text', source: 'cli', text: '@研究助手 请查看', replyToMessageId: null,
  createdAt: new Date('2026-08-30T00:00:00.000Z'), editedAt: null, deletedAt: null,
  attachments: [], authorMembership: { displayAlias: '临时用户', status: 'active' },
}

describe('machine-authenticated public Room CLI routes', () => {
  let app: FastifyInstance
  const oldNodeEnv = process.env.NODE_ENV

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.NODE_ENV = 'production'
    mocks.prisma.roomMembership.findUnique.mockResolvedValue(MEMBERSHIP)
    mocks.prisma.roomMembership.findMany.mockResolvedValue([
      { id: 'member_human', displayAlias: '临时用户', principalType: 'human', role: 'owner', agentIdentity: null },
      { id: 'member_agent', displayAlias: '研究助手', principalType: 'agent', role: 'member', agentIdentity: { description: '研究资料' } },
    ])
    mocks.prisma.roomMessage.findMany.mockResolvedValue([MESSAGE])
    mocks.prisma.room.findUnique.mockResolvedValue({ name: ROOM.name })
    mocks.createRoom.mockResolvedValue({ room: ROOM, membership: MEMBERSHIP, idempotent: false })
    mocks.updateRoom.mockResolvedValue({ room: ROOM, message: null, idempotent: false })
    mocks.removeMember.mockResolvedValue({
      removedMembershipIds: ['member_agent'],
      removedHumanUserIds: [],
      detachedBindingCount: 1,
      committedSessionDeletions: [],
      messages: [],
      idempotent: false,
    })
    mocks.deleteRecord.mockResolvedValue({
      deleted: true,
      activeMembershipRetained: true,
      historyFromSequence: '53',
      idempotent: false,
    })
    mocks.canonicalInvite.mockResolvedValue({ rawToken: 'i'.repeat(43), invite: { id: 'invite_secret' }, version: 3 })
    mocks.resetInvite.mockResolvedValue({
      rawToken: 'r'.repeat(43),
      invite: { id: 'invite_reset' },
      version: 4,
      idempotent: false,
    })
    mocks.exchange.mockResolvedValue({ browserState: 'b'.repeat(43) })
    mocks.join.mockResolvedValue({ outcome: 'joined', roomId: 'room_1', membership: MEMBERSHIP, idempotent: false })
    mocks.sendMessage.mockResolvedValue({ message: MESSAGE, idempotent: false })
    mocks.leave.mockResolvedValue({
      leftMembershipIds: ['member_human'],
      committedSessionDeletions: [{ sessionId: 'session_agent', userId: 'user_1' }],
      idempotent: false,
    })
    mocks.createRoomBrowserHandoff.mockResolvedValue({ token: 'h'.repeat(43) })
    app = Fastify()
    await app.register(roomCliRoutes, { prefix: '/room-cli' })
    await app.register(roomCliRoutes, { prefix: '/api/room-cli' })
  })

  afterEach(async () => {
    process.env.NODE_ENV = oldNodeEnv
    await app.close()
  })

  it('requires machine authentication rather than a browser user token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/room-cli/room_1/status', headers: { authorization: 'Bearer user-token' } })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'machine_auth_required' })
  })

  it('lists the paired user contacts without deriving them from Room memberships', async () => {
    mocks.listContacts.mockResolvedValue({ contacts: [
      { id: 'contact_1', kind: 'human', displayName: '小龙' },
    ], truncated: false })
    const response = await machineRequest('GET', '/api/room-cli/contacts?q=%E5%B0%8F%E9%BE%99')
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().contacts[0].displayName).toBe('小龙')
    expect(mocks.listContacts).toHaveBeenCalledWith({ ownerUserId: 'user_1', query: '小龙' })
    expect(mocks.prisma.roomMembership.findMany).not.toHaveBeenCalled()

    const forbidden = await app.inject({ method: 'GET', url: '/api/room-cli/contacts',
      headers: { authorization: 'Bearer user-token' } })
    expect(forbidden.statusCode).toBe(403)
  })

  it('supports the Nginx-stripped production path and the direct API path', async () => {
    const production = await machineRequest('POST', '/room-cli/create', { name: '产品讨论' })
    const direct = await machineRequest('POST', '/api/room-cli/create', { name: '产品讨论' })

    expect(production.statusCode).toBe(201)
    expect(direct.statusCode).toBe(201)
  })

  it('creates a Room with canonical web and invitation URLs but no internal membership IDs', async () => {
    const response = await machineRequest('POST', '/api/room-cli/create', { name: '产品讨论' })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      outcome: 'created',
      idempotent: false,
      room: {
        name: '产品讨论',
        canonicalUrl: 'https://app.shennian.net/spaces/room_1',
        launchUrl: `https://app.shennian.net/spaces/room_1?access=${'h'.repeat(43)}`,
        inviteUrl: `https://app.shennian.net/spaces/room_1?invite=${'i'.repeat(43)}`,
      },
    })
    expect(response.body).not.toMatch(/membershipId|machineToken|bindingId/)
  })

  it('lists duplicate Room names as separate canonical URL candidates and gets one version', async () => {
    mocks.prisma.roomMembership.findMany.mockResolvedValueOnce([
      { role: 'owner', room: ROOM },
      { role: 'member', room: { ...ROOM, id: 'room_2' } },
    ])
    const listed = await machineRequest('GET', '/api/room-cli/rooms')
    expect(listed.statusCode).toBe(200)
    expect(listed.json().rooms).toEqual([
      expect.objectContaining({ name: '产品讨论', canonicalUrl: 'https://app.shennian.net/spaces/room_1', version: ROOM.updatedAt.toISOString() }),
      expect.objectContaining({ name: '产品讨论', canonicalUrl: 'https://app.shennian.net/spaces/room_2', version: ROOM.updatedAt.toISOString() }),
    ])

    const got = await machineRequest('GET', '/api/room-cli/room_1')
    expect(got.json()).toMatchObject({
      room: { canonicalUrl: 'https://app.shennian.net/spaces/room_1', version: ROOM.updatedAt.toISOString() },
    })
  })

  it('requires and forwards an exact Room version for update and personal record deletion', async () => {
    const missing = await machineRequest('POST', '/api/room-cli/room_1/update', { name: '新名称' })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('room_version_required')

    const updated = await machineRequest('POST', '/api/room-cli/room_1/update', {
      version: ROOM.updatedAt.toISOString(),
      name: '新名称',
    })
    expect(updated.statusCode).toBe(200)
    expect(mocks.updateRoom).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_1',
      actorUserId: 'user_1',
      expectedUpdatedAt: ROOM.updatedAt,
      name: '新名称',
    }))

    const deleted = await machineRequest('POST', '/api/room-cli/room_1/delete', {
      version: ROOM.updatedAt.toISOString(),
    })
    expect(deleted.json()).toMatchObject({ deleted: true, activeMembershipRetained: true })
    expect(mocks.deleteRecord).toHaveBeenCalledWith({
      roomId: 'room_1',
      userId: 'user_1',
      expectedUpdatedAt: ROOM.updatedAt,
    })
  })

  it('gets and version-resets the canonical invitation without returning internal IDs', async () => {
    const current = await machineRequest('GET', '/api/room-cli/room_1/invite')
    expect(current.json()).toEqual({
      invite: { url: `https://app.shennian.net/spaces/room_1?invite=${'i'.repeat(43)}`, version: 3 },
    })
    expect(current.body).not.toContain('invite_secret')

    const reset = await machineRequest('POST', '/api/room-cli/room_1/invite/reset', { version: 3 })
    expect(mocks.resetInvite).toHaveBeenCalledWith({
      roomId: 'room_1', actorUserId: 'user_1', expectedVersion: 3,
    })
    expect(reset.json()).toEqual({
      invite: { url: `https://app.shennian.net/spaces/room_1?invite=${'r'.repeat(43)}`, version: 4 },
      idempotent: false,
    })
  })

  it('lists opaque member references and removes one with its exact version', async () => {
    mocks.prisma.roomMembership.findMany.mockResolvedValueOnce([
      {
        id: 'member_agent', displayAlias: '研究助手', principalType: 'agent', role: 'member',
        membershipEpoch: 2, agentIdentity: { description: '研究资料' },
      },
    ])
    const listed = await machineRequest('GET', '/api/room-cli/room_1/members')
    const member = listed.json().members[0]
    expect(member).toMatchObject({
      memberRef: expect.stringMatching(/^member_[A-Za-z0-9_-]{43}$/),
      nickname: '研究助手',
      version: 2,
    })
    expect(listed.body).not.toContain('member_agent')

    mocks.prisma.roomMembership.findMany.mockResolvedValueOnce([{ id: 'member_agent' }])
    const removed = await machineRequest('POST', '/api/room-cli/room_1/members/remove', {
      memberRef: member.memberRef,
      version: 2,
    })
    expect(removed.json()).toEqual({ removed: true, removedCount: 1, idempotent: false })
    expect(mocks.removeMember).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_1',
      targetMembershipId: 'member_agent',
      expectedTargetVersion: 2,
    }))
    expect(removed.body).not.toContain('member_agent')
  })

  it('returns launchUrl only after a successful join', async () => {
    const joined = await machineRequest('POST', '/api/room-cli/join', { roomId: 'room_1', inviteToken: 'i'.repeat(43) })
    expect(joined.statusCode).toBe(201)
    expect(joined.json()).toMatchObject({
      outcome: 'joined',
      room: { launchUrl: `https://app.shennian.net/spaces/room_1?access=${'h'.repeat(43)}` },
    })
    expect(joined.body).not.toContain('member_human')

    mocks.join.mockResolvedValueOnce({
      outcome: 'pending_approval', roomId: 'room_1', joinRequest: { id: 'request_secret' }, idempotent: false,
    })
    const pending = await machineRequest('POST', '/api/room-cli/join', { roomId: 'room_1', inviteToken: 'i'.repeat(43) })
    expect(pending.statusCode).toBe(202)
    expect(pending.json()).toEqual({
      outcome: 'pending_approval', idempotent: false, nextAction: { type: 'wait_for_room_approval' },
    })
    expect(pending.body).not.toMatch(/launchUrl|request_secret/)
  })

  it('asks the CLI to collect an introduction when approval requires one', async () => {
    mocks.join.mockRejectedValueOnce(
      new RoomPolicyError('join_message_required', 'A short introduction is required.'),
    )

    const response = await machineRequest('POST', '/api/room-cli/join', {
      roomId: 'room_1', inviteToken: 'i'.repeat(43),
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: 'join_message_required',
      message: 'A short introduction is required.',
      nextAction: { type: 'request_join_message' },
    })
  })

  it('returns the same safe Room URL for an idempotent rejoin and no URL for a closed invite', async () => {
    mocks.join.mockResolvedValueOnce({
      outcome: 'joined', roomId: 'room_1', membership: MEMBERSHIP, idempotent: true,
    })
    const repeated = await machineRequest('POST', '/api/room-cli/join', { roomId: 'room_1', inviteToken: 'i'.repeat(43) })
    expect(repeated.statusCode).toBe(200)
    const body = repeated.json()
    expect(body).toMatchObject({
      outcome: 'joined', idempotent: true,
      room: {
        canonicalUrl: 'https://app.shennian.net/spaces/room_1',
        launchUrl: `https://app.shennian.net/spaces/room_1?access=${'h'.repeat(43)}`,
      },
    })
    expect(body.room.canonicalUrl).not.toMatch(/[?#]|credential|binding|membership|session/i)

    mocks.exchange.mockRejectedValueOnce(new RoomInviteBrowserError(
      'room_invite_unavailable', 410, 'This Room invitation is unavailable.',
    ))
    const closed = await machineRequest('POST', '/api/room-cli/join', { roomId: 'room_1', inviteToken: 'i'.repeat(43) })
    expect(closed.statusCode).toBe(410)
    expect(closed.json()).toEqual({
      error: 'room_invite_unavailable', message: 'This Room invitation is unavailable.',
    })
    expect(closed.body).not.toMatch(/launchUrl|app\.shennian\.net/)
  })

  it('returns the latest 50 messages without hasMore or internal IDs', async () => {
    const response = await machineRequest('GET', '/api/room-cli/room_1/messages')
    expect(response.statusCode).toBe(200)
    expect(mocks.prisma.roomMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { sequence: 'desc' }, take: 50,
    }))
    expect(response.json()).toEqual({ messages: [expect.objectContaining({
      sequence: '52', source: 'cli', author: { nickname: '临时用户', type: 'human', ownerNickname: '临时用户' },
    })] })
    expect(response.body).not.toMatch(/hasMore|message_secret|member_human|user_1|room_1/)
  })

  it('paginates older messages backward and newer messages forward by decimal sequence', async () => {
    await machineRequest('GET', '/api/room-cli/room_1/messages?before=50&limit=20')
    expect(mocks.prisma.roomMessage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sequence: { gt: 0n, lt: 50n } }),
      orderBy: { sequence: 'desc' }, take: 20,
    }))

    await machineRequest('GET', '/api/room-cli/room_1/messages?after=50&limit=20')
    expect(mocks.prisma.roomMessage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sequence: { gt: 50n } }),
      orderBy: { sequence: 'asc' }, take: 20,
    }))

    const ambiguous = await machineRequest('GET', '/api/room-cli/room_1/messages?before=50&after=40')
    expect(ambiguous.statusCode).toBe(400)
    expect(ambiguous.json()).toEqual({ error: 'ambiguous_sequence_cursor' })
  })

  it('derives @nickname mentions and the trusted cli source on send', async () => {
    const response = await machineRequest('POST', '/api/room-cli/room_1/messages', {
      clientMessageId: 'cli:one', text: '@研究助手 请查看',
    })
    expect(response.statusCode).toBe(201)
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_1', authorMembershipId: 'member_human',
      mentionMembershipIds: ['member_agent'], source: 'cli',
    }))
    expect(response.body).not.toContain('member_agent')
    expect(mocks.authorReadAdvanced).toHaveBeenCalledTimes(1)
  })

  it('cleans child Agent Sessions when the authenticated human leaves', async () => {
    const response = await machineRequest('POST', '/api/room-cli/room_1/leave')

    expect(response.statusCode).toBe(200)
    expect(mocks.leave).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1' })
    expect(mocks.cleanupRoomSessions).toHaveBeenCalledWith([
      { sessionId: 'session_agent', userId: 'user_1' },
    ])
    expect(response.json()).toEqual({ outcome: 'left', idempotent: false })
  })

  it('keeps attachment capabilities behind machine-authenticated CLI endpoints', async () => {
    mocks.initAttachment.mockResolvedValueOnce({
      attachment: { id: 'ratt_one' },
      upload: { method: 'PUT', url: 'https://upload.example/temporary', headers: {}, expiresAt: '2026-08-31T01:00:00.000Z' },
    })
    mocks.completeAttachment.mockResolvedValueOnce({
      attachment: {
        id: 'ratt_one', mediaKind: 'file', safeName: 'a.pdf', mimeType: 'application/pdf',
        byteSize: 3n, sha256: 'a'.repeat(64),
      },
      idempotent: false,
    })
    mocks.downloadAttachment.mockResolvedValueOnce({
      attachmentId: 'ratt_one', name: 'a.pdf', mimeType: 'application/pdf', byteSize: '3',
      sha256: 'a'.repeat(64), downloadUrl: 'https://download.example/temporary',
      expiresAt: '2026-08-31T01:00:00.000Z',
    })

    expect((await machineRequest('POST', '/api/room-cli/room_1/attachments/init', {
      clientUploadId: 'cli:one', name: 'a.pdf', mediaKind: 'file', mimeType: 'application/pdf',
      byteSize: 3, sha256: 'a'.repeat(64),
    })).statusCode).toBe(200)
    expect((await machineRequest('POST', '/api/room-cli/room_1/attachments/ratt_one/complete', {})).json())
      .toMatchObject({ attachment: { attachmentId: 'ratt_one', byteSize: '3' } })
    expect((await machineRequest('GET', '/api/room-cli/room_1/attachments/ratt_one/download')).json())
      .toMatchObject({ downloadUrl: 'https://download.example/temporary' })

    const unauthorized = await app.inject({ method: 'GET', url: '/api/room-cli/room_1/attachments/ratt_one/download' })
    expect(unauthorized.statusCode).toBe(403)
  })

  async function machineRequest(method: string, url: string, payload?: unknown) {
    return app.inject({ method, url, headers: { authorization: 'Bearer machine-token' }, ...(payload == null ? {} : { payload }) })
  }
})
