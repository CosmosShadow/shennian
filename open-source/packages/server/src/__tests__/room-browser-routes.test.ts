// @covers open-source/packages/server/src/routes/room-browser.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticate,
  mockExchange,
  mockAttachmentDownload,
  mockInitializeAttachment,
  mockCompleteAttachment,
  mockSendMessage,
  mockAuthorReadAdvanced,
  mockCreateApproval,
  mockConsumeApproval,
  mockFindMemberships,
  mockFindMessages,
  mockCanonicalInvite,
  mockJoinOpenRoom,
  mockRoomFindUnique,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockExchange: vi.fn(),
  mockAttachmentDownload: vi.fn(),
  mockInitializeAttachment: vi.fn(),
  mockCompleteAttachment: vi.fn(),
  mockSendMessage: vi.fn(),
  mockAuthorReadAdvanced: vi.fn(),
  mockCreateApproval: vi.fn(),
  mockConsumeApproval: vi.fn(),
  mockFindMemberships: vi.fn(),
  mockFindMessages: vi.fn(),
  mockCanonicalInvite: vi.fn(),
  mockJoinOpenRoom: vi.fn(),
  mockRoomFindUnique: vi.fn(),
}))

const identityMocks = vi.hoisted(() => ({ nickname: vi.fn(), user: vi.fn(), remember: vi.fn(), find: vi.fn(), logout: vi.fn(), phone: vi.fn(), membership: vi.fn(), scoped: vi.fn(), list: vi.fn(), device: vi.fn() }))
vi.mock('../services/room-browser-identity.js', async () => ({
  ...await vi.importActual('../services/room-browser-identity.js'),
  rememberRoomBrowserIdentity: identityMocks.remember,
  findRoomBrowserIdentity: identityMocks.find,
  logoutRoomBrowser: identityMocks.logout,
}))
vi.mock('../services/nickname-setup.js', () => ({ offerScopedNicknameSetup: identityMocks.nickname }))
vi.mock('../services/jwt.js', () => ({ verifyToken: (token: string) => token === 'account-token' ? { userId: 'user_1', deviceId: 'device_1' } : null, verifyMachineToken: () => null }))
vi.mock('../services/auth-session.js', () => ({
  verifyPhoneIdentity: identityMocks.phone,
  AuthRouteError: class AuthRouteError extends Error {},
}))
vi.mock('../services/room-browser-session.js', async () => {
  const actual = await vi.importActual<typeof import('../services/room-browser-session.js')>(
    '../services/room-browser-session.js',
  )
  return {
    ...actual,
    authenticateRoomBrowserSession: mockAuthenticate,
    createActiveRoomBrowserSession: identityMocks.scoped,
    exchangeRoomBrowserHandoff: mockExchange,
  }
})
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: identityMocks.user },
    roomMembership: { findMany: mockFindMemberships, findUnique: identityMocks.membership },
    room: { findUnique: mockRoomFindUnique },
    roomMessage: { findMany: mockFindMessages },
    roomBrowserSession: { findMany: identityMocks.list },
    device: { findUnique: identityMocks.device },
  },
}))
vi.mock('../services/room-attachments.js', () => ({
  getRoomAttachmentDownload: mockAttachmentDownload,
  initializeRoomAttachmentForMembership: mockInitializeAttachment,
  completeRoomAttachmentForMembership: mockCompleteAttachment,
}))
vi.mock('../services/room-core.js', () => ({ sendRoomTextMessage: mockSendMessage }))
vi.mock('../services/room-membership.js', () => ({ getCanonicalRoomInvite: mockCanonicalInvite, joinOpenRoomFromLink: mockJoinOpenRoom }))
vi.mock('../services/room-events.js', () => ({
  broadcastRoomEvent: vi.fn(),
  broadcastRoomMessageRecord: vi.fn(),
  broadcastAuthorReadAdvanced: mockAuthorReadAdvanced,
}))
vi.mock('../services/room-browser-approval.js', () => ({
  createRoomBrowserApproval: mockCreateApproval,
  consumeRoomBrowserApproval: mockConsumeApproval,
  confirmRoomBrowserApproval: vi.fn().mockResolvedValue({ status: 'approved' }),
  previewRoomBrowserApproval: vi.fn().mockResolvedValue({ roomName: 'Project group', expiresAt: new Date(Date.now() + 180_000).toISOString() }),
  RoomBrowserApprovalError: class RoomBrowserApprovalError extends Error {},
}))

import { roomBrowserRoutes } from '../routes/room-browser.js'
describe('Room browser routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    identityMocks.user.mockResolvedValue(null)
    identityMocks.nickname.mockResolvedValue(undefined)
    identityMocks.device.mockResolvedValue({ id: 'device_1', tokenExpiry: new Date(Date.now() + 60_000), lastActiveAt: new Date() })
    app = Fastify()
    await app.register(roomBrowserRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('never accepts a Room cookie as account authentication for the phone authorization list', async () => {
    const result = await app.inject({ method: 'GET', url: '/room-browser/authorizations', headers: { cookie: `shennian-room-dev-room_1=${'s'.repeat(43)}` } })
    expect(result.statusCode).toBe(401)
    expect(identityMocks.list).not.toHaveBeenCalled()
  })

  it('lists only the authenticated user’s unexpired explicit grants without exposing credentials', async () => {
    identityMocks.list.mockResolvedValue([{ id: 's1', roomId: 'room_1', expiresAt: new Date('2027-01-01T00:00:00Z') }])
    const result = await app.inject({ method: 'GET', url: '/room-browser/authorizations', headers: { authorization: 'Bearer account-token' } })
    expect(result.statusCode).toBe(200)
    expect(identityMocks.list).toHaveBeenCalledWith({
      where: { userId: 'user_1', authorizationVersion: 2, identityId: null, status: 'active', expiresAt: { gt: expect.any(Date) }, membership: { status: 'active', principalType: 'human', userId: 'user_1' }, room: { status: 'active' } },
      select: { id: true, roomId: true, expiresAt: true },
    })
    expect(result.json()).toEqual({ sessions: [{ id: 's1', roomId: 'room_1', expiresAt: '2027-01-01T00:00:00.000Z' }] })
    expect(result.body).not.toMatch(/token|secret|cookie/i)
  })

  it('refuses legacy automatic scan approval and requires an explicit phone confirmation', async () => {
    const headers = { authorization: 'Bearer account-token' }
    const preview = await app.inject({ method: 'POST', url: '/room-browser/room_1/qr/preview', headers, payload: { token: 'a'.repeat(43) } })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().roomName).toBe('Project group')
    const legacy = await app.inject({ method: 'POST', url: '/room-browser/room_1/qr/confirm', headers, payload: { token: 'a'.repeat(43) } })
    expect(legacy.statusCode).toBe(409)
    const confirmed = await app.inject({ method: 'POST', url: '/room-browser/room_1/qr/confirm', headers, payload: { token: 'a'.repeat(43), confirmed: true } })
    expect(confirmed.statusCode).toBe(200)
    expect(identityMocks.scoped).not.toHaveBeenCalled()
  })

  it('ignores legacy rememberBrowser and grants only the verified group', async () => {
    identityMocks.phone.mockResolvedValue({ id: 'user_1', name: 'User' })
    identityMocks.membership.mockResolvedValue({ id: 'member_1', status: 'active', room: { status: 'active' } })
    identityMocks.scoped.mockResolvedValue({ token: 's'.repeat(43), expiresAt: new Date(Date.now() + 60_000) })
    const result = await app.inject({ method: 'POST', url: '/room-browser/room_1/scoped/verify-phone', payload: { phone: '+8613800000000', code: '123456', rememberBrowser: true } })
    expect(result.statusCode).toBe(200)
    expect(identityMocks.remember).not.toHaveBeenCalled()
    expect(identityMocks.scoped).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', clientLabel: 'Web browser', existingToken: undefined })
    expect(result.headers['set-cookie']).toContain('shennian-room-dev-room_1=')
    expect(result.headers['cache-control']).toContain('no-store')
  })

  it('preserves old phone clients as single-room sessions without broadening authority', async () => {
    identityMocks.phone.mockResolvedValue({ id: 'user_1', name: 'User' })
    identityMocks.membership.mockResolvedValue({ id: 'member_1', status: 'active', room: { status: 'active' } })
    identityMocks.scoped.mockResolvedValue({ token: 's'.repeat(43), expiresAt: new Date(Date.now() + 60_000) })
    const result = await app.inject({ method: 'POST', url: '/room-browser/room_1/scoped/verify-phone',
      payload: { phone: '+8613800000000', code: '123456' } })
    expect(result.statusCode).toBe(200)
    expect(identityMocks.remember).not.toHaveBeenCalled()
    expect(identityMocks.scoped).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', clientLabel: 'Web browser', existingToken: undefined })
  })

  it('joins an open conversation when a new visitor verifies their phone from its shared link', async () => {
    identityMocks.phone.mockImplementation(async (_input, beforeConsume) => {
      await beforeConsume(null)
      return { id: 'user_1', name: 'User' }
    })
    identityMocks.membership.mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'member_1', status: 'active', room: { status: 'active' } })
    mockRoomFindUnique.mockResolvedValue({ status: 'active', joinPolicy: 'open' })
    mockJoinOpenRoom.mockResolvedValue({ membership: { id: 'member_1' }, joined: true, message: null })
    identityMocks.scoped.mockResolvedValue({ token: 's'.repeat(43), expiresAt: new Date(Date.now() + 60_000) })

    const result = await app.inject({ method: 'POST', url: '/room-browser/room_1/scoped/verify-phone',
      payload: { phone: '+8613800000000', code: '123456' } })
    expect(result.statusCode).toBe(200)
    expect(mockJoinOpenRoom).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1' })
    expect(identityMocks.scoped).toHaveBeenCalledWith(expect.objectContaining({ membershipId: 'member_1' }))
  })

  it('returns minimal identity state and logout clears both kinds of cookies', async () => {
    identityMocks.find.mockResolvedValue({ user: { id: 'user_1', name: 'User' }, expiresAt: new Date('2026-09-18T00:00:00Z') })
    const result = await app.inject({ method: 'GET', url: '/room-browser/identity' })
    expect(result.json()).toEqual({ user: null, expiresAt: null, scopedOnly: true })
    const logout = await app.inject({ method: 'POST', url: '/room-browser/logout', headers: { 'x-shennian-room-id': 'room_1' } })
    expect(logout.statusCode).toBe(200)
    expect(identityMocks.logout).toHaveBeenCalledOnce()
    const cookies = logout.headers['set-cookie'] as string[]
    expect(cookies).toHaveLength(3)
    expect(cookies.every(value => value.includes('Max-Age=0'))).toBe(true)
  })

  it('blocks untrusted origins before cookie reads, login or logout', async () => {
    for (const [method, url] of [['GET', '/room-browser/identity'], ['POST', '/room-browser/logout'],
      ['POST', '/room-browser/room_1/scoped/verify-phone']] as const) {
      const result = await app.inject({ method, url, headers: { origin: 'https://evil.example' } })
      expect(result.statusCode).toBe(403)
    }
    expect(identityMocks.find).not.toHaveBeenCalled()
    expect(identityMocks.phone).not.toHaveBeenCalled()
    expect(identityMocks.logout).not.toHaveBeenCalled()
  })

  it('does not expose the retired token-only handoff route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/spaces/room-access/${'h'.repeat(43)}`,
    })
    expect(response.statusCode).toBe(404)
    expect(mockExchange).not.toHaveBeenCalled()
    expect(mockAuthenticate).not.toHaveBeenCalled()
  })

  it('returns the shared invitation through an authenticated scoped Room session', async () => {
    mockAuthenticate.mockResolvedValue({
      roomId: 'room_1', userId: 'user_1', membershipId: 'membership_1',
      room: { joinPolicy: 'approval' },
    })
    mockCanonicalInvite.mockResolvedValue({ rawToken: 'i'.repeat(43) })

    const response = await app.inject({
      method: 'GET',
      url: '/room-browser/invite-link',
      headers: {
        cookie: `shennian-room-dev=${'s'.repeat(43)}`,
        'x-shennian-room-id': 'room_1',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(mockCanonicalInvite).toHaveBeenCalledWith({ roomId: 'room_1', actorUserId: 'user_1' })
    expect(response.json()).toEqual({
      invite: {
        url: `http://localhost:8081/spaces/room_1?invite=${'i'.repeat(43)}`,
        joinPolicy: 'approval',
      },
    })
  })

  it('projects only the public Agent participation contract in the scoped bootstrap', async () => {
    mockAuthenticate.mockResolvedValue({
      roomId: 'room_1',
      userId: 'user_1',
      membershipId: 'membership_human',
      expiresAt: new Date('2026-09-01T01:00:00.000Z'),
      room: {
        id: 'room_1',
        name: 'Room',
        description: '',
        status: 'active',
        nextSequence: 0n,
      },
      membership: { historyFromSequence: 1n },
      user: { id: 'user_1', name: 'User' },
    })
    mockFindMessages.mockResolvedValue([])

    const joinedAt = new Date('2026-09-01T00:00:00.000Z')
    const human = {
      id: 'membership_human',
      principalType: 'human',
      ownerUserId: 'user_1',
      parentHumanMembershipId: null,
      displayAlias: 'User',
      role: 'owner',
      joinedAt,
      user: { id: 'user_1', avatarVersion: 0, avatarUpdatedAt: null },
      ownerUser: { id: 'user_1', name: 'User', avatarVersion: 0, avatarUpdatedAt: null },
      agentIdentity: null,
      binding: null,
    }
    const agent = (input: {
      id: string
      activationMode: 'auto_follow' | 'mention_only'
      paired: boolean
      online: boolean
    }) => ({
      id: input.id,
      principalType: 'agent',
      ownerUserId: 'user_1',
      parentHumanMembershipId: 'membership_human',
      displayAlias: input.id,
      role: 'member',
      joinedAt,
      user: null,
      ownerUser: { id: 'user_1', name: 'User', avatarVersion: 0, avatarUpdatedAt: null },
      agentIdentity: {
        id: `identity_${input.id}`,
        description: '',
        avatarVersion: 0,
        avatarUpdatedAt: null,
      },
      binding: {
        status: 'active',
        activationMode: input.activationMode,
        detachedReason: null,
        machine: { paired: input.paired, online: input.online },
        // These private values model data that must never enter the public response.
        machineId: 'machine_private',
        repairAction: 'retry',
      },
    })
    mockFindMemberships.mockResolvedValue([
      human,
      agent({ id: 'agent_auto', activationMode: 'auto_follow', paired: true, online: true }),
      agent({ id: 'agent_mention', activationMode: 'mention_only', paired: true, online: true }),
      agent({ id: 'agent_offline', activationMode: 'auto_follow', paired: false, online: false }),
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/room-browser/bootstrap',
      headers: {
        cookie: `shennian-room-dev=${'s'.repeat(43)}`,
        'x-shennian-room-id': 'room_1',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().browserLogoutAvailable).toBe(true)
    const members = response.json().members as Array<Record<string, unknown>>
    expect(members.find((member) => member.id === 'membership_human')).not.toHaveProperty(
      'agentParticipation',
    )
    expect(members.find((member) => member.id === 'agent_auto')).toMatchObject({
      agentParticipation: { activationMode: 'auto_follow', availability: 'available' },
    })
    expect(members.find((member) => member.id === 'agent_mention')).toMatchObject({
      agentParticipation: { activationMode: 'mention_only', availability: 'available' },
    })
    expect(members.find((member) => member.id === 'agent_offline')).toMatchObject({
      agentParticipation: { activationMode: 'auto_follow', availability: 'unavailable' },
    })
    for (const member of members) {
      expect(member).not.toHaveProperty('ownBinding')
      expect(member).not.toHaveProperty('repairAction')
      expect(member).not.toHaveProperty('machineId')
      expect(member).not.toHaveProperty('detachedReason')
      expect(JSON.stringify(member)).not.toContain('machine_private')
    }
  })

  it('creates an attachment download only inside the cookie-bound Room', async () => {
    mockAuthenticate.mockResolvedValue({
      roomId: 'room_1',
      userId: 'user_1',
      membershipId: 'membership_1',
    })
    mockAttachmentDownload.mockResolvedValue({
      attachmentId: 'ratt_1',
      downloadUrl: 'https://storage.example/signed',
    })

    const response = await app.inject({
      method: 'GET',
      url: '/room-browser/attachments/ratt_1/download',
      headers: {
        cookie: `shennian-room-dev=${'s'.repeat(43)}`,
        'x-shennian-room-id': 'room_1',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(mockAuthenticate).toHaveBeenCalledWith('s'.repeat(43), 'room_1', expect.any(Date))
    expect(mockAttachmentDownload).toHaveBeenCalledWith({
      roomId: 'room_1',
      attachmentId: 'ratt_1',
      userId: 'user_1',
    })
  })

  it('initializes and completes uploads for the cookie-bound membership', async () => {
    mockAuthenticate.mockResolvedValue({
      roomId: 'room_1',
      userId: 'user_1',
      membershipId: 'membership_1',
    })
    mockInitializeAttachment.mockResolvedValue({
      attachment: { id: 'ratt_1' },
      upload: { method: 'PUT', url: 'https://storage.example/upload' },
      idempotent: false,
    })
    mockCompleteAttachment.mockResolvedValue({
      attachment: {
        id: 'ratt_1',
        mediaKind: 'image',
        safeName: 'photo.png',
        mimeType: 'image/png',
        byteSize: 12n,
        sha256: 'a'.repeat(64),
        status: 'ready',
      },
      idempotent: false,
    })
    const headers = {
      cookie: `shennian-room-dev=${'s'.repeat(43)}`,
      'x-shennian-room-id': 'room_1',
    }

    const initialized = await app.inject({
      method: 'POST',
      url: '/room-browser/attachments/init',
      headers,
      payload: {
        clientUploadId: 'upload_1',
        name: 'photo.png',
        mediaKind: 'image',
        mimeType: 'image/png',
        byteSize: 12,
        sha256: 'a'.repeat(64),
      },
    })
    expect(initialized.statusCode).toBe(201)
    expect(mockInitializeAttachment).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_1',
      userId: 'user_1',
      originalName: 'photo.png',
    }), 'membership_1')

    const completed = await app.inject({
      method: 'POST',
      url: '/room-browser/attachments/ratt_1/complete',
      headers,
    })
    expect(completed.statusCode).toBe(200)
    expect(mockCompleteAttachment).toHaveBeenCalledWith({
      roomId: 'room_1',
      attachmentId: 'ratt_1',
    }, 'membership_1')
    expect(completed.json().attachment).toMatchObject({
      attachmentId: 'ratt_1',
      status: 'ready',
    })
  })

  it('offers optional nickname setup only after the single-Room phone session succeeds', async () => {
    const user = { id: 'user_1', name: '用户123', nameSetupRequired: true }
    const setup = { name: user.name, token: 'a'.repeat(64) }
    identityMocks.phone.mockResolvedValue(user)
    identityMocks.membership.mockResolvedValue({ id: 'member_1', status: 'active', room: { status: 'active' } })
    identityMocks.scoped.mockResolvedValue({ token: 's'.repeat(43), expiresAt: new Date(Date.now() + 60_000) })
    identityMocks.nickname.mockResolvedValue(setup)
    const result = await app.inject({ method: 'POST', url: '/room-browser/room_1/scoped/verify-phone',
      payload: { phone: '+8613800000000', code: '123456' } })
    expect(result.statusCode).toBe(200)
    expect(result.headers['set-cookie']).toContain('shennian-room-dev-room_1=')
    expect(result.json()).toEqual({ scopedPath: '/spaces/room_1', nicknameSetup: setup })
    expect(identityMocks.nickname).toHaveBeenCalledWith(user)
    expect(identityMocks.scoped.mock.invocationCallOrder[0]).toBeLessThan(identityMocks.nickname.mock.invocationCallOrder[0])
  })

  it('sends ready attachment ids and structured mentions through the scoped Room membership', async () => {
    mockAuthenticate.mockResolvedValue({
      roomId: 'room_1',
      userId: 'user_1',
      membershipId: 'membership_1',
    })
    mockSendMessage.mockResolvedValue({
      message: {
        id: 'message_1',
        roomId: 'room_1',
        sequence: 1n,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        text: '',
        kind: 'text',
        source: 'app',
        replyToMessageId: null,
        editedAt: null,
        deletedAt: null,
        authorMembership: { displayAlias: 'User', status: 'active' },
        authorMembershipId: 'membership_1',
        authorPrincipalTypeSnapshot: 'human',
        ownerUserIdSnapshot: 'user_1',
        authorDisplayNameSnapshot: 'User',
        ownerDisplayNameSnapshot: null,
        authorAvatarSnapshot: null,
        mentionSnapshots: [],
        attachments: [],
      },
      idempotent: false,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/room-browser/messages',
      headers: {
        cookie: `shennian-room-dev=${'s'.repeat(43)}`,
        'x-shennian-room-id': 'room_1',
      },
      payload: {
        clientMessageId: 'message_1',
        text: '@Agent 请处理',
        attachmentIds: ['ratt_1'],
        mentionMembershipIds: ['membership_agent'],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_1',
      authorMembershipId: 'membership_1',
      attachmentIds: ['ratt_1'],
      mentionMembershipIds: ['membership_agent'],
    }))
    expect(mockAuthorReadAdvanced).toHaveBeenCalledTimes(1)
  })

  it('creates and consumes a mobile approval without returning an account token', async () => {
    mockCreateApproval.mockResolvedValue({
      token: 'a'.repeat(43),
      payload: `room-access:room_1:${'a'.repeat(43)}`,
      browserSecret: 'b'.repeat(43),
      expiresAt: new Date('2026-09-01T00:03:00.000Z'),
      roomName: 'Project group',
    })
    mockConsumeApproval.mockResolvedValue({
      status: 'authorized',
      token: 's'.repeat(43),
      expiresAt: new Date(Date.now() + 60_000),
    })

    const created = await app.inject({
      method: 'POST',
      url: '/room-browser/room_1/qr/create',
    })
    expect(created.statusCode).toBe(200)
    expect(created.headers['set-cookie']).toContain('shennian-room-dev-approval-room_1=')
    expect(created.body).not.toContain('b'.repeat(43))
    expect(created.json()).toEqual({
      approvalToken: 'a'.repeat(43),
      payload: `room-access:room_1:${'a'.repeat(43)}`,
      expiresAt: '2026-09-01T00:03:00.000Z',
      roomName: 'Project group',
    })

    const consumed = await app.inject({
      method: 'POST',
      url: '/room-browser/room_1/qr/status',
      headers: { cookie: `shennian-room-dev-approval-room_1=${'b'.repeat(43)}` },
      payload: { token: 'a'.repeat(43) },
    })
    expect(consumed.statusCode).toBe(200)
    expect(consumed.json()).toEqual({
      status: 'authorized',
      scopedPath: '/spaces/room_1',
    })
    expect(consumed.headers['set-cookie']).toContain('shennian-room-dev-room_1=')
    expect(JSON.stringify(consumed.json())).not.toContain('s'.repeat(43))
  })
})
