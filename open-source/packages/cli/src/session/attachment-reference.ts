// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/attachment-transfer-store.test.ts

import type { PersonalAttachmentReference } from '@shennian/wire'

const SHA256_PATTERN = /^[a-f0-9]{64}$/i

export function parsePersonalAttachmentReferences(
  value: unknown,
): PersonalAttachmentReference[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('invalid_attachments')
  if (value.length > 32) throw new Error('too_many_attachments')
  const attachments = value.map((item): PersonalAttachmentReference => {
    if (!item || typeof item !== 'object') throw new Error('invalid_attachment_reference')
    const entry = item as Record<string, unknown>
    const path = typeof entry.path === 'string' ? entry.path.trim() : ''
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const mimeType = typeof entry.mimeType === 'string' ? entry.mimeType.trim() : ''
    const kind = entry.kind
    const byteSize = entry.byteSize
    const sha256 = typeof entry.sha256 === 'string' ? entry.sha256.toLowerCase() : ''
    if (
      !path || /^https?:\/\//i.test(path) || !name || !mimeType ||
      (kind !== 'file' && kind !== 'image' && kind !== 'folder') ||
      !Number.isSafeInteger(byteSize) || Number(byteSize) < 0 ||
      !SHA256_PATTERN.test(sha256)
    ) throw new Error('invalid_attachment_reference')
    if (entry.previewData !== undefined || entry.data !== undefined || entry.blob !== undefined) {
      throw new Error('attachment_bytes_forbidden')
    }
    return { path, name, mimeType, kind, byteSize: Number(byteSize), sha256 }
  })
  return attachments.length ? attachments : undefined
}
