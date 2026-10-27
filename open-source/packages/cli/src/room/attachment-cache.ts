// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-attachment-cache.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { resolveShennianPath } from '../config/index.js'
import { HttpRoomActionClient, RoomActionHttpError } from './room-action-client.js'

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60_000
const SAFE_ID = /^[A-Za-z0-9_.:@-]{1,191}$/

export class RoomAttachmentCacheError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomAttachmentCacheError'
  }
}

export class RoomAttachmentCache {
  constructor(
    private readonly deps: {
      actionClient: Pick<HttpRoomActionClient, 'getAttachmentCapability'>
      fetchImpl?: typeof fetch
      rootDirectory?: string
      maxAttachmentBytes?: number
      maxCacheBytes?: number
      maxCacheAgeMs?: number
    },
  ) {}

  async materialize(input: {
    machineToken: string
    roomId: string
    bindingId: string
    attachmentId: string
    contextKey?: string
    rootDirectory?: string
    expected?: { downloadRef: string; byteSize: string; sha256: string }
    signal?: AbortSignal
  }): Promise<{
    path: string
    name: string
    mimeType: string
    cached: boolean
    byteSize: string
    sha256: string
  }> {
    validateId(input.roomId, 'room_id')
    validateId(input.bindingId, 'binding_id')
    validateId(input.attachmentId, 'attachment_id')
    if (input.expected && input.expected.downloadRef !== `shennian-room-attachment:${input.attachmentId}`) {
      throw new RoomAttachmentCacheError(
        'attachment_reference_mismatch',
        'Attachment reference mismatch.',
      )
    }
    if (input.expected) validateMetadata(input.expected.byteSize, input.expected.sha256)
    const capability = await this.deps.actionClient.getAttachmentCapability({
      machineToken: input.machineToken,
      roomId: input.roomId,
      bindingId: input.bindingId,
      attachmentId: input.attachmentId,
      signal: input.signal,
    })
    validateCapability(capability, input.roomId, input.attachmentId)
    if (input.expected && (
      capability.byteSize !== input.expected.byteSize ||
      capability.sha256 !== input.expected.sha256
    )) {
      throw new RoomAttachmentCacheError(
        'attachment_metadata_mismatch',
        'Attachment metadata changed unexpectedly.',
      )
    }
    const maxBytes = this.deps.maxAttachmentBytes ?? MAX_ATTACHMENT_BYTES
    const expectedBytes = Number(capability.byteSize)
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes > maxBytes) {
      throw new RoomAttachmentCacheError('attachment_too_large', 'Attachment exceeds local limit.')
    }
    const contextHash = crypto.createHash('sha256')
      .update(input.contextKey ?? `${input.bindingId}\0${input.roomId}`, 'utf8')
      .digest('hex')
    const attachmentHash = crypto.createHash('sha256').update(input.attachmentId, 'utf8').digest('hex')
    const directory = path.join(
      input.rootDirectory ?? this.deps.rootDirectory ?? resolveShennianPath('attachment-cache'),
      contextHash,
      attachmentHash,
    )
    ensurePrivateDirectory(directory)
    const target = path.join(directory, capability.safeName)
    if (verifyExisting(target, expectedBytes, capability.sha256)) {
      writeCacheMetadata(directory, capability, new Date())
      this.prune({ preservePath: target, rootDirectory: input.rootDirectory })
      return {
        path: target,
        name: capability.safeName,
        mimeType: capability.mimeType,
        cached: true,
        byteSize: capability.byteSize,
        sha256: capability.sha256,
      }
    }
    const temporary = path.join(
      directory,
      `.download-${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
    )
    let requestSignal: ReturnType<typeof createAbortableTimeout> | null = null
    try {
      requestSignal = createAbortableTimeout(input.signal, 60_000)
      const response = await (this.deps.fetchImpl ?? fetch)(capability.downloadUrl, {
        redirect: 'error',
        signal: requestSignal.signal,
      })
      if (!response.ok || !response.body) {
        throw new RoomAttachmentCacheError(
          'attachment_download_failed',
          'Attachment download failed.',
        )
      }
      const declaredLength = response.headers.get('content-length')
      if (declaredLength && Number(declaredLength) !== expectedBytes) {
        throw new RoomAttachmentCacheError('attachment_size_mismatch', 'Attachment size mismatch.')
      }
      const descriptor = fs.openSync(temporary, 'wx', 0o600)
      const hash = crypto.createHash('sha256')
      let downloaded = 0
      try {
        const reader = response.body.getReader()
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          downloaded += chunk.value.byteLength
          if (downloaded > expectedBytes || downloaded > maxBytes) {
            await reader.cancel()
            throw new RoomAttachmentCacheError(
              'attachment_size_mismatch',
              'Attachment size mismatch.',
            )
          }
          const buffer = Buffer.from(chunk.value)
          fs.writeSync(descriptor, buffer)
          hash.update(buffer)
        }
        fs.fsyncSync(descriptor)
      } finally {
        fs.closeSync(descriptor)
      }
      if (downloaded !== expectedBytes) {
        throw new RoomAttachmentCacheError('attachment_size_mismatch', 'Attachment size mismatch.')
      }
      if (hash.digest('hex') !== capability.sha256) {
        throw new RoomAttachmentCacheError('attachment_hash_mismatch', 'Attachment hash mismatch.')
      }
      renameSyncWithRetry(temporary, target)
      if (process.platform !== 'win32') fs.chmodSync(target, 0o600)
      writeCacheMetadata(directory, capability, new Date())
      this.prune({ preservePath: target, rootDirectory: input.rootDirectory })
      return {
        path: target,
        name: capability.safeName,
        mimeType: capability.mimeType,
        cached: false,
        byteSize: capability.byteSize,
        sha256: capability.sha256,
      }
    } catch (error) {
      if (error instanceof RoomAttachmentCacheError || error instanceof RoomActionHttpError)
        throw error
      if (input.signal?.aborted) {
        throw new RoomAttachmentCacheError(
          'managed_room_context_revoked',
          'Managed Room context was revoked.',
        )
      }
      throw new RoomAttachmentCacheError(
        'attachment_download_failed',
        'Attachment download failed.',
      )
    } finally {
      requestSignal?.dispose()
      try {
        fs.unlinkSync(temporary)
      } catch {}
    }
  }

  prune(input: { now?: Date; preservePath?: string; rootDirectory?: string } = {}): {
    removedEntries: number
    removedBytes: number
    remainingBytes: number
  } {
    const root = input.rootDirectory ?? this.deps.rootDirectory ?? resolveShennianPath('attachment-cache')
    const entries = listCacheEntries(root)
    const preserve = input.preservePath ? path.resolve(input.preservePath) : null
    const maxAge = this.deps.maxCacheAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS
    const maxBytes = this.deps.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES
    const cutoff = (input.now ?? new Date()).getTime() - maxAge
    let remainingBytes = entries.reduce((sum, entry) => sum + entry.byteSize, 0)
    let removedEntries = 0
    let removedBytes = 0
    for (const entry of entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)) {
      if (path.resolve(entry.filePath) === preserve) continue
      if (entry.lastAccessedAt >= cutoff && remainingBytes <= maxBytes) continue
      fs.rmSync(entry.directory, { recursive: true, force: true })
      removedEntries += 1
      removedBytes += entry.byteSize
      remainingBytes -= entry.byteSize
    }
    return { removedEntries, removedBytes, remainingBytes }
  }
}

function createAbortableTimeout(
  source: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const abortFromSource = () => controller.abort()
  if (source?.aborted) controller.abort()
  else source?.addEventListener('abort', abortFromSource, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      source?.removeEventListener('abort', abortFromSource)
    },
  }
}

function validateId(value: string, field: string): void {
  if (!SAFE_ID.test(value))
    throw new RoomAttachmentCacheError(`invalid_${field}`, `Invalid ${field}.`)
}

function validateMetadata(byteSize: string, sha256: string): void {
  if (!/^(0|[1-9]\d{0,15})$/.test(byteSize) || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new RoomAttachmentCacheError(
      'invalid_attachment_metadata',
      'Invalid attachment metadata.',
    )
  }
}

function validateCapability(
  capability: {
    attachmentId: string
    roomId: string
    safeName: string
    mimeType: string
    byteSize: string
    sha256: string
    downloadUrl: string
    expiresAt: string
  },
  roomId: string,
  attachmentId: string,
): void {
  let url: URL
  const expiresAt = Date.parse(capability.expiresAt)
  try {
    url = new URL(capability.downloadUrl)
  } catch {
    throw new RoomAttachmentCacheError(
      'invalid_attachment_capability',
      'Invalid attachment capability.',
    )
  }
  if (
    capability.roomId !== roomId ||
    capability.attachmentId !== attachmentId ||
    capability.safeName.length < 1 ||
    capability.safeName.length > 255 ||
    capability.safeName !== capability.safeName.trim() ||
    capability.safeName === '.' ||
    capability.safeName === '..' ||
    /[\\/\0-\x1f\x7f]/.test(capability.safeName) ||
    url.protocol !== 'https:' ||
    Boolean(url.username || url.password || url.hash) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 5 * 60_000
  ) {
    throw new RoomAttachmentCacheError(
      'invalid_attachment_capability',
      'Invalid attachment capability.',
    )
  }
  validateMetadata(capability.byteSize, capability.sha256)
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
}

function verifyExisting(target: string, byteSize: number, sha256: string): boolean {
  try {
    const stat = fs.lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== byteSize) return false
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') === sha256
  } catch {
    return false
  }
}

function writeCacheMetadata(
  directory: string,
  capability: {
    attachmentId: string
    roomId: string
    safeName: string
    mimeType: string
    byteSize: string
    sha256: string
  },
  now: Date,
): void {
  const target = path.join(directory, 'metadata.json')
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  try {
    fs.writeFileSync(
      temporary,
      `${JSON.stringify({
        schemaVersion: 1,
        safeName: capability.safeName,
        mimeType: capability.mimeType,
        byteSize: capability.byteSize,
        sha256: capability.sha256,
        lastAccessedAt: now.toISOString(),
      })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    )
    renameSyncWithRetry(temporary, target)
    if (process.platform !== 'win32') fs.chmodSync(target, 0o600)
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch {}
  }
}

function listCacheEntries(root: string): Array<{
  directory: string
  filePath: string
  byteSize: number
  lastAccessedAt: number
}> {
  if (!fs.existsSync(root)) return []
  const entries = []
  for (const contextHash of fs.readdirSync(root)) {
    if (!/^[a-f0-9]{64}$/.test(contextHash)) continue
    const attachments = path.join(root, contextHash)
    if (!isRealDirectory(attachments)) continue
    for (const attachmentHash of fs.readdirSync(attachments)) {
      if (!/^[a-f0-9]{64}$/.test(attachmentHash)) continue
      const directory = path.join(attachments, attachmentHash)
      if (!isRealDirectory(directory)) continue
      const metadata = readCacheMetadata(directory)
      if (!metadata) continue
      const filePath = path.join(directory, metadata.safeName)
      let stat: fs.Stats
      try {
        stat = fs.lstatSync(filePath)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      entries.push({
        directory,
        filePath,
        byteSize: stat.size,
        lastAccessedAt: Date.parse(metadata.lastAccessedAt),
      })
    }
  }
  return entries
}

function readCacheMetadata(directory: string): { safeName: string; lastAccessedAt: string } | null {
  try {
    const metadataPath = path.join(directory, 'metadata.json')
    const stat = fs.lstatSync(metadataPath)
    if (!stat.isFile() || stat.isSymbolicLink()) return null
    const value = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
    if (
      value.schemaVersion !== 1 ||
      typeof value.safeName !== 'string' ||
      /[\\/\0-\x1f\x7f]/.test(value.safeName) ||
      typeof value.lastAccessedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.lastAccessedAt))
    ) {
      return null
    }
    return { safeName: value.safeName, lastAccessedAt: value.lastAccessedAt }
  } catch {
    return null
  }
}

function isRealDirectory(directory: string): boolean {
  try {
    const stat = fs.lstatSync(directory)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}
