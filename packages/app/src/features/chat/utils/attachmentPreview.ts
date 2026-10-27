// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/attachment-preview.test.ts

import { type ChatAttachment } from '@shennian/shared'
import type { FsEntry } from '@shennian/wire'
import { Platform } from 'react-native'
import { accountRuntime } from '../../account-runtime/accountRuntime'

type TimedCacheEntry<T> = { value: T; accessedAt: number }
const MEMORY_PREVIEW_MAX_ENTRIES = 64
const MEMORY_PREVIEW_TTL_MS = 30 * 60 * 1000
const imagePreviewCache = new Map<string, TimedCacheEntry<string>>()
type ImagePreviewResult = { data: string | null; error: string }
const imagePreviewInflight = new Map<string, Promise<ImagePreviewResult>>()
export type DirectoryPreviewResult = { path: string; entries: FsEntry[] }
export type FilePreviewResult = {
  content: string | null
  data: string | null
  error: string
  directory?: DirectoryPreviewResult | null
}
const filePreviewCache = new Map<string, TimedCacheEntry<FilePreviewResult>>()
const filePreviewInflight = new Map<string, Promise<FilePreviewResult>>()
let attachmentPreviewGeneration = 0
type LoadAttachmentPreviewOptions = {
  refresh?: boolean
  rootPath?: string
}

function sendFileRequest(
  machineId: string,
  frame: { type: 'req'; method: 'fs.read' | 'fs.ls'; params: Record<string, unknown> },
) {
  return accountRuntime.requestMachine(machineId, frame.method, frame.params, {
    waitUntilReady: false,
  })
}

export const IMAGE_PREVIEW_MAX_SIZE = 20 * 1024 * 1024
const IMAGE_PREVIEW_CHUNK_SIZE = 768 * 1024
const BINARY_PREVIEW_MAX_SIZE = 20 * 1024 * 1024
const BINARY_PREVIEW_CHUNK_SIZE = 768 * 1024

function cacheKey(machineId: string, path: string): string {
  return `${machineId}:${path}`
}

function readMemoryCache<T>(cache: Map<string, TimedCacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.accessedAt > MEMORY_PREVIEW_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  cache.delete(key)
  cache.set(key, { value: entry.value, accessedAt: Date.now() })
  return entry.value
}

function writeMemoryCache<T>(cache: Map<string, TimedCacheEntry<T>>, key: string, value: T): void {
  const now = Date.now()
  for (const [existingKey, entry] of cache) {
    if (now - entry.accessedAt > MEMORY_PREVIEW_TTL_MS) cache.delete(existingKey)
  }
  cache.delete(key)
  cache.set(key, { value, accessedAt: now })
  while (cache.size > MEMORY_PREVIEW_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (!oldestKey) break
    cache.delete(oldestKey)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatPreviewError(
  fallback: string,
  res?: { error?: string; payload?: unknown },
): string {
  const payload = res?.payload as { size?: number } | undefined
  if (payload?.size) {
    return `File too large to preview (${formatSize(payload.size)}; max ${formatSize(IMAGE_PREVIEW_MAX_SIZE)})`
  }
  return res?.error ?? fallback
}

function formatOversizedPreviewError(size: number): string {
  return `File too large to preview (${formatSize(size)}; max ${formatSize(IMAGE_PREVIEW_MAX_SIZE)})`
}

export function isDirectoryReadError(message?: string | null): boolean {
  return /not a file|eisdir/i.test(String(message || ''))
}

function cacheResult(
  key: string,
  result: FilePreviewResult,
  generation = attachmentPreviewGeneration,
): FilePreviewResult {
  if (generation === attachmentPreviewGeneration) writeMemoryCache(filePreviewCache, key, result)
  return result
}

export async function clearAllAttachmentPreviewCaches(): Promise<void> {
  attachmentPreviewGeneration += 1
  imagePreviewCache.clear()
  filePreviewCache.clear()
  imagePreviewInflight.clear()
  filePreviewInflight.clear()
  if (Platform.OS !== 'web') {
    const { clearNativeImagePreviewCache } = await import('./nativeImagePreviewCache')
    await clearNativeImagePreviewCache()
  }
}

function isBinaryPreviewAttachment(
  attachment: Pick<ChatAttachment, 'name'> & { mimeType?: string },
): boolean {
  const mimeType = attachment.mimeType?.toLowerCase() ?? ''
  const name = attachment.name.toLowerCase()
  return (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/') ||
    /\.(?:pdf|mp3|m4a|aac|wav|ogg|oga|flac|opus|mp4|mov|webm|m4v|avi)$/i.test(name)
  )
}

function inferBinaryPreviewMimeType(
  attachment: Pick<ChatAttachment, 'name'> & { mimeType?: string },
): string {
  const mimeType = attachment.mimeType?.toLowerCase()
  if (mimeType && mimeType !== 'application/octet-stream') return attachment.mimeType ?? mimeType
  const ext = attachment.name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf':
      return 'application/pdf'
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    case 'flac':
      return 'audio/flac'
    case 'opus':
      return 'audio/opus'
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    case 'avi':
      return 'video/x-msvideo'
    default:
      return 'application/octet-stream'
  }
}

async function readBinaryAttachmentPreview(
  machineId: string,
  attachment: Pick<ChatAttachment, 'path' | 'name'> & { mimeType?: string },
  rootPath: string | undefined,
  refresh = false,
): Promise<FilePreviewResult> {
  if (Platform.OS !== 'web' && inferBinaryPreviewMimeType(attachment) === 'application/pdf') {
    const { loadNativePdfPreview } = await import('./nativeImagePreviewCache')
    try {
      const uri = await loadNativePdfPreview({
        cacheKey: cacheKey(machineId, attachment.path),
        maxSize: BINARY_PREVIEW_MAX_SIZE,
        refresh,
        readChunk: async (offset) => {
          const res = await sendFileRequest(machineId, {
            type: 'req',
            method: 'fs.read',
            params: {
              path: attachment.path,
              rootPath: rootPath ?? attachment.path,
              offset,
              length: BINARY_PREVIEW_CHUNK_SIZE,
              encoding: 'base64',
            },
          })
          if (!res.ok) throw new Error(formatPreviewError('Unable to load file preview', res))
          return (res.payload ?? {}) as { data?: string; length?: number; totalSize?: number }
        },
      })
      return { content: null, data: uri, error: '' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load file preview'
      const oversized = /^preview_too_large:(\d+)$/.exec(message)
      return {
        content: null,
        data: null,
        error: oversized ? formatOversizedPreviewError(Number(oversized[1])) : message,
      }
    }
  }
  let offset = 0
  const chunks: string[] = []

  while (true) {
    const res = await sendFileRequest(machineId, {
      type: 'req',
      method: 'fs.read',
      params: {
        path: attachment.path,
        rootPath: rootPath ?? attachment.path,
        offset,
        length: BINARY_PREVIEW_CHUNK_SIZE,
        encoding: 'base64',
      },
    })
    if (!res.ok) {
      return { content: null, data: null, error: formatPreviewError('Unable to load file preview', res) }
    }

    const payload = res.payload as
      | { data?: string; length?: number; totalSize?: number }
      | undefined
    const totalSize = payload?.totalSize ?? 0
    if (totalSize > BINARY_PREVIEW_MAX_SIZE) {
      return { content: null, data: null, error: formatOversizedPreviewError(totalSize) }
    }

    const readLength = payload?.length ?? 0
    if (payload?.data) chunks.push(payload.data)
    offset += readLength

    if (readLength <= 0 || offset >= totalSize) break
  }

  const data = chunks.join('')
  if (!data) return { content: null, data: null, error: 'Unable to load file preview' }
  const mimeType = inferBinaryPreviewMimeType(attachment)
  return { content: null, data: data.startsWith('data:') ? data : `data:${mimeType};base64,${data}`, error: '' }
}

async function readDirectoryAttachmentPreview(
  machineId: string,
  pathValue: string,
  rootPath: string | undefined,
): Promise<FilePreviewResult> {
  const res = await sendFileRequest(machineId, {
    type: 'req',
    method: 'fs.ls',
    params: {
      path: pathValue,
      rootPath: rootPath ?? pathValue,
    },
  })
  if (!res.ok) {
    return { content: null, data: null, error: formatPreviewError('Unable to load directory', res) }
  }

  const payload = res.payload as { path?: string; entries?: FsEntry[] } | undefined
  return {
    content: null,
    data: null,
    error: '',
    directory: {
      path: payload?.path ?? pathValue,
      entries: Array.isArray(payload?.entries) ? payload.entries : [],
    },
  }
}

export function getCachedFilePreview(
  machineId: string | null,
  attachment: Pick<ChatAttachment, 'path' | 'name' | 'kind' | 'previewData'>,
): FilePreviewResult | undefined {
  if (attachment.kind === 'image' && attachment.previewData) {
    return { content: null, data: attachment.previewData, error: '' }
  }
  if (!machineId) return undefined
  return readMemoryCache(filePreviewCache, cacheKey(machineId, attachment.path))
}

export function getCachedAttachmentPreview(
  machineId: string | null,
  attachment: Pick<ChatAttachment, 'path' | 'previewData'>,
): string | undefined {
  if (attachment.previewData) return attachment.previewData
  if (!machineId) return undefined
  return readMemoryCache(imagePreviewCache, cacheKey(machineId, attachment.path))
}

export function cacheImageAttachmentPreview(
  machineId: string | null,
  attachment: Pick<ChatAttachment, 'path'>,
  previewData: string,
): void {
  if (!machineId || !previewData) return
  const key = cacheKey(machineId, attachment.path)
  writeMemoryCache(imagePreviewCache, key, previewData)
  writeMemoryCache(filePreviewCache, key, { content: null, data: previewData, error: '' })
}

export async function cacheLocalImageAttachmentPreview(
  machineId: string | null,
  attachment: Pick<ChatAttachment, 'path'>,
  sourceUri: string,
): Promise<string | null> {
  if (!machineId || !sourceUri) return null
  const key = cacheKey(machineId, attachment.path)
  const generation = attachmentPreviewGeneration
  if (Platform.OS === 'web') {
    if (generation === attachmentPreviewGeneration) {
      writeMemoryCache(imagePreviewCache, key, sourceUri)
    }
    return sourceUri
  }

  try {
    const { cacheNativeLocalImagePreview } = await import('./nativeImagePreviewCache')
    const previewUri = await cacheNativeLocalImagePreview(key, sourceUri, /\.svg$/i.test(attachment.path))
    if (generation === attachmentPreviewGeneration) {
      writeMemoryCache(imagePreviewCache, key, previewUri)
      writeMemoryCache(filePreviewCache, key, { content: null, data: previewUri, error: '' })
    }
    return previewUri
  } catch {
    // The picker URI is still preferable to serializing the full image into
    // the WebView bridge. The durable cache can be rebuilt from the machine.
    if (generation === attachmentPreviewGeneration) {
      writeMemoryCache(imagePreviewCache, key, sourceUri)
    }
    return sourceUri
  }
}

function readImageAttachmentPreview(
  machineId: string | null,
  attachment: Pick<ChatAttachment, 'path' | 'previewData'> & { mimeType?: string },
): Promise<ImagePreviewResult> {
  if (attachment.previewData) return Promise.resolve({ data: attachment.previewData, error: '' })
  if (!machineId) return Promise.resolve({ data: null, error: 'Machine is offline' })

  const key = cacheKey(machineId, attachment.path)
  const cached = readMemoryCache(imagePreviewCache, key)
  if (cached) return Promise.resolve({ data: cached, error: '' })

  const existing = imagePreviewInflight.get(key)
  if (existing) return existing

  const request = (async (): Promise<ImagePreviewResult> => {
    const generation = attachmentPreviewGeneration
    if (Platform.OS !== 'web') {
      const { loadNativeImagePreview } = await import('./nativeImagePreviewCache')
      try {
        const previewUri = await loadNativeImagePreview({
          cacheKey: key,
          svg: /\.svg$/i.test(attachment.path) ||
            attachment.mimeType?.split(';')[0].trim().toLowerCase() === 'image/svg+xml',
          maxSize: IMAGE_PREVIEW_MAX_SIZE,
          readChunk: async (offset) => {
            const res = await sendFileRequest(machineId, {
              type: 'req',
              method: 'fs.read',
              params: {
                path: attachment.path,
                rootPath: attachment.path,
                offset,
                length: IMAGE_PREVIEW_CHUNK_SIZE,
                encoding: 'base64',
              },
            })
            if (!res.ok) {
              throw new Error(formatPreviewError('Unable to load image preview', res))
            }
            return (res.payload ?? {}) as {
              data?: string
              length?: number
              totalSize?: number
            }
          },
        })
        if (generation === attachmentPreviewGeneration) {
          writeMemoryCache(imagePreviewCache, key, previewUri)
        }
        return { data: previewUri, error: '' }
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const oversized = /^preview_too_large:(\d+)$/.exec(message)
        return {
          data: null,
          error: oversized
            ? formatOversizedPreviewError(Number(oversized[1]))
            : message || 'Unable to load image preview',
        }
      }
    }

    let offset = 0
    const chunks: string[] = []

    while (true) {
      const res = await sendFileRequest(machineId, {
        type: 'req',
        method: 'fs.read',
        params: {
          path: attachment.path,
          rootPath: attachment.path,
          offset,
          length: IMAGE_PREVIEW_CHUNK_SIZE,
          encoding: 'base64',
        },
      })
      if (!res.ok) {
        return { data: null, error: formatPreviewError('Unable to load image preview', res) }
      }

      const payload = res.payload as
        | { data?: string; length?: number; totalSize?: number }
        | undefined
      const totalSize = payload?.totalSize ?? 0
      if (totalSize > IMAGE_PREVIEW_MAX_SIZE) {
        return { data: null, error: formatOversizedPreviewError(totalSize) }
      }

      const readLength = payload?.length ?? 0
      if (payload?.data) chunks.push(payload.data)
      offset += readLength

      if (readLength <= 0 || offset >= totalSize) break
    }

    const data = chunks.join('')
    if (!data) return { data: null, error: 'Unable to load image preview' }
    const mimeType = 'mimeType' in attachment && typeof attachment.mimeType === 'string'
      ? attachment.mimeType
      : 'image/png'
    const previewData = data.startsWith('data:') ? data : `data:${mimeType};base64,${data}`
    if (generation === attachmentPreviewGeneration) {
      writeMemoryCache(imagePreviewCache, key, previewData)
    }
    return { data: previewData, error: '' }
  })()
    .catch(() => {
      return { data: null, error: 'Unable to load image preview' }
    })
    .finally(() => {
      imagePreviewInflight.delete(key)
    })

  imagePreviewInflight.set(key, request)
  return request
}

export async function ensureImageAttachmentPreview(
  machineId: string | null,
  attachment: Pick<ChatAttachment, 'path' | 'previewData' | 'mimeType'>,
): Promise<string | null> {
  const result = await readImageAttachmentPreview(machineId, attachment)
  return result.data
}

export async function loadAttachmentPreview(
  machineId: string | null,
  attachment: Pick<ChatAttachment, 'path' | 'name' | 'kind' | 'previewData'> & { mimeType?: string },
  options: LoadAttachmentPreviewOptions = {},
): Promise<FilePreviewResult> {
  const cached = options.refresh ? undefined : getCachedFilePreview(machineId, attachment)
  if (cached) return cached

  if (attachment.kind === 'image') {
    if (attachment.previewData) {
      return { content: null, data: attachment.previewData, error: '' }
    }
    if (!machineId) {
      return { content: null, data: null, error: 'Machine is offline' }
    }
    const key = cacheKey(machineId, attachment.path)
    const generation = attachmentPreviewGeneration
    const existing = filePreviewInflight.get(key)
    if (existing) return existing

    const request = readImageAttachmentPreview(machineId, attachment)
      .then((result) =>
        isDirectoryReadError(result.error)
          ? readDirectoryAttachmentPreview(machineId, attachment.path, options.rootPath).then(
              (directoryResult) => cacheResult(key, directoryResult, generation),
            )
          : cacheResult(key, { content: null, data: result.data, error: result.error }, generation),
      )
      .finally(() => {
        filePreviewInflight.delete(key)
      })

    filePreviewInflight.set(key, request)
    return request
  }

  if (!machineId) {
    return { content: null, data: null, error: 'Machine is offline' }
  }

  const key = cacheKey(machineId, attachment.path)
  const generation = attachmentPreviewGeneration
  const existing = filePreviewInflight.get(key)
  if (existing) return existing

  const readDirectory = () =>
    readDirectoryAttachmentPreview(machineId, attachment.path, options.rootPath)

  const request = (async (): Promise<FilePreviewResult> => {
    if (attachment.kind === 'folder') {
      return readDirectory()
    }

    if (isBinaryPreviewAttachment(attachment)) {
      const result = await readBinaryAttachmentPreview(
        machineId,
        attachment,
        options.rootPath,
        options.refresh,
      )
      return isDirectoryReadError(result.error) ? readDirectory() : result
    }

    const res = await sendFileRequest(machineId, {
      type: 'req',
      method: 'fs.read',
      params: {
        path: attachment.path,
        rootPath: options.rootPath ?? attachment.path,
        encoding: 'auto',
      },
    })
    if (!res.ok) {
      if (isDirectoryReadError(res.error)) return readDirectory()
      return {
        content: null,
        data: null,
        error: formatPreviewError('Unable to load file preview', res),
      }
    }

    const payload = res.payload as { content?: string } | undefined
    return { content: payload?.content ?? null, data: null, error: '' }
  })()
    .then((result) => cacheResult(key, result, generation))
    .catch((error) =>
      isDirectoryReadError(error instanceof Error ? error.message : String(error))
        ? readDirectory().then((result) => cacheResult(key, result, generation))
        : cacheResult(
            key,
            {
              content: null,
              data: null,
              error: error instanceof Error ? error.message : 'Unable to load file preview',
            },
            generation,
          ),
    )
    .finally(() => {
      filePreviewInflight.delete(key)
    })

  filePreviewInflight.set(key, request)
  return request
}
