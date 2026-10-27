// @arch docs/features/published-agent-direct-conversations.md
import * as Crypto from 'expo-crypto'
import { File } from 'expo-file-system'
import { authApi } from '../../config/api'
import type { ComposerFile } from '../steward/standbyFiles'

export type DirectDraftAttachment = ComposerFile & { clientUploadId: string; uploadedId?: string }
export function validateDirectDraftFiles(files: ComposerFile[]) {
  if (files.length > 5 || files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024
    || files.some((file) => file.size > (file.mimeType.startsWith('image/') ? 20 : 100) * 1024 * 1024)) {
    throw new Error('attachment_limit')
  }
}
export function prepareDirectDraftFiles(files: ComposerFile[]): ComposerFile[] {
  const prepared = files.map((file) => file.uri.startsWith('file:')
    ? { ...file, size: new File(file.uri).size } : file)
  validateDirectDraftFiles(prepared)
  return prepared
}
export async function uploadDirectDraftAttachment(conversationId: string, file: DirectDraftAttachment) {
  if (file.uploadedId) return file.uploadedId
  prepareDirectDraftFiles([file])
  const bytes = file.uri.startsWith('file:') ? await new File(file.uri).arrayBuffer()
    : await fetch(file.uri).then((response) => response.arrayBuffer())
  validateDirectDraftFiles([{ ...file, size: bytes.byteLength }])
  if (!bytes.byteLength) throw new Error('empty_attachment')
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const base = `/agent-direct-conversations/${encodeURIComponent(conversationId)}/attachments`
  const result = await authApi<{ attachmentId: string; ready: boolean;
    upload?: { url: string; headers: Record<string, string> } }>(`${base}/init`, {
    method: 'POST', body: JSON.stringify({ clientUploadId: file.clientUploadId,
      name: file.name, mimeType: file.mimeType, byteSize: bytes.byteLength, sha256,
      mediaKind: file.mimeType.startsWith('image/') ? 'image' : file.mimeType.startsWith('video/') ? 'video' : 'file' }),
  })
  if (!result.ready) {
    if (!result.upload) throw new Error('missing_upload')
    const uploaded = await fetch(result.upload.url, { method: 'PUT', headers: result.upload.headers,
      body: bytes, redirect: 'error' })
    if (!uploaded.ok) throw new Error('attachment_upload_failed')
    await authApi(`${base}/${encodeURIComponent(result.attachmentId)}/complete`, { method: 'POST', body: '{}' })
  }
  return result.attachmentId
}
