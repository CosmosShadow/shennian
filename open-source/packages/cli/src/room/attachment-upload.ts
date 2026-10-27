// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-attachment-upload.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { HttpRoomActionClient } from './room-action-client.js'

const MAX_FILE_BYTES = 100 * 1024 * 1024

export class RoomAttachmentUploadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomAttachmentUploadError'
  }
}

export class RoomAttachmentUploader {
  constructor(
    private readonly deps: {
      actionClient: Pick<HttpRoomActionClient, 'initializeAttachment' | 'completeAttachment'>
      fetch?: typeof fetch
    },
  ) {}

  async upload(input: {
    machineToken: string
    roomId: string
    bindingId: string
    workspacePath: string
    clientMessageId: string
    files: string[]
  }): Promise<string[]> {
    if (input.files.length < 1 || input.files.length > 10) throw invalid('room_upload_file_count')
    const workspace = fs.realpathSync(input.workspacePath)
    const attachmentIds: string[] = []
    for (const [index, requestedPath] of input.files.entries()) {
      const candidate = path.resolve(workspace, requestedPath)
      const requestedStat = fs.lstatSync(candidate)
      if (requestedStat.isSymbolicLink()) throw invalid('room_upload_invalid_file')
      const realPath = fs.realpathSync(candidate)
      const relative = path.relative(workspace, realPath)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw invalid('room_upload_outside_workspace')
      }
      if (isSensitiveManagedUpload(relative)) throw invalid('room_upload_sensitive_file')
      const bytes = readStablePrivateFile(realPath)
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
      const name = path.basename(realPath)
      const mimeType = mimeFor(name)
      const mediaKind = attachmentMediaKind(name, mimeType)
      const clientUploadId = crypto
        .createHash('sha256')
        .update(`${input.bindingId}\0${input.clientMessageId}\0${index}\0${sha256}`, 'utf8')
        .digest('hex')
      const target = {
        machineToken: input.machineToken,
        roomId: input.roomId,
        bindingId: input.bindingId,
      }
      const initialized = await this.deps.actionClient.initializeAttachment({
        ...target,
        clientUploadId,
        name,
        mediaKind,
        mimeType,
        byteSize: bytes.byteLength,
        sha256,
      })
      let response: Response
      try {
        response = await (this.deps.fetch ?? fetch)(initialized.upload.url, {
          method: 'PUT',
          headers: initialized.upload.headers,
          body: new Uint8Array(bytes),
          redirect: 'error',
          signal: AbortSignal.timeout(120_000),
        })
      } catch {
        throw new RoomAttachmentUploadError(
          'room_upload_unavailable',
          'Private attachment upload service is unavailable.',
        )
      }
      if (!response.ok) {
        throw new RoomAttachmentUploadError(
          `room_upload_http_${response.status}`,
          'Private attachment upload failed.',
        )
      }
      const completed = await this.deps.actionClient.completeAttachment({
        ...target,
        attachmentId: initialized.attachment.id,
      })
      attachmentIds.push(completed.attachment.attachmentId)
    }
    return attachmentIds
  }
}

function readStablePrivateFile(realPath: string): Buffer {
  const before = fs.lstatSync(realPath)
  if (!isAllowedRegularFile(before)) throw invalid('room_upload_invalid_file')

  let descriptor: number | null = null
  try {
    descriptor = fs.openSync(realPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fs.fstatSync(descriptor)
    if (!isAllowedRegularFile(opened) || !sameFile(before, opened)) {
      throw invalid('room_upload_file_changed')
    }
    const bytes = fs.readFileSync(descriptor)
    const after = fs.fstatSync(descriptor)
    const current = fs.lstatSync(realPath)
    if (
      !sameFile(opened, after) ||
      !sameFile(opened, current) ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== opened.size
    ) {
      throw invalid('room_upload_file_changed')
    }
    return bytes
  } catch (error) {
    if (error instanceof RoomAttachmentUploadError) throw error
    throw invalid('room_upload_invalid_file')
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
  }
}

function isAllowedRegularFile(stat: fs.Stats): boolean {
  return stat.isFile() && stat.nlink === 1 && stat.size > 0 && stat.size <= MAX_FILE_BYTES
}

function sameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function isSensitiveManagedUpload(relativePath: string): boolean {
  const parts = relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
  const lower = parts.map((part) => part.toLowerCase())
  const name = lower.at(-1) ?? ''
  if (name === '.env' || name.startsWith('.env.')) return true
  if (name === '.netrc' || name === '.npmrc' || name.endsWith('.key') || name.endsWith('.pem')) {
    return true
  }
  if (lower.includes('.ssh') || lower.includes('.aws') || lower.includes('.azure')) return true
  return lower.some((part, index) => part === '.config' && lower[index + 1] === 'gcloud')
}

function mimeFor(name: string): string {
  const extension = path.extname(name).toLowerCase()
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return types[extension] ?? 'application/octet-stream'
}

/** HEIC / HEIF is never image-processed: it uploads as an ordinary file with its original MIME and bytes. */
export function attachmentMediaKind(name: string, mimeType: string): 'image' | 'audio' | 'file' {
  if (/^image\/hei[cf](?:-sequence)?$/.test(mimeType) || /\.(?:heic|heif)$/i.test(name)) return 'file'
  return mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'file'
}

function invalid(code: string): RoomAttachmentUploadError {
  return new RoomAttachmentUploadError(code, 'Room attachment file is not allowed.')
}
