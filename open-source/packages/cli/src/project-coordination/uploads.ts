// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/attachment-transfer-store.test.ts
import { startAttachmentTransfer, appendAttachmentTransferChunk, finishAttachmentTransfer } from '../session/attachment-transfer-store.js'
export function coordinationUpload(workDir: string, raw: Record<string, unknown>) {
  if (typeof raw.transferId !== 'string') throw new Error('coordination_upload_invalid')
  if (raw.command === 'upload_start') {
    if (typeof raw.name !== 'string' || typeof raw.mimeType !== 'string' || typeof raw.sha256 !== 'string' || !Number.isSafeInteger(raw.totalSize) || Number(raw.totalSize) < 0 || Number(raw.totalSize) > 20 * 1024 * 1024) throw new Error('coordination_upload_invalid')
    return startAttachmentTransfer({ rootPath: workDir, transferId: raw.transferId, name: raw.name, kind: 'file', mimeType: raw.mimeType, sha256: raw.sha256, totalSize: Number(raw.totalSize) })
  }
  if (raw.command === 'upload_chunk') {
    if (typeof raw.data !== 'string' || raw.data.length > 65536 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw.data) || !Number.isSafeInteger(raw.offset)) throw new Error('coordination_upload_invalid')
    return appendAttachmentTransferChunk({ rootPath: workDir, transferId: raw.transferId, offset: Number(raw.offset), data: Buffer.from(raw.data, 'base64') })
  }
  if (raw.command === 'upload_finish') {
    const file = finishAttachmentTransfer(workDir, raw.transferId)
    return { ...file, kind: file.mimeType.startsWith('image/') ? 'image' : 'file' }
  }
  throw new Error('coordination_upload_invalid')
}
