// @arch open-source/docs/server-runtime.md
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { deleteObjectIfExists, getObjectBuffer, headObjectMetadata, signDownloadUrl, signUploadUrl } from '../lib/oss.js'
import { AgentDirectConversationError } from './agent-direct-conversations.js'

export const DIRECT_ATTACHMENT_MAX_COUNT = 5
export const DIRECT_ATTACHMENT_MAX_TOTAL_BYTES = 100 * 1024 * 1024
export const DIRECT_ATTACHMENT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9_.:@-]{1,120}$/
const BLOCKED_NAME = /\.(?:app|apk|bat|cmd|com|dll|dmg|exe|html?|iso|jar|js|mjs|msi|ps1|scr|sh|svg|vbs)$/i
const BLOCKED_MIME = /(?:javascript|html|svg|x-msdownload|x-sh|x-executable)/i

export function validateDirectAttachment(input: {
  name: unknown; mimeType: unknown; mediaKind: unknown; byteSize: unknown; sha256: unknown
}) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.trim().toLowerCase() : ''
  const mediaKind = input.mediaKind
  const byteSize = input.byteSize
  const sha256 = typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : ''
  if (!name || name.length > 255 || /[\0\r\n]/.test(name) || BLOCKED_NAME.test(name)
    || !mimeType || mimeType.length > 191 || BLOCKED_MIME.test(mimeType)
    || !['image', 'video', 'file'].includes(String(mediaKind))
    || (mediaKind === 'image' && !mimeType.startsWith('image/'))
    || (mediaKind === 'video' && !mimeType.startsWith('video/'))
    || !Number.isSafeInteger(byteSize) || Number(byteSize) < 1
    || Number(byteSize) > (mediaKind === 'image'
      ? DIRECT_ATTACHMENT_MAX_IMAGE_BYTES : DIRECT_ATTACHMENT_MAX_TOTAL_BYTES)
    || !SHA256.test(sha256)) throw new AgentDirectConversationError('invalid')
  return { name: name.replace(/[\\/\0-\x1f\x7f:]/g, '_'), mimeType,
    mediaKind: mediaKind as 'image' | 'video' | 'file', byteSize: Number(byteSize), sha256 }
}

async function scope(publicId: string, visitorUserId: string, conversationId?: string) {
  if (conversationId) {
    const conversation = await prisma.agentDirectConversation.findFirst({ where: {
      id: conversationId, status: 'active',
      OR: [{ visitorUserId }, { ownerUserId: visitorUserId,
        agentIdentity: { ownerType: 'user', ownerUserId: visitorUserId } }],
      publication: { status: 'active' }, agentIdentity: { status: 'active' },
    }, select: { publicationId: true } })
    if (!conversation) throw new AgentDirectConversationError('not_found')
    return conversation.publicationId
  }
  const publication = await prisma.agentPublication.findUnique({ where: { publicId },
    select: { id: true, status: true, allowAnonymousVisitors: true,
      agentIdentity: { select: { status: true } } } })
  if (!publication) throw new AgentDirectConversationError('not_found')
  const visitor = await prisma.user.findUnique({ where: { id: visitorUserId },
    select: { accountTier: true } })
  if (!visitor || publication.status !== 'active' || publication.agentIdentity.status !== 'active'
    || (visitor.accountTier === 'anonymous_visitor' && !publication.allowAnonymousVisitors)) {
    throw new AgentDirectConversationError('unavailable')
  }
  return publication.id
}

export async function initDirectAttachment(input: {
  publicId: string; visitorUserId: string; conversationId?: string; clientUploadId: unknown
  name: unknown; mimeType: unknown; mediaKind: unknown; byteSize: unknown; sha256: unknown
}) {
  if (typeof input.clientUploadId !== 'string' || !ID.test(input.clientUploadId)) {
    throw new AgentDirectConversationError('invalid')
  }
  const value = validateDirectAttachment(input)
  const publicationId = await scope(input.publicId, input.visitorUserId, input.conversationId)
  const intent = crypto.createHash('sha256').update(`${publicationId}\0${input.visitorUserId}\0${input.clientUploadId}`).digest('hex')
  let attachment = await prisma.agentDirectAttachment.findUnique({ where: { uploadIntentId: intent } })
  if (!attachment) {
    const outstanding = await prisma.agentDirectAttachment.count({ where: {
      publicationId, visitorUserId: input.visitorUserId, messageId: null,
      status: { in: ['pending', 'ready'] },
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    } })
    if (outstanding >= DIRECT_ATTACHMENT_MAX_COUNT * 3) throw new AgentDirectConversationError('limit_reached')
    const id = `datt_${crypto.randomUUID()}`
    try {
      attachment = await prisma.agentDirectAttachment.create({ data: {
        id, publicationId, visitorUserId: input.visitorUserId, uploadIntentId: intent,
        objectKey: `agent-direct/${publicationId}/${id}/original`, ...value,
      } })
    } catch (error) {
      attachment = await prisma.agentDirectAttachment.findUnique({ where: { uploadIntentId: intent } })
      if (!attachment) throw error
    }
  }
  if (attachment.messageId || !['pending', 'ready'].includes(attachment.status)
    || attachment.name !== value.name || attachment.mimeType !== value.mimeType
    || attachment.mediaKind !== value.mediaKind || Number(attachment.byteSize) !== value.byteSize
    || attachment.sha256 !== value.sha256) throw new AgentDirectConversationError('invalid')
  if (attachment.status === 'ready') return { attachmentId: attachment.id, ready: true as const }
  return { attachmentId: attachment.id, ready: false as const, upload: { method: 'PUT' as const,
    url: signUploadUrl(attachment.objectKey, { seconds: 300,
      contentType: attachment.mimeType, sha256: attachment.sha256 }),
    headers: { 'content-type': attachment.mimeType, 'x-oss-meta-sha256': attachment.sha256 },
  } }
}

export async function completeDirectAttachment(input: {
  publicId: string; visitorUserId: string; conversationId?: string; attachmentId: string
}) {
  const publicationId = await scope(input.publicId, input.visitorUserId, input.conversationId)
  const attachment = await prisma.agentDirectAttachment.findFirst({ where: {
    id: input.attachmentId, publicationId, visitorUserId: input.visitorUserId, messageId: null,
  } })
  if (!attachment) throw new AgentDirectConversationError('not_found')
  if (attachment.status === 'ready') return { attachmentId: attachment.id, status: 'ready' }
  if (attachment.status !== 'pending') throw new AgentDirectConversationError('unavailable')
  const meta = await headObjectMetadata(attachment.objectKey)
  const downloaded = await getObjectBuffer(attachment.objectKey)
  const actual = downloaded && crypto.createHash('sha256').update(downloaded.buffer).digest('hex')
  if (!meta || !downloaded || meta.byteSize !== Number(attachment.byteSize)
    || downloaded.buffer.byteLength !== Number(attachment.byteSize)
    || meta.contentType?.toLowerCase() !== attachment.mimeType
    || downloaded.mimeType?.toLowerCase() !== attachment.mimeType
    || actual !== attachment.sha256) {
    throw new AgentDirectConversationError('invalid')
  }
  await prisma.agentDirectAttachment.updateMany({ where: { id: attachment.id, status: 'pending' },
    data: { status: 'ready', readyAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } })
  return { attachmentId: attachment.id, status: 'ready' }
}

export async function downloadDirectAttachmentForVisitor(input: {
  publicId: string; visitorUserId: string; attachmentId: string
}) {
  const publication = await prisma.agentPublication.findUnique({ where: { publicId: input.publicId },
    select: { id: true } })
  const attachment = publication && await prisma.agentDirectAttachment.findFirst({ where: {
    id: input.attachmentId, publicationId: publication.id,
    message: { conversation: { visitorUserId: input.visitorUserId } },
    status: 'ready', messageId: { not: null }, expiresAt: { gt: new Date() },
  } })
  if (!attachment) throw new AgentDirectConversationError('not_found')
  return shapeDownload(attachment)
}

export async function downloadDirectAttachmentForParticipant(input: {
  conversationId: string; userId: string; attachmentId: string
}) {
  const conversation = await prisma.agentDirectConversation.findFirst({ where: {
    id: input.conversationId,
    OR: [{ visitorUserId: input.userId }, { ownerUserId: input.userId,
      agentIdentity: { ownerType: 'user', ownerUserId: input.userId } }],
  }, select: { id: true } })
  const attachment = conversation && await prisma.agentDirectAttachment.findFirst({ where: {
    id: input.attachmentId, message: { conversationId: conversation.id },
    status: 'ready', expiresAt: { gt: new Date() },
  } })
  if (!attachment) throw new AgentDirectConversationError('not_found')
  return shapeDownload(attachment)
}

export function shapeDownload(attachment: { id: string; name: string; mimeType: string;
  mediaKind: string; byteSize: bigint; sha256: string; objectKey: string }) {
  return { attachmentId: attachment.id, name: attachment.name,
    mimeType: attachment.mimeType, mediaKind: attachment.mediaKind,
    byteSize: attachment.byteSize.toString(), sha256: attachment.sha256,
    downloadUrl: signDownloadUrl(attachment.objectKey, 60) }
}

export async function cleanupDirectAttachments(now = new Date(), limit = 100) {
  const rows = await prisma.agentDirectAttachment.findMany({ where: { OR: [
    { expiresAt: { lte: now } },
    { messageId: null, createdAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  ] }, take: limit, orderBy: { createdAt: 'asc' } })
  for (const row of rows) {
    await deleteObjectIfExists(row.objectKey)
    await prisma.agentDirectAttachment.delete({ where: { id: row.id } })
  }
  return rows.length
}
