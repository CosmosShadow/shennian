// @covers packages/app/src/features/published-agents/directConversationAttachments.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ api: vi.fn(), read: vi.fn(), digest: vi.fn(), fetch: vi.fn(), size: 12 }))
vi.mock('../config/api', () => ({ authApi: mocks.api }))
vi.mock('expo-file-system', () => ({ File: class { size = mocks.size; arrayBuffer = mocks.read } }))
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digest: mocks.digest }))
import { uploadDirectDraftAttachment, validateDirectDraftFiles } from '../features/published-agents/directConversationAttachments'
const file = { uri: 'file:///tmp/notes.pdf', name: 'notes.pdf', size: 12,
  mimeType: 'application/pdf', clientUploadId: 'stable-upload' }
describe('published conversation attachment upload', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.size = 12
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.read.mockResolvedValue(new ArrayBuffer(12))
    mocks.digest.mockResolvedValue(new Uint8Array(32).fill(1).buffer)
  })
  it('reads native picker files, retains the upload intent, uploads and completes before send', async () => {
    mocks.api.mockResolvedValueOnce({ attachmentId: 'attachment', ready: false,
      upload: { url: 'https://upload.example/file', headers: { 'content-type': 'application/pdf' } } }).mockResolvedValueOnce({})
    mocks.fetch.mockResolvedValue({ ok: true })
    expect(await uploadDirectDraftAttachment('chat', file)).toBe('attachment')
    expect(mocks.api).toHaveBeenNthCalledWith(1, '/agent-direct-conversations/chat/attachments/init', {
      method: 'POST', body: JSON.stringify({ clientUploadId: 'stable-upload', name: 'notes.pdf',
        mimeType: 'application/pdf', byteSize: 12, sha256: '01'.repeat(32), mediaKind: 'file' }),
    })
    expect(mocks.fetch).toHaveBeenCalledWith('https://upload.example/file', expect.objectContaining({ method: 'PUT', redirect: 'error' }))
    expect(mocks.api).toHaveBeenNthCalledWith(2, '/agent-direct-conversations/chat/attachments/attachment/complete', { method: 'POST', body: '{}' })
  })
  it('resumes a completed intent without uploading again', async () => {
    mocks.api.mockResolvedValue({ attachmentId: 'attachment', ready: true })
    expect(await uploadDirectDraftAttachment('chat', file)).toBe('attachment')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(await uploadDirectDraftAttachment('chat', { ...file, uploadedId: 'already-ready' })).toBe('already-ready')
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('does not complete a failed upload', async () => {
    mocks.api.mockResolvedValue({ attachmentId: 'attachment', ready: false, upload: { url: 'https://upload.example', headers: {} } })
    mocks.fetch.mockResolvedValue({ ok: false })
    await expect(uploadDirectDraftAttachment('chat', file)).rejects.toThrow('attachment_upload_failed')
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })
  it('checks file count, image size, total size, and actual bytes', async () => {
    expect(() => validateDirectDraftFiles(Array(6).fill(file))).toThrow()
    expect(() => validateDirectDraftFiles([{ ...file, size: 21 * 1024 * 1024, mimeType: 'image/png' }])).toThrow()
    expect(() => validateDirectDraftFiles(Array(2).fill({ ...file, size: 60 * 1024 * 1024 }))).toThrow()
    mocks.size = 101 * 1024 * 1024
    await expect(uploadDirectDraftAttachment('chat', file)).rejects.toThrow('attachment_limit')
    expect(mocks.read).not.toHaveBeenCalled()
    mocks.size = 12
    mocks.read.mockResolvedValue(new ArrayBuffer(0))
    await expect(uploadDirectDraftAttachment('chat', file)).rejects.toThrow('empty_attachment')
    expect(mocks.api).not.toHaveBeenCalled()
  })
})
