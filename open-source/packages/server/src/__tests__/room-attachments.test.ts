// @covers src/services/room-attachments.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockOss } = vi.hoisted(() => ({
  mockPrisma: {
    roomMembership: { findUnique: vi.fn() },
    roomAttachment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    roomAttachmentDeletionJob: { findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  mockOss: {
    signUploadUrl: vi.fn(() => 'https://private-oss.example/upload?signature=short'),
    signDownloadUrl: vi.fn(() => 'https://private-oss.example/download?signature=short'),
    headObjectMetadata: vi.fn(),
    getObjectBuffer: vi.fn(),
    deleteObjectIfExists: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/oss.js', () => mockOss)

import {
  completeRoomAttachment,
  getRoomAttachmentDownload,
  initializeRoomAttachment,
  processRoomAttachmentDeletionJobs,
  reclaimOrphanRoomAttachments,
  tombstoneExpiredRoomAttachments,
} from '../services/room-attachments.js'

const membership = {
  id: 'human_1',
  status: 'active',
  historyFromSequence: 2n,
  room: { status: 'active' },
}
const FILE_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
const attachment = {
  id: 'attachment_1',
  uploadIntentId: 'intent_1',
  roomId: 'room_1',
  uploaderMembershipId: 'human_1',
  mediaKind: 'file',
  status: 'pending',
  objectKey: 'rooms/room_1/attachments/attachment_1/original',
  previewObjectKey: null,
  originalName: 'note.txt',
  safeName: 'note.txt',
  mimeType: 'text/plain',
  byteSize: 5n,
  sha256: FILE_SHA,
  messageId: null,
  expiresAt: null,
  createdAt: new Date('2026-08-20T00:00:00.000Z'),
}

describe('Room attachment lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.roomMembership.findUnique.mockResolvedValue(membership)
    mockPrisma.roomAttachment.findUnique.mockResolvedValue(null)
    mockPrisma.roomAttachment.create.mockImplementation(async ({ data }: { data: object }) => ({
      ...attachment,
      ...data,
    }))
    mockPrisma.roomAttachment.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...attachment,
      ...data,
    }))
    mockPrisma.roomAttachment.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomAttachment.findMany.mockResolvedValue([])
    mockPrisma.roomAttachmentDeletionJob.findMany.mockResolvedValue([])
    mockPrisma.roomAttachmentDeletionJob.upsert.mockResolvedValue({})
    mockOss.headObjectMetadata.mockResolvedValue({
      byteSize: 5,
      contentType: 'text/plain',
      sha256: FILE_SHA,
    })
    mockOss.getObjectBuffer.mockResolvedValue({
      buffer: Buffer.from('hello'),
      mimeType: 'text/plain',
    })
    mockOss.deleteObjectIfExists.mockResolvedValue(undefined)
  })

  it('creates a retry-safe private upload capability without exposing objectKey', async () => {
    const result = await initializeRoomAttachment({
      roomId: 'room_1',
      userId: 'user_1',
      clientUploadId: 'upload_1',
      originalName: 'note.txt',
      mediaKind: 'file',
      mimeType: 'text/plain',
      byteSize: 5,
      sha256: FILE_SHA,
    })
    expect(result).toMatchObject({
      attachment: { roomId: 'room_1', name: 'note.txt', status: 'pending' },
      upload: { method: 'PUT', headers: { 'x-oss-meta-sha256': FILE_SHA } },
      idempotent: false,
    })
    expect(JSON.stringify(result)).not.toContain('objectKey')
    expect(mockPrisma.roomAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          objectKey: expect.stringMatching(/^rooms\/room_1\/attachments\//),
        }),
      }),
    )
  })

  it('HEAD-verifies size, MIME and checksum before making an upload ready', async () => {
    mockPrisma.roomAttachment.findUnique.mockResolvedValue(attachment)
    const result = await completeRoomAttachment({
      roomId: 'room_1',
      attachmentId: 'attachment_1',
      userId: 'user_1',
    })
    expect(result).toMatchObject({ attachment: { status: 'ready' }, idempotent: false })
    expect(mockPrisma.roomAttachment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ready',
          readyAt: expect.any(Date),
          expiresAt: expect.any(Date),
        }),
      }),
    )

    mockOss.headObjectMetadata.mockResolvedValue({
      byteSize: 6,
      contentType: 'text/plain',
      sha256: FILE_SHA,
    })
    await expect(
      completeRoomAttachment({ roomId: 'room_1', attachmentId: 'attachment_1', userId: 'user_1' }),
    ).rejects.toMatchObject({ code: 'room_attachment_verification_failed' })
    expect(mockPrisma.roomAttachment.update).toHaveBeenLastCalledWith({
      where: { id: 'attachment_1' },
      data: { status: 'rejected' },
    })
  })

  it('defaults new attachments to 30 days and never signs beyond expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T00:00:00.000Z'))
    const previousRetention = process.env.ROOM_ATTACHMENT_RETENTION_DAYS
    delete process.env.ROOM_ATTACHMENT_RETENTION_DAYS
    try {
      mockPrisma.roomAttachment.findUnique.mockResolvedValue(attachment)
      await completeRoomAttachment({
        roomId: 'room_1',
        attachmentId: 'attachment_1',
        userId: 'user_1',
      })
      expect(mockPrisma.roomAttachment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expiresAt: new Date('2026-10-07T00:00:00.000Z') }),
        }),
      )

      mockPrisma.roomAttachment.findUnique.mockResolvedValue({
        ...attachment,
        status: 'ready',
        expiresAt: new Date('2026-09-07T00:00:20.000Z'),
        message: { roomId: 'room_1', sequence: 2n, deletedAt: null },
      })
      await getRoomAttachmentDownload({
        roomId: 'room_1',
        attachmentId: 'attachment_1',
        userId: 'user_1',
      })
      expect(mockOss.signDownloadUrl).toHaveBeenLastCalledWith(attachment.objectKey, 20)
    } finally {
      if (previousRetention === undefined) delete process.env.ROOM_ATTACHMENT_RETENTION_DAYS
      else process.env.ROOM_ATTACHMENT_RETENTION_DAYS = previousRetention
      vi.useRealTimers()
    }
  })

  it('issues a short download only for a committed attachment in readable history', async () => {
    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      ...attachment,
      status: 'ready',
      expiresAt: new Date('2099-01-01'),
      message: { roomId: 'room_1', sequence: 2n, deletedAt: null },
    })
    const result = await getRoomAttachmentDownload({
      roomId: 'room_1',
      attachmentId: 'attachment_1',
      userId: 'user_1',
    })
    expect(result.downloadUrl).toContain('signature=short')
    expect(result).not.toHaveProperty('objectKey')
    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      ...attachment,
      status: 'ready',
      message: { roomId: 'room_1', sequence: 1n, deletedAt: null },
    })
    await expect(
      getRoomAttachmentDownload({
        roomId: 'room_1',
        attachmentId: 'attachment_1',
        userId: 'user_1',
      }),
    ).rejects.toMatchObject({ code: 'room_attachment_unavailable' })
  })

  it('keeps historical attachments readable only through an inactive membership ceiling', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      ...membership,
      status: 'removed',
      historyThroughSequence: 8n,
    })
    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      ...attachment,
      status: 'ready',
      expiresAt: new Date('2099-01-01'),
      message: { roomId: 'room_1', sequence: 8n, deletedAt: null },
    })
    await expect(getRoomAttachmentDownload({
      roomId: 'room_1',
      attachmentId: 'attachment_1',
      userId: 'user_1',
    })).resolves.toMatchObject({ attachmentId: 'attachment_1' })

    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      ...attachment,
      status: 'ready',
      expiresAt: new Date('2099-01-01'),
      message: { roomId: 'room_1', sequence: 9n, deletedAt: null },
    })
    await expect(getRoomAttachmentDownload({
      roomId: 'room_1',
      attachmentId: 'attachment_1',
      userId: 'user_1',
    })).rejects.toMatchObject({ code: 'room_attachment_unavailable' })
  })

  it('tombstones expired and orphaned records before enqueueing deletion jobs', async () => {
    mockPrisma.roomAttachment.findMany.mockResolvedValue([attachment])
    await expect(tombstoneExpiredRoomAttachments(new Date('2026-08-23T00:00:00Z'))).resolves.toBe(1)
    expect(mockPrisma.roomAttachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'expired' }),
      }),
    )
    expect(mockPrisma.roomAttachmentDeletionJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ objectKey: attachment.objectKey, status: 'pending' }),
      }),
    )

    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.roomAttachment.findMany.mockResolvedValue([attachment])
    mockPrisma.roomAttachment.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomAttachmentDeletionJob.upsert.mockResolvedValue({})
    await expect(reclaimOrphanRoomAttachments(new Date('2026-08-23T00:00:00Z'))).resolves.toBe(1)
    expect(mockPrisma.roomAttachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'deleted' }),
      }),
    )
  })

  it('retries deletion jobs and treats missing OSS objects as successful cleanup', async () => {
    mockPrisma.roomAttachmentDeletionJob.findMany.mockResolvedValue([
      { id: 'job_1', objectKey: attachment.objectKey },
    ])
    mockPrisma.roomAttachmentDeletionJob.update.mockResolvedValue({})
    await expect(processRoomAttachmentDeletionJobs()).resolves.toEqual({ processed: 1, failed: 0 })
    expect(mockOss.deleteObjectIfExists).toHaveBeenCalledWith(attachment.objectKey)
    expect(mockPrisma.roomAttachmentDeletionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed', attempts: { increment: 1 } }),
      }),
    )
  })
})
