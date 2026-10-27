// @covers open-source/packages/server/src/services/agent-direct-attachments.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  conversation: vi.fn(), file: vi.fn(), unique: vi.fn(), count: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: {
  agentDirectConversation: { findFirst: mocks.conversation },
  agentPublication: { findUnique: vi.fn().mockResolvedValue({ id: 'pub' }) },
  agentDirectAttachment: { findFirst: mocks.file, findUnique: mocks.unique, count: mocks.count },
} }))
vi.mock('../lib/oss.js', () => ({ signDownloadUrl: vi.fn().mockReturnValue('https://download.example/file') }))
import { initDirectAttachment, downloadDirectAttachmentForVisitor, completeDirectAttachment } from '../services/agent-direct-attachments'
const input = { publicId: '', conversationId: 'chat', visitorUserId: 'owner', clientUploadId: 'upload-1',
  name: 'notes.pdf', mimeType: 'application/pdf', mediaKind: 'file', byteSize: 12, sha256: 'a'.repeat(64) }
describe('participant upload scope and visitor downloads', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('does not issue an upload for a nonparticipant, paused chat, or wrong publisher', async () => {
    mocks.conversation.mockResolvedValue(null)
    await expect(initDirectAttachment(input)).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.unique).not.toHaveBeenCalled()
    expect(mocks.conversation).toHaveBeenCalledWith({ where: {
      id: 'chat', status: 'active',
      OR: [{ visitorUserId: 'owner' }, { ownerUserId: 'owner', agentIdentity: { ownerType: 'user', ownerUserId: 'owner' } }],
      publication: { status: 'active' }, agentIdentity: { status: 'active' },
    }, select: { publicationId: true } })
  })
  it('rechecks participant ACL on complete and requires the uploader’s own unattached file', async () => {
    mocks.conversation.mockResolvedValue({ publicationId: 'pub' })
    mocks.file.mockResolvedValue(null)
    await expect(completeDirectAttachment({ ...input, attachmentId: 'foreign' })).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.file).toHaveBeenCalledWith({ where: {
      id: 'foreign', publicationId: 'pub', visitorUserId: 'owner', messageId: null,
    } })
  })
  it('lets the visitor download a publisher reply attachment by conversation ACL, not uploader identity', async () => {
    mocks.file.mockResolvedValue({ id: 'attachment', name: 'notes.pdf', byteSize: 12n, objectKey: 'object' })
    await expect(downloadDirectAttachmentForVisitor({ publicId: 'public', visitorUserId: 'visitor', attachmentId: 'attachment' }))
      .resolves.toMatchObject({ downloadUrl: 'https://download.example/file' })
    expect(mocks.file).toHaveBeenCalledWith({ where: {
      id: 'attachment', publicationId: 'pub', message: { conversation: { visitorUserId: 'visitor' } },
      status: 'ready', messageId: { not: null }, expiresAt: { gt: expect.any(Date) },
    } })
  })
})
