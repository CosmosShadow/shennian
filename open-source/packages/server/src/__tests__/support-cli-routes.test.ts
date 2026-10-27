// @covers open-source/packages/server/src/routes/support-cli.ts
// @covers open-source/packages/server/src/services/support-contact.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    roomMembership: { findUnique: vi.fn() },
    roomMessage: { findMany: vi.fn() },
  },
  resolveOfficialRoom: vi.fn(),
  exchange: vi.fn(),
  join: vi.fn(),
  sendMessage: vi.fn(),
  broadcast: vi.fn(),
  authorReadAdvanced: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: FastifyInstance) => {
    app.decorateRequest('userId', '')
    app.decorateRequest('machineId', '')
    app.decorateRequest('deviceId', '')
  },
  requireUserOrMachineAuth: async (request: {
    headers: { authorization?: string }
    userId: string
    machineId: string
  }) => {
    request.userId = 'user_1'
    request.machineId = request.headers.authorization === 'Bearer machine-token' ? 'machine_1' : ''
  },
  requireActivePlan: async () => {},
}))
vi.mock('../lib/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/official-room.js', () => ({
  resolveOfficialRoom: mocks.resolveOfficialRoom,
  OfficialRoomUnavailableError: class OfficialRoomUnavailableError extends Error {},
}))
vi.mock('../services/room-invite-browser.js', () => ({
  exchangeRoomInviteToken: mocks.exchange,
  RoomInviteBrowserError: class RoomInviteBrowserError extends Error {
    constructor(
      public readonly code: string,
      public readonly statusCode: number,
      message: string,
    ) {
      super(message)
    }
  },
}))
vi.mock('../services/room-membership.js', () => ({
  joinRoomFromBrowserState: mocks.join,
}))
vi.mock('../services/room-core.js', () => ({ sendRoomTextMessage: mocks.sendMessage }))
vi.mock('../services/room-events.js', () => ({
  broadcastRoomEvent: mocks.broadcast,
  broadcastAuthorReadAdvanced: mocks.authorReadAdvanced,
}))

import { supportCliRoutes } from '../routes/support-cli.js'
import { OfficialRoomUnavailableError } from '../services/official-room.js'

const OFFICIAL_ROOM = {
  roomId: 'room_official',
  name: '神念官方交流群 1 群',
  inviteToken: 'i'.repeat(43),
  sequence: 1,
  humanCount: 3,
  maxHumanMembers: 100,
}
const MEMBERSHIP = {
  id: 'member_human',
  roomId: 'room_official',
  status: 'active',
  role: 'member',
  historyFromSequence: 10n,
}
const MESSAGE = {
  id: 'message_1',
  roomId: 'room_official',
  sequence: 11n,
  authorMembershipId: 'member_human',
  authorPrincipalTypeSnapshot: 'human',
  ownerUserIdSnapshot: 'user_1',
  authorDisplayNameSnapshot: '临时用户',
  ownerDisplayNameSnapshot: '临时用户',
  authorAvatarSnapshot: null,
  mentionSnapshots: [],
  kind: 'text',
  source: 'cli',
  text: '登录后一直提示需要重新配对',
  replyToMessageId: null,
  createdAt: new Date('2026-09-22T00:00:00.000Z'),
  editedAt: null,
  deletedAt: null,
  attachments: [],
  authorMembership: { displayAlias: '临时用户', status: 'active' },
}

describe('machine-authenticated support contact routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.resolveOfficialRoom.mockResolvedValue(OFFICIAL_ROOM)
    mocks.prisma.roomMembership.findUnique.mockResolvedValue(null)
    mocks.prisma.roomMessage.findMany.mockResolvedValue([MESSAGE])
    mocks.exchange.mockResolvedValue({ browserState: 'b'.repeat(43) })
    mocks.join.mockResolvedValue({
      outcome: 'joined',
      roomId: 'room_official',
      membership: MEMBERSHIP,
      idempotent: false,
    })
    mocks.sendMessage.mockResolvedValue({ message: MESSAGE, idempotent: false, authorReadAdvanced: false })
    app = Fastify()
    await app.register(supportCliRoutes, { prefix: '/support-cli' })
  })

  afterEach(async () => {
    await app.close()
  })

  async function machineRequest(method: string, url: string, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: { authorization: 'Bearer machine-token' },
      ...(payload == null ? {} : { payload }),
    })
  }

  it('rejects requests without machine authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/support-cli/status',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'machine_auth_required' })
  })

  it('reports not-joined status without joining the official Room', async () => {
    const response = await machineRequest('GET', '/support-cli/status')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      joined: false,
      room: { roomId: 'room_official', name: '神念官方交流群 1 群', canonicalUrl: expect.any(String) },
    })
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(mocks.join).not.toHaveBeenCalled()
  })

  it('reports joined status when an active membership already exists', async () => {
    mocks.prisma.roomMembership.findUnique.mockResolvedValue(MEMBERSHIP)
    const response = await machineRequest('GET', '/support-cli/status')
    expect(response.json()).toMatchObject({ joined: true })
  })

  it('returns a recoverable unavailable response when the official Room cannot resolve', async () => {
    mocks.resolveOfficialRoom.mockRejectedValue(new OfficialRoomUnavailableError())
    const response = await machineRequest('GET', '/support-cli/status')
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'official_room_unavailable' })
  })

  it('rejects an empty support question', async () => {
    const response = await machineRequest('POST', '/support-cli/ask', { text: '   ' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'support_text_required', message: expect.any(String) })
  })

  it('rejects a support question that is too long', async () => {
    const response = await machineRequest('POST', '/support-cli/ask', { text: 'x'.repeat(2001) })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('support_text_too_long')
  })

  it.each([
    'my token is Bearer sk-abcdefghijklmnop',
    'error at /Users/alice/projects/shennian/index.ts:42',
    'path is C:\\Users\\alice\\AppData\\secrets.json',
  ])('rejects a support question that carries sensitive data: %s', async (text) => {
    const response = await machineRequest('POST', '/support-cli/ask', { text })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('support_text_contains_sensitive_data')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('auto-joins the official Room on first contact and sends the message', async () => {
    const response = await machineRequest('POST', '/support-cli/ask', { text: '登录后一直提示需要重新配对' })

    expect(mocks.exchange).toHaveBeenCalledWith('i'.repeat(43), 'room_official')
    expect(mocks.join).toHaveBeenCalledWith({
      browserState: 'b'.repeat(43),
      applicantUserId: 'user_1',
    })
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room_official',
        authorMembershipId: 'member_human',
        text: '登录后一直提示需要重新配对',
        source: 'cli',
      }),
    )
    expect(mocks.broadcast).toHaveBeenCalled()
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      outcome: 'sent',
      joinedRoom: true,
      idempotent: false,
      room: { roomId: 'room_official' },
      message: { text: '登录后一直提示需要重新配对', source: 'cli' },
    })
    expect(response.body).not.toMatch(/inviteToken|browserState/)
  })

  it('does not re-join when the human is already an active member', async () => {
    mocks.prisma.roomMembership.findUnique.mockResolvedValue(MEMBERSHIP)
    const response = await machineRequest('POST', '/support-cli/ask', { text: '还是老问题' })
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(mocks.join).not.toHaveBeenCalled()
    expect(response.json()).toMatchObject({ joinedRoom: false })
  })

  it('surfaces a clear error when the official Room requires approval to join', async () => {
    mocks.join.mockResolvedValue({
      outcome: 'pending_approval',
      roomId: 'room_official',
      joinRequest: { id: 'request_1' },
      idempotent: false,
    })
    const response = await machineRequest('POST', '/support-cli/ask', { text: '需要帮助' })
    expect(response.statusCode).toBe(503)
    expect(response.json().error).toBe('support_room_pending_approval')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('refuses to read support replies before the human has joined', async () => {
    const response = await machineRequest('GET', '/support-cli/read')
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('support_room_not_joined')
  })

  it('reads recent replies once the human is a member', async () => {
    mocks.prisma.roomMembership.findUnique.mockResolvedValue(MEMBERSHIP)
    const response = await machineRequest('GET', '/support-cli/read')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      messages: [
        expect.objectContaining({ sequence: '11', text: '登录后一直提示需要重新配对', source: 'cli' }),
      ],
    })
    expect(mocks.prisma.roomMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roomId: 'room_official' }),
      }),
    )
  })

  it('rejects an invalid read limit', async () => {
    mocks.prisma.roomMembership.findUnique.mockResolvedValue(MEMBERSHIP)
    const response = await machineRequest('GET', '/support-cli/read?limit=0')
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_limit' })
  })

  it('rejects an ambiguous read cursor', async () => {
    mocks.prisma.roomMembership.findUnique.mockResolvedValue(MEMBERSHIP)
    const response = await machineRequest('GET', '/support-cli/read?before=5&after=1')
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'ambiguous_sequence_cursor' })
  })
})
