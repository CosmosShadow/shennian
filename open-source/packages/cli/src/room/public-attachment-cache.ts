// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/public-attachment-cache.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { resolveShennianPath } from '../config/index.js'
import { PublicRoomClient, PublicRoomClientError } from './public-room-client.js'

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60_000

type AttachmentMetadata = {
  attachmentId: string
  name: string
  mimeType: string
  byteSize: string
  sha256: string
}

export class PublicAttachmentCache {
  constructor(private readonly options: {
    client: PublicRoomClient
    rootDirectory?: string
    maxCacheBytes?: number
    maxCacheAgeMs?: number
  }) {}

  lookup(roomId: string, attachment: AttachmentMetadata): { downloaded: boolean; localPath: string | null } {
    try {
      const entry = this.entry(roomId, attachment.attachmentId)
      const metadata = readMetadata(entry.directory)
      if (!sameMetadata(metadata, attachment)) return { downloaded: false, localPath: null }
      const target = path.join(entry.directory, metadata.safeName)
      if (!verifyFile(target, Number(attachment.byteSize), attachment.sha256)) {
        return { downloaded: false, localPath: null }
      }
      writeMetadata(entry.directory, { ...metadata, lastAccessedAt: new Date().toISOString() })
      return { downloaded: true, localPath: target }
    } catch {
      return { downloaded: false, localPath: null }
    }
  }

  async materialize(roomId: string, attachmentId: string): Promise<{
    localPath: string
    downloaded: true
    cached: boolean
    name: string
    mimeType: string
    byteSize: string
    sha256: string
  }> {
    const capability = await this.options.client.getAttachmentDownload(roomId, attachmentId)
    const attachment = validateCapability(capability, attachmentId)
    const existing = this.lookup(roomId, attachment)
    if (existing.downloaded && existing.localPath) {
      this.prune(existing.localPath)
      return { ...attachment, localPath: existing.localPath, downloaded: true, cached: true }
    }
    const entry = this.entry(roomId, attachmentId)
    ensurePrivateDirectory(entry.directory)
    const safeName = safeFileName(attachment.name)
    const target = path.join(entry.directory, safeName)
    const temporary = path.join(entry.directory, `.download-${process.pid}-${crypto.randomBytes(8).toString('hex')}`)
    const expectedBytes = Number(attachment.byteSize)
    try {
      const response = await this.options.client.download(String(capability.downloadUrl))
      const declared = response.headers.get('content-length')
      if (declared && Number(declared) !== expectedBytes) invalidDownload('attachment_size_mismatch')
      const descriptor = fs.openSync(temporary, 'wx', 0o600)
      const hash = crypto.createHash('sha256')
      let bytes = 0
      try {
        const reader = response.body!.getReader()
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > expectedBytes || bytes > MAX_ATTACHMENT_BYTES) {
            await reader.cancel()
            invalidDownload('attachment_size_mismatch')
          }
          const buffer = Buffer.from(chunk.value)
          fs.writeSync(descriptor, buffer)
          hash.update(buffer)
        }
        fs.fsyncSync(descriptor)
      } finally {
        fs.closeSync(descriptor)
      }
      if (bytes !== expectedBytes) invalidDownload('attachment_size_mismatch')
      if (hash.digest('hex') !== attachment.sha256) invalidDownload('attachment_hash_mismatch')
      renameSyncWithRetry(temporary, target)
      if (process.platform !== 'win32') fs.chmodSync(target, 0o600)
      writeMetadata(entry.directory, {
        schemaVersion: 1,
        attachmentId,
        safeName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        sha256: attachment.sha256,
        lastAccessedAt: new Date().toISOString(),
      })
      this.prune(target)
      return { ...attachment, localPath: target, downloaded: true, cached: false }
    } finally {
      try { fs.unlinkSync(temporary) } catch {}
    }
  }

  prune(preservePath?: string): void {
    const root = this.root()
    const entries = listEntries(root)
    const cutoff = Date.now() - (this.options.maxCacheAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS)
    const maxBytes = this.options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES
    let total = entries.reduce((sum, entry) => sum + entry.byteSize, 0)
    for (const entry of entries.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)) {
      if (preservePath && path.resolve(entry.filePath) === path.resolve(preservePath)) continue
      if (entry.lastAccessedAt >= cutoff && total <= maxBytes) continue
      fs.rmSync(entry.directory, { recursive: true, force: true })
      total -= entry.byteSize
    }
  }

  private root(): string {
    return this.options.rootDirectory ?? resolveShennianPath('room-attachments')
  }

  private entry(roomId: string, attachmentId: string) {
    const contextHash = crypto.createHash('sha256').update(`room-context-v1\0${roomId}`, 'utf8').digest('hex')
    const attachmentHash = crypto.createHash('sha256').update(`attachment-v1\0${attachmentId}`, 'utf8').digest('hex')
    return { contextHash, attachmentHash, directory: path.join(this.root(), contextHash, attachmentHash) }
  }
}

function validateCapability(value: Record<string, unknown>, attachmentId: string): AttachmentMetadata {
  if (
    value.attachmentId !== attachmentId ||
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' ||
    typeof value.byteSize !== 'string' ||
    !/^(0|[1-9]\d{0,15})$/.test(value.byteSize) ||
    Number(value.byteSize) > MAX_ATTACHMENT_BYTES ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.downloadUrl !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    Date.parse(value.expiresAt) <= Date.now()
  ) {
    throw new PublicRoomClientError('invalid_attachment_capability', 'Attachment capability is invalid.')
  }
  let url: URL
  try { url = new URL(value.downloadUrl) } catch { invalidDownload('invalid_attachment_capability') }
  if (url!.protocol !== 'https:' || url!.username || url!.password || url!.hash) {
    invalidDownload('invalid_attachment_capability')
  }
  return {
    attachmentId,
    name: value.name,
    mimeType: value.mimeType,
    byteSize: value.byteSize,
    sha256: value.sha256,
  }
}

function safeFileName(value: string): string {
  const safe = value.replace(/[\\/\0-\x1f\x7f:]/g, '_').slice(0, 255).trim()
  if (!safe || safe === '.' || safe === '..') invalidDownload('unsafe_attachment_name')
  return safe
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
}

function verifyFile(filePath: string, byteSize: number, sha256: string): boolean {
  try {
    const stat = fs.lstatSync(filePath)
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === byteSize &&
      crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') === sha256
  } catch {
    return false
  }
}

type CacheMetadata = {
  schemaVersion: 1
  attachmentId: string
  safeName: string
  mimeType: string
  byteSize: string
  sha256: string
  lastAccessedAt: string
}

function readMetadata(directory: string): CacheMetadata {
  const target = path.join(directory, 'metadata.json')
  const stat = fs.lstatSync(target)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe metadata')
  return JSON.parse(fs.readFileSync(target, 'utf8')) as CacheMetadata
}

function writeMetadata(directory: string, metadata: CacheMetadata): void {
  ensurePrivateDirectory(directory)
  const target = path.join(directory, 'metadata.json')
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(metadata)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporary, target)
    if (process.platform !== 'win32') fs.chmodSync(target, 0o600)
  } finally {
    try { fs.unlinkSync(temporary) } catch {}
  }
}

function sameMetadata(metadata: CacheMetadata, attachment: AttachmentMetadata): boolean {
  return metadata.schemaVersion === 1 && metadata.attachmentId === attachment.attachmentId &&
    metadata.byteSize === attachment.byteSize && metadata.sha256 === attachment.sha256 &&
    metadata.mimeType === attachment.mimeType && Number.isFinite(Date.parse(metadata.lastAccessedAt))
}

function listEntries(root: string): Array<{ directory: string; filePath: string; byteSize: number; lastAccessedAt: number }> {
  if (!isDirectory(root)) return []
  const result = []
  for (const contextHash of fs.readdirSync(root)) {
    if (!/^[a-f0-9]{64}$/.test(contextHash)) continue
    const contextDirectory = path.join(root, contextHash)
    if (!isDirectory(contextDirectory)) continue
    for (const attachmentHash of fs.readdirSync(contextDirectory)) {
      if (!/^[a-f0-9]{64}$/.test(attachmentHash)) continue
      const directory = path.join(contextDirectory, attachmentHash)
      try {
        const metadata = readMetadata(directory)
        const filePath = path.join(directory, metadata.safeName)
        const stat = fs.lstatSync(filePath)
        if (!stat.isFile() || stat.isSymbolicLink()) continue
        result.push({ directory, filePath, byteSize: stat.size, lastAccessedAt: Date.parse(metadata.lastAccessedAt) })
      } catch {}
    }
  }
  return result
}

function isDirectory(target: string): boolean {
  try {
    const stat = fs.lstatSync(target)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function invalidDownload(code: string): never {
  throw new PublicRoomClientError(code, 'Attachment download validation failed.')
}
