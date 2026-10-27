// @covers open-source/packages/server/src/services/room-invite-browser.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockRedis } = vi.hoisted(() => ({
  mockPrisma: {
    roomInvite: { findUnique: vi.fn() },
    roomInviteBrowserState: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  mockRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/redis.js', () => ({ redis: mockRedis }))

import {
  bindRoomInviteApplicant,
  clearRoomInviteApplicant,
  exchangeRoomInviteToken,
  getRoomInviteBootstrap,
  hashRoomInviteCapability,
  readRoomInviteApplicant,
} from '../services/room-invite-browser.js'

const now = new Date('2026-08-23T00:00:00.000Z')
const rawToken = 'unit_invite_00000000000000000000000000000000'
const browserState = 'a'.repeat(43)
const room = {
  id: 'room_1',
  name: '神念开发空间',
  description: '内部协作',
  visibility: 'private',
  joinPolicy: 'approval',
  status: 'active',
}
const invite = {
  id: 'invite_1',
  status: 'active',
  expiresAt: new Date(now.getTime() + 60_000),
  maxUses: 3,
  useCount: 0,
  roomId: 'room_1',
  room,
}

describe('Room invite browser state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.roomInvite.findUnique.mockResolvedValue(invite)
    mockPrisma.roomInviteBrowserState.create.mockResolvedValue({ id: 'state_1' })
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue({
      id: 'state_1',
      status: 'active',
      expiresAt: new Date(now.getTime() + 60_000),
      invite,
    })
    mockPrisma.roomInviteBrowserState.update.mockResolvedValue({})
    mockRedis.get.mockResolvedValue(null)
  })

  it('keeps the verified applicant bound only to the opaque Room invite state', async () => {
    await bindRoomInviteApplicant(browserState, { userId: 'user_1', roomId: 'room_1' })
    const key = `room-invite-applicant:${hashRoomInviteCapability(browserState)}`
    expect(mockRedis.set).toHaveBeenCalledWith(
      key,
      JSON.stringify({ userId: 'user_1', roomId: 'room_1' }),
      'EX',
      900,
    )

    mockRedis.get.mockResolvedValue(JSON.stringify({ userId: 'user_1', roomId: 'room_1' }))
    await expect(readRoomInviteApplicant(browserState, 'room_1')).resolves.toEqual({
      userId: 'user_1',
      roomId: 'room_1',
    })
    await expect(readRoomInviteApplicant(browserState, 'room_2')).resolves.toBeNull()

    await clearRoomInviteApplicant(browserState)
    expect(mockRedis.del).toHaveBeenCalledWith(key)
  })

  it('stores only hashes and exchanges the invite for a different random browser capability', async () => {
    const result = await exchangeRoomInviteToken(rawToken, 'room_1', now)

    expect(mockPrisma.roomInvite.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashRoomInviteCapability(rawToken) },
      include: { room: true },
    })
    expect(result.browserState).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.browserState).not.toBe(rawToken)
    expect(mockPrisma.roomInviteBrowserState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stateHash: hashRoomInviteCapability(result.browserState),
        inviteId: 'invite_1',
      }),
    })
    expect(JSON.stringify(mockPrisma.roomInviteBrowserState.create.mock.calls)).not.toContain(
      rawToken,
    )
  })

  it('returns token-free bootstrap metadata and revalidates the invitation every time', async () => {
    const result = await getRoomInviteBootstrap(browserState, now)

    expect(mockPrisma.roomInviteBrowserState.findUnique).toHaveBeenCalledWith({
      where: { stateHash: hashRoomInviteCapability(browserState) },
      include: { invite: { include: { room: true } } },
    })
    expect(result).toMatchObject({ status: 'ready', room: { id: 'room_1', name: '神念开发空间' } })
    expect(JSON.stringify(result)).not.toContain(browserState)
    expect(JSON.stringify(result)).not.toContain(rawToken)
  })

  it('rejects an invitation when the URL Room does not match the Token Room', async () => {
    await expect(exchangeRoomInviteToken(rawToken, 'room_2', now)).rejects.toMatchObject({
      code: 'room_invite_unavailable',
    })
    expect(mockPrisma.roomInviteBrowserState.create).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'revoked', patch: { status: 'revoked' } },
    { label: 'expired', patch: { expiresAt: new Date(now.getTime() - 1) } },
    { label: 'used up', patch: { maxUses: 1, useCount: 1 } },
    { label: 'closed Room', patch: { room: { ...room, status: 'archived' } } },
  ])('rejects an invitation that is $label', async ({ patch }) => {
    mockPrisma.roomInvite.findUnique.mockResolvedValue({ ...invite, ...patch })
    await expect(exchangeRoomInviteToken(rawToken, 'room_1', now)).rejects.toMatchObject({
      code: 'room_invite_unavailable',
    })
    expect(mockPrisma.roomInviteBrowserState.create).not.toHaveBeenCalled()
  })

  it('stops an existing browser state immediately after its invitation is revoked', async () => {
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue({
      id: 'state_1',
      status: 'active',
      expiresAt: new Date(now.getTime() + 60_000),
      invite: { ...invite, status: 'revoked' },
    })
    await expect(getRoomInviteBootstrap(browserState, now)).rejects.toMatchObject({
      code: 'room_invite_unavailable',
    })
    expect(mockPrisma.roomInviteBrowserState.update).not.toHaveBeenCalled()
  })
})
