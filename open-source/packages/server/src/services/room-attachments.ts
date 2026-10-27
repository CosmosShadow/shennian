// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-attachments.test.ts

import crypto from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import {
  deleteObjectIfExists,
  getObjectBuffer,
  headObjectMetadata,
  signDownloadUrl,
  signUploadUrl,
} from '../lib/oss.js'
import { RoomPolicyError } from './room-policy.js'

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000
const DOWNLOAD_SECONDS = 60
const UPLOAD_SECONDS = 5 * 60
const SHA256 = /^[a-f0-9]{64}$/
const CLIENT_ID = /^[A-Za-z0-9_.:@-]{1,120}$/
const MEDIA_KINDS = new Set(['image', 'audio', 'file'])
const BLOCKED_EXTENSIONS =
  /\.(?:app|apk|bat|cmd|com|dll|dmg|exe|html?|iso|jar|js|mjs|msi|ps1|scr|sh|svg|vbs)$/i
const BLOCKED_MIME = /(?:javascript|html|svg|x-msdownload|x-sh|x-executable)/i

export type RoomAttachmentInitInput = {
  roomId: string
  userId: string
  clientUploadId: string
  originalName: string
  mediaKind: 'image' | 'audio' | 'file'
  mimeType: string
  byteSize: number
  sha256: string
}

export async function initializeRoomAttachment(input: RoomAttachmentInitInput) {
  const membership = await requireActiveHumanMembership(input.roomId, input.userId)
  return initializeRoomAttachmentForMembership(input, membership.id)
}

export async function initializeRoomAttachmentForMembership(
  input: RoomAttachmentInitInput,
  uploaderMembershipId: string,
) {
  const normalized = normalizeInit(input)
  const uploadIntentId = crypto
    .createHash('sha256')
    .update(`${uploaderMembershipId}\0${input.clientUploadId}`, 'utf8')
    .digest('hex')
  const existing = await prisma.roomAttachment.findUnique({ where: { uploadIntentId } })
  if (existing) {
    assertSameUpload(existing, normalized, uploaderMembershipId)
    return uploadResponse(existing, true)
  }
  const attachmentId = `ratt_${crypto.randomUUID()}`
  const objectKey = `rooms/${input.roomId}/attachments/${attachmentId}/original`
  try {
    const attachment = await prisma.roomAttachment.create({
      data: {
        id: attachmentId,
        uploadIntentId,
        roomId: input.roomId,
        uploaderMembershipId,
        mediaKind: normalized.mediaKind,
        status: 'pending',
        objectKey,
        originalName: normalized.originalName,
        safeName: normalized.safeName,
        mimeType: normalized.mimeType,
        byteSize: BigInt(normalized.byteSize),
        sha256: normalized.sha256,
        retentionClass: 'room_default',
      },
    })
    return uploadResponse(attachment, false)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await prisma.roomAttachment.findUnique({ where: { uploadIntentId } })
      if (winner) {
        assertSameUpload(winner, normalized, uploaderMembershipId)
        return uploadResponse(winner, true)
      }
    }
    throw error
  }
}

export async function completeRoomAttachment(input: {
  roomId: string
  attachmentId: string
  userId: string
}) {
  const membership = await requireActiveHumanMembership(input.roomId, input.userId)
  return completeRoomAttachmentForMembership(input, membership.id)
}

export async function completeRoomAttachmentForMembership(
  input: { roomId: string; attachmentId: string },
  uploaderMembershipId: string,
) {
  const attachment = await prisma.roomAttachment.findUnique({ where: { id: input.attachmentId } })
  assertOwnedAttachment(attachment, input.roomId, uploaderMembershipId)
  if (attachment.status === 'ready') return { attachment, idempotent: true }
  if (attachment.status !== 'pending' && attachment.status !== 'uploaded') {
    throw new RoomPolicyError('room_attachment_unavailable', 'Attachment cannot be completed.')
  }
  const object = await headObjectMetadata(attachment.objectKey)
  if (!object)
    throw new RoomPolicyError('room_attachment_upload_missing', 'Uploaded object was not found.')
  const downloaded = await getObjectBuffer(attachment.objectKey)
  const actualSha256 = downloaded
    ? crypto.createHash('sha256').update(downloaded.buffer).digest('hex')
    : null
  if (
    object.byteSize !== Number(attachment.byteSize) ||
    normalizeMime(object.contentType ?? '') !== normalizeMime(attachment.mimeType) ||
    downloaded?.buffer.byteLength !== Number(attachment.byteSize) ||
    normalizeMime(downloaded?.mimeType ?? '') !== normalizeMime(attachment.mimeType) ||
    actualSha256 !== attachment.sha256
  ) {
    await prisma.roomAttachment.update({
      where: { id: attachment.id },
      data: { status: 'rejected' },
    })
    throw new RoomPolicyError(
      'room_attachment_verification_failed',
      'Uploaded object metadata did not match.',
    )
  }
  const retentionDays = Math.max(
    1,
    Math.min(3650, Number(process.env.ROOM_ATTACHMENT_RETENTION_DAYS) || 30),
  )
  const now = new Date()
  const ready = await prisma.roomAttachment.update({
    where: { id: attachment.id },
    data: {
      status: 'ready',
      uploadedAt: now,
      readyAt: now,
      expiresAt: new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000),
    },
  })
  return { attachment: ready, idempotent: false }
}

export async function getRoomAttachmentDownload(input: {
  roomId: string
  attachmentId: string
  userId: string
}) {
  const membership = await requireReadableHumanMembership(input.roomId, input.userId)
  const attachment = await prisma.roomAttachment.findUnique({
    where: { id: input.attachmentId },
    include: { message: { select: { roomId: true, sequence: true, deletedAt: true } } },
  })
  if (
    !attachment ||
    attachment.roomId !== input.roomId ||
    attachment.status !== 'ready' ||
    !attachment.message ||
    attachment.message.roomId !== input.roomId ||
    attachment.message.deletedAt ||
    attachment.message.sequence < membership.historyFromSequence ||
    (membership.historyThroughSequence != null &&
      attachment.message.sequence > membership.historyThroughSequence) ||
    (attachment.expiresAt && attachment.expiresAt <= new Date())
  ) {
    throw new RoomPolicyError('room_attachment_unavailable', 'Attachment is unavailable.')
  }
  const now = new Date()
  const remainingSeconds = attachment.expiresAt
    ? Math.max(1, Math.floor((attachment.expiresAt.getTime() - now.getTime()) / 1_000))
    : DOWNLOAD_SECONDS
  const expiresInSeconds = Math.min(DOWNLOAD_SECONDS, remainingSeconds)
  return {
    attachmentId: attachment.id,
    name: attachment.safeName,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize.toString(),
    sha256: attachment.sha256,
    downloadUrl: signDownloadUrl(attachment.objectKey, expiresInSeconds),
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
  }
}

export async function tombstoneExpiredRoomAttachments(
  now = new Date(),
  limit = 200,
): Promise<number> {
  const candidates = await prisma.roomAttachment.findMany({
    where: {
      status: 'ready',
      expiresAt: { lte: now },
    },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  })
  for (const attachment of candidates) await tombstoneAttachment(attachment, 'expired', now)
  return candidates.length
}

export async function reclaimOrphanRoomAttachments(now = new Date(), limit = 200): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_AGE_MS)
  const candidates = await prisma.roomAttachment.findMany({
    where: {
      messageId: null,
      status: { in: ['pending', 'uploaded', 'ready', 'rejected'] },
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  for (const attachment of candidates) await tombstoneAttachment(attachment, 'deleted', now)
  return candidates.length
}

export async function processRoomAttachmentDeletionJobs(limit = 200): Promise<{
  processed: number
  failed: number
}> {
  const jobs = await prisma.roomAttachmentDeletionJob.findMany({
    where: { status: { in: ['pending', 'failed'] }, attempts: { lt: 10 } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  let failed = 0
  for (const job of jobs) {
    try {
      await deleteObjectIfExists(job.objectKey)
      await prisma.roomAttachmentDeletionJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          attempts: { increment: 1 },
          deletedAt: new Date(),
          lastError: null,
        },
      })
    } catch (error) {
      failed += 1
      await prisma.roomAttachmentDeletionJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.name.slice(0, 120) : 'delete_failed',
        },
      })
    }
  }
  return { processed: jobs.length, failed }
}

async function tombstoneAttachment(
  attachment: { id: string; objectKey: string; previewObjectKey: string | null },
  status: 'expired' | 'deleted',
  now: Date,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.roomAttachment.updateMany({
        where: { id: attachment.id, status: { notIn: ['expired', 'deleted'] } },
        data: { status, deletedAt: now },
      })
      const objects = [
        { objectKind: 'original', objectKey: attachment.objectKey },
        ...(attachment.previewObjectKey
          ? [{ objectKind: 'preview', objectKey: attachment.previewObjectKey }]
          : []),
      ]
      for (const object of objects) {
        await tx.roomAttachmentDeletionJob.upsert({
          where: { objectKey: object.objectKey },
          create: { attachmentId: attachment.id, ...object, status: 'pending' },
          update: {},
        })
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

async function requireActiveHumanMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
    include: { room: true },
  })
  if (!membership || membership.status !== 'active' || membership.room.status !== 'active') {
    throw new RoomPolicyError('room_attachment_forbidden', 'Active Room membership is required.')
  }
  return membership
}

async function requireReadableHumanMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
  })
  if (
    !membership ||
    (membership.status !== 'active' &&
      !((membership.status === 'left' || membership.status === 'removed') &&
        membership.historyThroughSequence != null))
  ) {
    throw new RoomPolicyError('room_attachment_forbidden', 'Readable Room membership is required.')
  }
  return membership
}

function normalizeInit(input: RoomAttachmentInitInput) {
  if (!CLIENT_ID.test(input.clientUploadId))
    throw new RoomPolicyError('invalid_upload_id', 'Upload ID is invalid.')
  if (!MEDIA_KINDS.has(input.mediaKind))
    throw new RoomPolicyError('invalid_attachment_kind', 'Attachment kind is invalid.')
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > MAX_ATTACHMENT_BYTES
  ) {
    throw new RoomPolicyError('invalid_attachment_size', 'Attachment size is invalid.')
  }
  const sha256 = input.sha256.toLowerCase()
  if (!SHA256.test(sha256))
    throw new RoomPolicyError('invalid_attachment_hash', 'Attachment hash is invalid.')
  const originalName = input.originalName.trim()
  if (
    !originalName ||
    originalName.length > 255 ||
    /[\0\r\n]/.test(originalName) ||
    BLOCKED_EXTENSIONS.test(originalName)
  ) {
    throw new RoomPolicyError('unsafe_attachment_name', 'Attachment name or type is unsafe.')
  }
  const mimeType = normalizeMime(input.mimeType)
  if (!mimeType || mimeType.length > 191 || BLOCKED_MIME.test(mimeType)) {
    throw new RoomPolicyError('unsafe_attachment_type', 'Attachment type is unsafe.')
  }
  if (input.mediaKind === 'image' && !mimeType.startsWith('image/')) invalidKind()
  if (input.mediaKind === 'audio' && !mimeType.startsWith('audio/')) invalidKind()
  const safeName = originalName.replace(/[\\/\0-\x1f\x7f:]/g, '_').slice(0, 255)
  return { ...input, originalName, safeName, mimeType, sha256 }
}

function uploadResponse(
  attachment: {
    id: string
    roomId: string
    objectKey: string
    safeName: string
    mimeType: string
    byteSize: bigint
    sha256: string
    status: string
  },
  idempotent: boolean,
) {
  if (attachment.status !== 'pending' && attachment.status !== 'uploaded') {
    throw new RoomPolicyError('room_attachment_unavailable', 'Upload is no longer pending.')
  }
  const expiresAt = new Date(Date.now() + UPLOAD_SECONDS * 1000).toISOString()
  return {
    attachment: {
      id: attachment.id,
      roomId: attachment.roomId,
      name: attachment.safeName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize.toString(),
      sha256: attachment.sha256,
      status: attachment.status,
    },
    upload: {
      method: 'PUT' as const,
      url: signUploadUrl(attachment.objectKey, {
        seconds: UPLOAD_SECONDS,
        byteSize: Number(attachment.byteSize),
        contentType: attachment.mimeType,
        sha256: attachment.sha256,
      }),
      headers: {
        'content-type': attachment.mimeType,
        'x-oss-meta-sha256': attachment.sha256,
      },
      expiresAt,
    },
    idempotent,
  }
}

function assertOwnedAttachment(
  attachment: { roomId: string; uploaderMembershipId: string } | null,
  roomId: string,
  membershipId: string,
): asserts attachment is NonNullable<typeof attachment> & Record<string, unknown> {
  if (
    !attachment ||
    attachment.roomId !== roomId ||
    attachment.uploaderMembershipId !== membershipId
  ) {
    throw new RoomPolicyError('room_attachment_unavailable', 'Attachment is unavailable.')
  }
}

function assertSameUpload(
  attachment: {
    uploaderMembershipId: string
    originalName: string
    mediaKind: string
    mimeType: string
    byteSize: bigint
    sha256: string
  },
  input: ReturnType<typeof normalizeInit>,
  membershipId: string,
) {
  if (
    attachment.uploaderMembershipId !== membershipId ||
    attachment.originalName !== input.originalName ||
    attachment.mediaKind !== input.mediaKind ||
    normalizeMime(attachment.mimeType) !== input.mimeType ||
    attachment.byteSize !== BigInt(input.byteSize) ||
    attachment.sha256 !== input.sha256
  )
    throw new RoomPolicyError(
      'upload_intent_conflict',
      'Upload ID was reused with different metadata.',
    )
}

function normalizeMime(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase()
}

function invalidKind(): never {
  throw new RoomPolicyError('attachment_kind_mismatch', 'Attachment kind does not match MIME type.')
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
