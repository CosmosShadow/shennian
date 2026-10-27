// @covers open-source/packages/server/src/services/room-browser-approval.ts

import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  roomFindUnique: vi.fn(),
  approvalCreate: vi.fn(),
  approvalDeleteMany: vi.fn(),
  approvalFindUnique: vi.fn(),
  approvalUpdateMany: vi.fn(),
  approvalUpdate: vi.fn(),
  membershipFindUnique: vi.fn(),
  createSession: vi.fn(),
  joinOpenRoom: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    room: { findUnique: mocks.roomFindUnique },
    roomBrowserApproval: {
      create: mocks.approvalCreate,
      deleteMany: mocks.approvalDeleteMany,
      findUnique: mocks.approvalFindUnique,
      updateMany: mocks.approvalUpdateMany,
      update: mocks.approvalUpdate,
    },
    roomMembership: { findUnique: mocks.membershipFindUnique },
  },
}))

vi.mock('../services/room-browser-session.js', () => ({
  createActiveRoomBrowserSession: mocks.createSession,
}))
vi.mock('../services/room-membership.js', () => ({ joinOpenRoomFromLink: mocks.joinOpenRoom }))

import {
  confirmRoomBrowserApproval,
  consumeRoomBrowserApproval,
  createRoomBrowserApproval,
  previewRoomBrowserApproval,
} from '../services/room-browser-approval.js'

const now = new Date('2026-09-01T00:00:00.000Z')
const rawToken = 'a'.repeat(43)
const browserSecret = 'b'.repeat(43)
const browserSecretHash = crypto.createHash('sha256').update(browserSecret).digest('hex')
const activeMembership = {
  id: 'member_1',
  status: 'active',
  room: { id: 'room_1', status: 'active' },
}

describe('Room browser mobile approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.roomFindUnique.mockResolvedValue({ name: 'Project group', status: 'active' })
    mocks.approvalCreate.mockResolvedValue({ id: 'approval_1' })
    mocks.approvalUpdateMany.mockResolvedValue({ count: 1 })
    mocks.approvalUpdate.mockResolvedValue({})
    mocks.membershipFindUnique.mockResolvedValue(activeMembership)
    mocks.createSession.mockResolvedValue({
      token: 's'.repeat(43),
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
    })
  })

  it('stores only a hash and produces a Room-bound QR payload', async () => {
    const result = await createRoomBrowserApproval('room_1', now)

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.browserSecret).not.toBe(result.token)
    expect(result.payload).not.toContain(result.browserSecret)
    expect(JSON.stringify(mocks.approvalCreate.mock.calls)).not.toContain(result.browserSecret)
    expect(result.payload).toBe(`room-access:room_1:${result.token}`)
    expect(result.roomName).toBe('Project group')
    expect(mocks.approvalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomId: 'room_1',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    })
    expect(JSON.stringify(mocks.approvalCreate.mock.calls)).not.toContain(result.token)
    expect(mocks.approvalDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    })
  })

  it('approves only an active human membership in the exact Room', async () => {
    mocks.approvalFindUnique.mockResolvedValue({
      id: 'approval_1', roomId: 'room_1', browserSecretHash, status: 'pending',
      expiresAt: new Date(now.getTime() + 60_000),
      approvedUserId: null, approvedMembershipId: null,
    })

    await expect(confirmRoomBrowserApproval({
      roomId: 'room_1', token: rawToken, userId: 'user_1', now,
    })).resolves.toEqual({ status: 'approved' })
    expect(mocks.membershipFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId_principalKey: { roomId: 'room_1', principalKey: 'human:user_1' } },
    }))
    expect(mocks.approvalUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        approvedUserId: 'user_1', approvedMembershipId: 'member_1', status: 'approved',
      }),
    }))
  })

  it('lets a signed-in nonmember join an open conversation from its QR', async () => {
    mocks.approvalFindUnique.mockResolvedValue({
      id: 'approval_1', roomId: 'room_1', browserSecretHash, status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    })
    mocks.membershipFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(activeMembership)
    mocks.roomFindUnique.mockResolvedValue({ name: 'Project group', status: 'active', joinPolicy: 'open' })
    expect(await previewRoomBrowserApproval({ roomId: 'room_1', token: rawToken, userId: 'user_1' })).toMatchObject({ willJoin: true })
    mocks.joinOpenRoom.mockResolvedValue({ membership: activeMembership, message: null, joined: true })
    await expect(confirmRoomBrowserApproval({ roomId: 'room_1', token: rawToken, userId: 'user_1', now }))
      .resolves.toMatchObject({ status: 'approved', joined: { joined: true } })
    expect(mocks.joinOpenRoom).toHaveBeenCalledWith({ roomId: 'room_1', userId: 'user_1', now })
  })

  it('rejects a token copied onto another Room URL', async () => {
    mocks.approvalFindUnique.mockResolvedValue({
      id: 'approval_1', roomId: 'room_1', browserSecretHash, status: 'pending',
      expiresAt: new Date(now.getTime() + 60_000),
    })
    await expect(confirmRoomBrowserApproval({
      roomId: 'room_2', token: rawToken, userId: 'user_1', now,
    })).rejects.toMatchObject({ code: 'room_browser_approval_unavailable' })
    expect(mocks.approvalUpdateMany).not.toHaveBeenCalled()
  })

  it('keeps the browser pending until the phone App approves', async () => {
    mocks.approvalFindUnique.mockResolvedValue({
      id: 'approval_1', roomId: 'room_1', browserSecretHash, status: 'pending',
      expiresAt: new Date(now.getTime() + 60_000),
    })
    await expect(consumeRoomBrowserApproval({
      roomId: 'room_1', token: rawToken, browserSecret, clientLabel: 'Safari · macOS', existingToken: 'e'.repeat(43), now,
    })).resolves.toEqual({ status: 'pending' })
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('atomically consumes approval into an independent scoped session', async () => {
    mocks.approvalFindUnique.mockResolvedValue({
      id: 'approval_1', roomId: 'room_1', browserSecretHash, status: 'approved',
      expiresAt: new Date(now.getTime() + 60_000),
      approvedUserId: 'user_1', approvedMembershipId: 'member_1',
    })

    await expect(consumeRoomBrowserApproval({
      roomId: 'room_1', token: rawToken, browserSecret, clientLabel: 'Safari · macOS', existingToken: 'e'.repeat(43), now,
    })).resolves.toMatchObject({ status: 'authorized', token: 's'.repeat(43) })
    expect(mocks.createSession).toHaveBeenCalledWith({
      roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', clientLabel: 'Safari · macOS', existingToken: 'e'.repeat(43), now,
    })
    expect(mocks.approvalUpdate).toHaveBeenCalledWith({
      where: { id: 'approval_1' },
      data: { status: 'consumed', consumedAt: now },
    })
  })
  it.each([undefined, 'x'.repeat(43)])('a copied QR cannot be consumed without the originating browser secret', async (secret) => {
    mocks.approvalFindUnique.mockResolvedValue({ id: 'approval_1', roomId: 'room_1', browserSecretHash, status: 'approved', expiresAt: new Date(now.getTime() + 60_000), approvedUserId: 'user_1', approvedMembershipId: 'member_1' })
    await expect(consumeRoomBrowserApproval({ roomId: 'room_1', token: rawToken, browserSecret: secret, now })).rejects.toMatchObject({ code: 'room_browser_approval_unavailable' })
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

})
