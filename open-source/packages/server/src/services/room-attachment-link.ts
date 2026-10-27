// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-attachment-link.test.ts

import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { signDownloadUrl } from '../lib/oss.js'
import { RoomPolicyError } from './room-policy.js'

const LINK_LIFETIME_SECONDS = 30 * 24 * 60 * 60
const OBJECT_DOWNLOAD_SECONDS = 60

type AttachmentLinkPayload = {
  v: 1
  roomId: string
  bindingId: string
  capabilityEpoch?: number
  attachmentId: string
  exp: number
}

function secret(): string {
  return process.env.ROOM_CAPABILITY_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me'
}

function signature(body: string): string {
  return crypto.createHmac('sha256', secret()).update(`room-attachment-link:${body}`).digest('base64url')
}

export function createRoomAttachmentLinkToken(input: {
  roomId: string
  bindingId: string
  capabilityEpoch?: number
  attachmentId: string
  attachmentExpiresAt?: Date | null
  now?: Date
}): { token: string; expiresAt: string } {
  const now = input.now ?? new Date()
  const requestedExpiry = now.getTime() + LINK_LIFETIME_SECONDS * 1000
  const expiresAt = new Date(
    input.attachmentExpiresAt
      ? Math.min(requestedExpiry, input.attachmentExpiresAt.getTime())
      : requestedExpiry,
  )
  const payload: AttachmentLinkPayload = {
    v: 1,
    roomId: input.roomId,
    bindingId: input.bindingId,
    capabilityEpoch: input.capabilityEpoch ?? 0,
    attachmentId: input.attachmentId,
    exp: Math.floor(expiresAt.getTime() / 1000),
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { token: `${body}.${signature(body)}`, expiresAt: expiresAt.toISOString() }
}

export function verifyRoomAttachmentLinkToken(
  token: string,
  now = new Date(),
): AttachmentLinkPayload | null {
  const [body, suppliedSignature, extra] = token.split('.')
  if (!body || !suppliedSignature || extra) return null
  const expected = signature(body)
  const suppliedBuffer = Buffer.from(suppliedSignature)
  const expectedBuffer = Buffer.from(expected)
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<AttachmentLinkPayload>
    if (
      payload.v !== 1 ||
      typeof payload.roomId !== 'string' ||
      typeof payload.bindingId !== 'string' ||
      (payload.capabilityEpoch != null &&
        (!Number.isInteger(payload.capabilityEpoch) || payload.capabilityEpoch < 0)) ||
      typeof payload.attachmentId !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(now.getTime() / 1000)
    ) {
      return null
    }
    return payload as AttachmentLinkPayload
  } catch {
    return null
  }
}

export async function redeemRoomAttachmentLink(token: string, now = new Date()) {
  const payload = verifyRoomAttachmentLinkToken(token, now)
  if (!payload) {
    throw new RoomPolicyError('room_attachment_link_invalid', 'Attachment link is invalid or expired.')
  }
  const [binding, attachment] = await Promise.all([
    prisma.roomBinding.findUnique({
      where: { id: payload.bindingId },
      include: { agentMembership: { include: { room: true } } },
    }),
    prisma.roomAttachment.findUnique({
      where: { id: payload.attachmentId },
      include: { message: { select: { roomId: true, sequence: true, deletedAt: true } } },
    }),
  ])
  if (
    !binding ||
    binding.roomId !== payload.roomId ||
    binding.capabilityEpoch !== (payload.capabilityEpoch ?? 0) ||
    (binding.status !== 'active' && binding.status !== 'paused') ||
    !binding.agentMembership ||
    binding.agentMembership.status !== 'active' ||
    binding.agentMembership.room.status !== 'active' ||
    !attachment ||
    attachment.roomId !== payload.roomId ||
    attachment.status !== 'ready' ||
    !attachment.message ||
    attachment.message.roomId !== payload.roomId ||
    attachment.message.deletedAt ||
    attachment.message.sequence < binding.agentMembership.historyFromSequence ||
    (attachment.expiresAt && attachment.expiresAt <= now)
  ) {
    throw new RoomPolicyError('room_attachment_unavailable', 'Attachment is unavailable.')
  }
  return {
    downloadUrl: signDownloadUrl(attachment.objectKey, OBJECT_DOWNLOAD_SECONDS),
    name: attachment.safeName,
  }
}
