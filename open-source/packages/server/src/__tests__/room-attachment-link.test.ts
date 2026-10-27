// @covers open-source/packages/server/src/services/room-attachment-link.ts

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockSignDownloadUrl } = vi.hoisted(() => ({
  mockPrisma: {
    roomBinding: { findUnique: vi.fn() },
    roomAttachment: { findUnique: vi.fn() },
  },
  mockSignDownloadUrl: vi.fn(() => 'https://oss.example/private?short=1'),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/oss.js', () => ({ signDownloadUrl: mockSignDownloadUrl }))

import {
  createRoomAttachmentLinkToken,
  redeemRoomAttachmentLink,
  verifyRoomAttachmentLinkToken,
} from '../services/room-attachment-link.js'
import { roomAttachmentLinkRoutes } from '../routes/room-attachment-links.js'

describe('Room Agent attachment links', () => {
  const now = new Date('2026-08-30T00:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('signs a binding-scoped link for up to 30 days and rejects tampering', () => {
    const result = createRoomAttachmentLinkToken({
      roomId: 'room_1',
      bindingId: 'binding_1',
      attachmentId: 'attachment_1',
      now,
    })
    expect(result.expiresAt).toBe('2026-09-29T00:00:00.000Z')
    expect(verifyRoomAttachmentLinkToken(result.token, now)).toMatchObject({
      roomId: 'room_1',
      bindingId: 'binding_1',
      attachmentId: 'attachment_1',
    })
    expect(verifyRoomAttachmentLinkToken(`${result.token}x`, now)).toBeNull()
    expect(verifyRoomAttachmentLinkToken(result.token, new Date(result.expiresAt))).toBeNull()
  })

  it('rechecks Binding and message access before issuing a short OSS redirect', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      id: 'binding_1',
      roomId: 'room_1',
      capabilityEpoch: 0,
      status: 'active',
      agentMembership: {
        status: 'active',
        historyFromSequence: 2n,
        room: { status: 'active' },
      },
    })
    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      id: 'attachment_1',
      roomId: 'room_1',
      status: 'ready',
      safeName: 'photo.jpg',
      objectKey: 'rooms/room_1/photo.jpg',
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
      message: { roomId: 'room_1', sequence: 2n, deletedAt: null },
    })
    const { token } = createRoomAttachmentLinkToken({
      roomId: 'room_1',
      bindingId: 'binding_1',
      attachmentId: 'attachment_1',
      now,
    })

    await expect(redeemRoomAttachmentLink(token, now)).resolves.toEqual({
      downloadUrl: 'https://oss.example/private?short=1',
      name: 'photo.jpg',
    })
    expect(mockSignDownloadUrl).toHaveBeenCalledWith('rooms/room_1/photo.jpg', 60)

    mockPrisma.roomBinding.findUnique.mockResolvedValueOnce({
      id: 'binding_1',
      roomId: 'room_1',
      capabilityEpoch: 0,
      status: 'detached',
      agentMembership: null,
    })
    await expect(redeemRoomAttachmentLink(token, now)).rejects.toMatchObject({
      code: 'room_attachment_unavailable',
    })
  })

  it('routes the full scoped capability beyond Fastify\'s default parameter limit', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      id: 'binding_123456789012345678901234',
      roomId: 'room_123456789012345678901234567',
      capabilityEpoch: 0,
      status: 'active',
      agentMembership: {
        status: 'active',
        historyFromSequence: 1n,
        room: { status: 'active' },
      },
    })
    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      id: 'attachment_123456789012345678901234567890123456',
      roomId: 'room_123456789012345678901234567',
      status: 'ready',
      safeName: 'photo.jpg',
      objectKey: 'rooms/room/photo.jpg',
      expiresAt: null,
      message: {
        roomId: 'room_123456789012345678901234567',
        sequence: 1n,
        deletedAt: null,
      },
    })
    const { token } = createRoomAttachmentLinkToken({
      roomId: 'room_123456789012345678901234567',
      bindingId: 'binding_123456789012345678901234',
      attachmentId: 'attachment_123456789012345678901234567890123456',
    })
    expect(token.length).toBeGreaterThan(100)

    const app = Fastify({ routerOptions: { maxParamLength: 512 } })
    await app.register(roomAttachmentLinkRoutes)
    const response = await app.inject({ method: 'GET', url: `/a/${token}` })
    await app.close()

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('https://oss.example/private?short=1')
  })

  it('invalidates an old-machine capability after the binding epoch advances', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      id: 'binding_1',
      roomId: 'room_1',
      status: 'active',
      capabilityEpoch: 2,
      agentMembership: {
        status: 'active',
        historyFromSequence: 1n,
        room: { status: 'active' },
      },
    })
    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      id: 'attachment_1',
      roomId: 'room_1',
      status: 'ready',
      safeName: 'photo.jpg',
      objectKey: 'rooms/room_1/photo.jpg',
      expiresAt: null,
      message: { roomId: 'room_1', sequence: 1n, deletedAt: null },
    })
    const { token } = createRoomAttachmentLinkToken({
      roomId: 'room_1',
      bindingId: 'binding_1',
      capabilityEpoch: 1,
      attachmentId: 'attachment_1',
      now,
    })

    await expect(redeemRoomAttachmentLink(token, now)).rejects.toMatchObject({
      code: 'room_attachment_unavailable',
    })
    expect(mockSignDownloadUrl).not.toHaveBeenCalled()
  })
})
