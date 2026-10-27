// @covers open-source/packages/server/src/routes/room-invite-browser.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExchange,
  mockBootstrap,
  mockEntryState,
  mockJoin,
  mockBroadcast,
  mockPrisma,
  mockScopedSession,
  mockVerifyPhone,
  mockBindApplicant,
  mockReadApplicant,
  mockClearApplicant,
} = vi.hoisted(() => ({
  mockExchange: vi.fn(),
  mockBootstrap: vi.fn(),
  mockEntryState: vi.fn(),
  mockJoin: vi.fn(),
  mockBroadcast: vi.fn(),
  mockPrisma: { device: { findUnique: vi.fn() } },
  mockScopedSession: vi.fn(),
  mockVerifyPhone: vi.fn(),
  mockBindApplicant: vi.fn(),
  mockReadApplicant: vi.fn(),
  mockClearApplicant: vi.fn(),
}))

const identities = vi.hoisted(() => ({ find: vi.fn(), remember: vi.fn() }))
vi.mock('../services/room-browser-identity.js', async () => ({
  ...(await vi.importActual('../services/room-browser-identity.js')),
  findRoomBrowserIdentity: identities.find,
  rememberRoomBrowserIdentity: identities.remember,
}))
vi.mock('../services/room-invite-browser.js', async () => {
  const actual = await vi.importActual<typeof import('../services/room-invite-browser.js')>(
    '../services/room-invite-browser.js',
  )
  return {
    ...actual,
    exchangeRoomInviteToken: mockExchange,
    getRoomInviteBootstrap: mockBootstrap,
    bindRoomInviteApplicant: mockBindApplicant,
    readRoomInviteApplicant: mockReadApplicant,
    clearRoomInviteApplicant: mockClearApplicant,
  }
})
vi.mock('../services/room-membership.js', () => ({
  getHumanRoomInviteEntryState: mockEntryState,
  joinRoomFromBrowserState: mockJoin,
}))
vi.mock('../services/room-events.js', () => ({ broadcastRoomEvent: mockBroadcast }))
vi.mock('../services/room-browser-session.js', () => ({
  authenticateRoomBrowserSession: vi.fn(),
  clearRoomBrowserCookie: () => 'shennian-room-dev=; Max-Age=0',
  createActiveRoomBrowserSession: mockScopedSession,
  exchangeRoomBrowserHandoff: vi.fn(),
  readRoomBrowserCookie: vi.fn(),
  roomBrowserClientLabel: () => 'Web browser',
  RoomBrowserSessionError: class RoomBrowserSessionError extends Error {},
  serializeRoomBrowserCookie: () => 'shennian-room-dev=scoped; Path=/; HttpOnly',
}))
vi.mock('../services/auth-session.js', () => ({
  verifyPhoneIdentity: mockVerifyPhone,
  AuthRouteError: class AuthRouteError extends Error {
    constructor(
      public readonly statusCode: number,
      message: string,
    ) {
      super(message)
    }
  },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) =>
    token === 'user-token' ? { userId: 'user_1', deviceId: 'device_1' } : null,
  ),
  verifyMachineToken: vi.fn(() => null),
}))

import { roomInviteBrowserRoutes } from '../routes/room-invite-browser.js'
import { RoomInviteBrowserError } from '../services/room-invite-browser.js'
import { RoomPolicyError } from '../services/room-policy.js'

const RAW_TOKEN = 'unit_invite_00000000000000000000000000000000'

describe('Room invite browser routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mockExchange.mockResolvedValue({
      browserState: 'b'.repeat(43),
      expiresAt: new Date('2026-08-23T00:15:00.000Z'),
      roomId: 'room_1',
    })
    mockBootstrap.mockResolvedValue({
      status: 'ready',
      room: { id: 'room_1', name: '空间' },
      expiresAt: '2026-08-23T00:15:00.000Z',
    })
    mockJoin.mockResolvedValue({
      outcome: 'pending_approval',
      roomId: 'room_1',
      joinRequest: { id: 'request_1' },
      idempotent: false,
    })
    mockEntryState.mockResolvedValue('can_join')
    mockPrisma.device.findUnique.mockResolvedValue({
      id: 'device_1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mockScopedSession.mockResolvedValue({
      token: 's'.repeat(43),
      expiresAt: new Date(Date.now() + 60_000),
    })
    mockVerifyPhone.mockResolvedValue({ id: 'user_1', name: '测试用户' })
    mockReadApplicant.mockResolvedValue(null)
    app = Fastify({ trustProxy: true })
    await app.register(roomInviteBrowserRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('rejects a remembered identity even for an explicit new-group join', async () => {
    identities.find.mockResolvedValue({ user: { id: 'user_1', name: 'User' } })
    const response = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/join',
      headers: { cookie: `shennian-room-invite-dev=${'b'.repeat(43)}` },
      payload: { roomId: 'room_1', message: 'Please let me join' },
    })
    expect(response.statusCode).toBe(401)
    expect(mockJoin).not.toHaveBeenCalled()
    expect(mockVerifyPhone).not.toHaveBeenCalled()
    expect(mockScopedSession).not.toHaveBeenCalled()
    expect(identities.remember).not.toHaveBeenCalled()
  })

  it('rejects remembered joining after expiration without consuming the invite', async () => {
    identities.find.mockResolvedValue(null)
    const result = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/join',
      payload: { roomId: 'room_1' },
    })
    expect(result.statusCode).toBe(401)
    expect(mockJoin).not.toHaveBeenCalled()
  })

  it('issues a scoped grant and ignores legacy rememberBrowser after phone joining', async () => {
    identities.remember.mockImplementation(async (_request, reply) => {
      reply.header('set-cookie', [
        'shennian-room-identity-dev=opaque; HttpOnly',
        'shennian-room-dev=; Max-Age=0',
      ])
    })
    mockJoin.mockResolvedValue({
      outcome: 'joined',
      roomId: 'room_1',
      membership: { id: 'member_1' },
      idempotent: false,
    })
    const result = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/verify-phone-and-join',
      payload: { phone: '+8613800000000', code: '123456', rememberBrowser: true, roomId: 'room_1' },
    })
    expect(result.statusCode).toBe(201)
    expect(result.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('shennian-room-dev=scoped'),
        expect.stringContaining('shennian-room-invite-dev=;'),
      ]),
    )
    expect(identities.remember).not.toHaveBeenCalled()
    expect(mockScopedSession).toHaveBeenCalledWith({
      roomId: 'room_1',
      userId: 'user_1',
      membershipId: 'member_1',
      clientLabel: 'Web browser',
      existingToken: undefined,
    })
    expect(result.json()).not.toHaveProperty('token')
  })

  it('retains approval policy errors after fresh phone verification', async () => {
    identities.find.mockResolvedValue({ user: { id: 'user_1' } })
    mockJoin.mockRejectedValue(
      new RoomPolicyError('join_message_required', 'Introduction required'),
    )
    const result = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/verify-phone-and-join',
      payload: { phone: '+8613800000000', code: '123456', roomId: 'room_1' },
    })
    expect(result.statusCode).toBe(400)
    expect(result.json()).toMatchObject({
      error: 'join_message_required',
      nextAction: { type: 'request_join_message' },
    })
    expect(mockScopedSession).not.toHaveBeenCalled()
  })

  it('verifies identity before asking a first-time applicant for an introduction', async () => {
    mockJoin.mockRejectedValue(
      new RoomPolicyError('join_message_required', 'Introduction required'),
    )
    const result = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/verify-phone',
      headers: { cookie: `shennian-room-invite-dev=${'b'.repeat(43)}` },
      payload: { phone: '+8613800000000', code: '123456', roomId: 'room_1' },
    })

    expect(result.statusCode).toBe(200)
    expect(result.json()).toMatchObject({ outcome: 'needs_application', roomId: 'room_1' })
    expect(mockBindApplicant).toHaveBeenCalledWith('b'.repeat(43), {
      userId: 'user_1',
      roomId: 'room_1',
    })
    expect(mockScopedSession).not.toHaveBeenCalled()
  })

  it('checks identity before reporting that joining is paused', async () => {
    mockJoin.mockRejectedValue(
      new RoomPolicyError('room_invite_unavailable', 'This Room invitation is unavailable.'),
    )
    mockBootstrap.mockResolvedValue({
      status: 'ready',
      room: { id: 'room_1', name: '空间', joinPolicy: 'closed' },
    })
    const result = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/verify-phone',
      headers: { cookie: `shennian-room-invite-dev=${'b'.repeat(43)}` },
      payload: { phone: '+8613800000000', code: '123456', roomId: 'room_1' },
    })

    expect(result.statusCode).toBe(200)
    expect(result.json()).toEqual({ outcome: 'join_closed', roomId: 'room_1' })
  })

  it('submits an application only after the invite state has a verified applicant', async () => {
    mockReadApplicant.mockResolvedValue({ userId: 'user_1', roomId: 'room_1' })
    const result = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/join',
      headers: { cookie: `shennian-room-invite-dev=${'b'.repeat(43)}` },
      payload: { roomId: 'room_1', message: '我是新成员，请通过。' },
    })

    expect(result.statusCode).toBe(202)
    expect(mockJoin).toHaveBeenCalledWith({
      browserState: 'b'.repeat(43),
      applicantUserId: 'user_1',
      expectedRoomId: 'room_1',
      message: '我是新成员，请通过。',
    })
    expect(mockClearApplicant).toHaveBeenCalledWith('b'.repeat(43))
    expect(mockVerifyPhone).not.toHaveBeenCalled()
  })

  it('sets a secure HttpOnly state and immediately redirects to a URL without invite Token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/spaces/room_1?invite=${RAW_TOKEN}`,
      headers: {
        host: 'app.shennian.net',
        'x-forwarded-proto': 'https',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
      },
    })

    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe('/spaces/room_1')
    expect(response.headers.location).not.toContain(RAW_TOKEN)
    expect(response.headers['set-cookie']).toContain('__Host-shennian-room-invite=')
    expect(response.headers['set-cookie']).toContain('HttpOnly')
    expect(response.headers['set-cookie']).toContain('Secure')
    expect(response.headers['set-cookie']).toContain('SameSite=Lax')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers.link).toContain(
      '<https://shennian.net/api/room-invites/agent-bootstrap>',
    )
    expect(response.headers.link).toContain('<https://shennian.net/install.md>')
    expect(response.headers.link).toContain('<https://shennian.net/skill.md>')
  })

  it('serves cacheable fixed Agent bootstrap metadata without invitation or Room content', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/room-invites/agent-bootstrap',
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('public, max-age=300')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.json()).toMatchObject({
      schemaVersion: 2,
      product: 'shennian',
      inviteKind: 'room',
      install: {
        documentationUrl: 'https://shennian.net/install.md',
        skillUrl: 'https://shennian.net/skill.md',
        npmPackage: 'shennian',
        minimumCliVersion: '0.3.2',
      },
      roomCli: {
        usage: 'skill+cli',
      },
    })
    expect(JSON.stringify(response.json())).not.toMatch(
      /空间|room_1|token|内部协作|integration|mcp|hook/,
    )
  })

  it('redirects an invalid invitation without echoing it into URL, headers, or body', async () => {
    mockExchange.mockRejectedValue(
      new RoomInviteBrowserError('room_invite_unavailable', 410, 'unavailable'),
    )
    const response = await app.inject({ method: 'GET', url: `/spaces/room_1?invite=${RAW_TOKEN}` })
    const visible = JSON.stringify({ headers: response.headers, body: response.body })

    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe('/spaces/room_1')
    expect(visible).not.toContain(RAW_TOKEN)
  })

  it('reads the opaque state only from a single HttpOnly cookie value', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/room-invites/bootstrap',
      headers: { cookie: `other=x; shennian-room-invite-dev=${'b'.repeat(43)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(mockBootstrap).toHaveBeenCalledWith('b'.repeat(43))
    expect(response.headers['referrer-policy']).toBe('no-referrer')
  })

  it('exchanges a native raw token for an authenticated short-lived join handle', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/room-invites/native/exchange',
      headers: { authorization: 'Bearer user-token' },
      payload: { roomId: 'room_1', token: RAW_TOKEN },
    })

    expect(response.statusCode).toBe(200)
    expect(mockExchange).toHaveBeenCalledWith(RAW_TOKEN, 'room_1')
    expect(mockBootstrap).toHaveBeenCalledWith('b'.repeat(43))
    expect(mockEntryState).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1' })
    expect(response.json()).toMatchObject({
      joinHandle: 'b'.repeat(43),
      invite: { status: 'ready', room: { id: 'room_1', name: '空间' } },
      entryState: 'can_join',
    })
    expect(response.headers['cache-control']).toContain('no-store')
  })

  it.each(['joined', 'pending_approval'] as const)(
    'returns the existing %s state without trying to join again',
    async (entryState) => {
      mockEntryState.mockResolvedValue(entryState)

      const response = await app.inject({
        method: 'POST',
        url: '/room-invites/native/exchange',
        headers: { authorization: 'Bearer user-token' },
        payload: { roomId: 'room_1', token: RAW_TOKEN },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ entryState, roomId: 'room_1' })
      expect(mockExchange).not.toHaveBeenCalled()
      expect(mockBootstrap).not.toHaveBeenCalled()
      expect(mockJoin).not.toHaveBeenCalled()
    },
  )

  it('joins natively through the opaque handle and broadcasts the pending request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/room-invites/native/join',
      headers: { authorization: 'Bearer user-token' },
      payload: { joinHandle: 'b'.repeat(43), message: '申请加入' },
    })

    expect(response.statusCode).toBe(202)
    expect(mockJoin).toHaveBeenCalledWith({
      browserState: 'b'.repeat(43),
      applicantUserId: 'user_1',
      message: '申请加入',
    })
    expect(response.json()).toMatchObject({
      outcome: 'pending_approval',
      roomId: 'room_1',
      joinRequestId: 'request_1',
    })
    expect(mockBroadcast).toHaveBeenCalledWith('room_1', {
      event: 'room.join_request.created',
      roomId: 'room_1',
      entityId: 'request_1',
    })
  })

  it('rejects duplicate invite cookies instead of choosing an attacker-controlled value', async () => {
    await app.inject({
      method: 'GET',
      url: '/room-invites/bootstrap',
      headers: {
        cookie: `shennian-room-invite-dev=${'a'.repeat(43)}; shennian-room-invite-dev=${'b'.repeat(43)}`,
      },
    })
    expect(mockBootstrap).toHaveBeenCalledWith(undefined)
  })

  it('submits the authenticated user through the opaque cookie and clears it afterwards', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/room-invites/join',
      headers: {
        authorization: 'Bearer user-token',
        cookie: `shennian-room-invite-dev=${'b'.repeat(43)}`,
      },
      payload: { message: '申请加入' },
    })

    expect(response.statusCode).toBe(202)
    expect(mockJoin).toHaveBeenCalledWith({
      browserState: 'b'.repeat(43),
      applicantUserId: 'user_1',
      message: '申请加入',
    })
    expect(response.json()).toMatchObject({
      outcome: 'pending_approval',
      roomId: 'room_1',
      joinRequestId: 'request_1',
      idempotent: false,
    })
    expect(response.headers['set-cookie']).toContain('Max-Age=0')
    expect(JSON.stringify(response.json())).not.toContain('b'.repeat(43))
    expect(mockBroadcast).toHaveBeenCalledWith('room_1', {
      event: 'room.join_request.created',
      roomId: 'room_1',
      entityId: 'request_1',
    })
  })

  it('verifies a formal user without issuing a Device session and returns only pending approval', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/verify-phone-and-join',
      headers: { cookie: `shennian-room-invite-dev=${'b'.repeat(43)}` },
      payload: { phone: '+8619900000002', code: '654321' },
    })
    expect(response.statusCode).toBe(202)
    expect(mockVerifyPhone).toHaveBeenCalledWith({ phone: '+8619900000002', code: '654321' })
    expect(mockScopedSession).not.toHaveBeenCalled()
    expect(response.json()).toMatchObject({ outcome: 'pending_approval', roomId: 'room_1' })
  })

  it('issues only a scoped Room cookie after phone verification joins an open Room', async () => {
    mockJoin.mockResolvedValueOnce({
      outcome: 'joined',
      roomId: 'room_1',
      membership: { id: 'member_1' },
      idempotent: false,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/room-invites/scoped/verify-phone-and-join',
      headers: { cookie: `shennian-room-invite-dev=${'b'.repeat(43)}` },
      payload: { phone: '+8619900000002', code: '654321' },
    })
    expect(response.statusCode).toBe(201)
    expect(mockScopedSession).toHaveBeenCalledWith({
      roomId: 'room_1',
      userId: 'user_1',
      membershipId: 'member_1',
      clientLabel: 'Web browser',
      existingToken: undefined,
    })
    expect(String(response.headers['set-cookie'])).toContain('shennian-room-dev=scoped')
    expect(response.json()).toMatchObject({
      outcome: 'joined',
      roomId: 'room_1',
      scopedPath: '/spaces/room_1',
    })
    expect(response.body).not.toMatch(/token|refreshToken|device/i)
  })

  it('clears an unavailable invite state instead of trapping the browser in a stale retry loop', async () => {
    mockJoin.mockRejectedValue(
      new RoomPolicyError('room_invite_unavailable', 'This Room invitation is unavailable.'),
    )

    const response = await app.inject({
      method: 'POST',
      url: '/room-invites/join',
      headers: {
        authorization: 'Bearer user-token',
        cookie: `shennian-room-invite-dev=${'b'.repeat(43)}`,
      },
      payload: {},
    })

    expect(response.statusCode).toBe(410)
    expect(response.headers['set-cookie']).toContain('Max-Age=0')
    expect(response.json()).toMatchObject({ error: 'room_invite_unavailable' })
  })
  it('keeps the invite state and asks for an introduction when approval requires one', async () => {
    mockJoin.mockRejectedValue(
      new RoomPolicyError('join_message_required', 'A short introduction is required.'),
    )

    const response = await app.inject({
      method: 'POST',
      url: '/room-invites/join',
      headers: {
        authorization: 'Bearer user-token',
        cookie: `shennian-room-invite-dev=${'b'.repeat(43)}`,
      },
      payload: {},
    })

    expect(response.statusCode).toBe(400)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.json()).toEqual({
      error: 'join_message_required',
      message: 'A short introduction is required.',
      nextAction: { type: 'request_join_message' },
    })
  })
})
