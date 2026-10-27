// @arch docs/features/desktop-local-first-client.md#84-desktop-文件夹上传
// @test packages/app/src/__tests__/desktop-folder-upload.test.ts

import { Platform, Share } from 'react-native'
import { Directory, File as ExpoFile, Paths } from 'expo-file-system'
import * as FileSystemLegacy from 'expo-file-system/legacy'
import { saveAndroidDocument } from 'expo-document-saver'
import type { FsEntry, ReqFrame, ResFrame } from '@shennian/wire'
import {
  getDesktopFilesBridge,
  saveDesktopFileBytes,
} from '../../features/desktop-control/desktopFileOperations'

export type SendFn = (frame: Omit<ReqFrame, 'id'>) => Promise<ResFrame>

export type UploadReadableFile = {
  name: string
  size: number
  type?: string
  lastModified?: number
  relativePath?: string
  slice?: (start?: number, end?: number) => Blob
  readChunk?: (offset: number, limitBytes: number) => Promise<Uint8Array>
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])
const RASTER_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])
export const IMAGE_PREVIEW_MAX_SIZE = 20 * 1024 * 1024
const CHUNK_SIZE = 1024 * 1024
const IMAGE_PREVIEW_CHUNK_SIZE = 768 * 1024

export function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

export function isPreviewable(filename: string): boolean {
  const ext = getExt(filename)
  const textExts = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
    'c', 'cpp', 'h', 'hpp', 'cs', 'php',
    'html', 'htm', 'css', 'scss', 'less',
    'json', 'jsonc', 'yaml', 'yml', 'toml',
    'xml', 'svg', 'md', 'mdx',
    'sh', 'bash', 'zsh', 'fish',
    'sql', 'graphql', 'dockerfile', 'makefile',
    'sol',
    'vue', 'svelte', 'txt', 'log', 'env', 'gitignore',
    'ini', 'conf', 'cfg', 'r', 'lua', 'perl', 'dart',
  ])
  return IMAGE_EXTS.has(ext) || textExts.has(ext)
}

export function isImageFile(filename: string): boolean {
  return RASTER_IMAGE_EXTS.has(getExt(filename))
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function sanitizeTestIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'file'
}

export function guessMimeType(filename: string): string {
  switch (getExt(filename)) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'heic':
      return 'image/heic'
    case 'heif':
      return 'image/heif'
    case 'svg':
      return 'image/svg+xml'
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    case 'avi':
      return 'video/x-msvideo'
    case 'pdf':
      return 'application/pdf'
    case 'ppt':
      return 'application/vnd.ms-powerpoint'
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'doc':
      return 'application/msword'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xls':
      return 'application/vnd.ms-excel'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'zip':
      return 'application/zip'
    case 'json':
      return 'application/json'
    case 'md':
      return 'text/markdown'
    case 'txt':
    case 'log':
    case 'sh':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'sol':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}

type FileSystemWritable = {
  write: (data: Blob) => Promise<void> | void
  close: () => Promise<void> | void
}

type FileSystemFileHandle = {
  createWritable: () => Promise<FileSystemWritable>
}

type ShowSaveFilePicker = (options: { suggestedName: string }) => Promise<FileSystemFileHandle>

export type WebDownloadResult = 'browser' | 'picker'

export class WebDownloadCanceledError extends Error {
  constructor() {
    super('Download canceled')
    this.name = 'WebDownloadCanceledError'
  }
}

export function isWebDownloadCanceled(error: unknown): boolean {
  return (
    error instanceof WebDownloadCanceledError ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function getShowSaveFilePicker(): ShowSaveFilePicker | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker
  return typeof picker === 'function' ? picker.bind(window) : null
}

export function triggerWebDownloadBlob(filename: string, blob: Blob): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof URL === 'undefined') return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  try {
    a.click()
    return true
  } finally {
    document.body.removeChild(a)
    // Safari/Firefox can drop blob downloads if the object URL is revoked in
    // the same task as the synthetic click. Keep it alive briefly so the
    // browser download pipeline can consume it.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

export function triggerWebDownload(filename: string, content: string | null, data: string | null): boolean {
  if (Platform.OS !== 'web') return false
  let blob: Blob
  if (data) {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
    blob = new Blob([bytes])
  } else {
    blob = new Blob([content || ''], { type: 'text/plain' })
  }
  return triggerWebDownloadBlob(filename, blob)
}

export function prepareWebDownload(filename: string): {
  mode: WebDownloadResult
  saveBlob: (blob: Blob) => Promise<WebDownloadResult>
} | null {
  if (Platform.OS !== 'web') return null

  const desktopFiles = getDesktopFilesBridge()
  if (desktopFiles) {
    return {
      mode: 'picker',
      async saveBlob(blob: Blob) {
        const saved = await saveDesktopFileBytes(
          filename,
          new Uint8Array(await blob.arrayBuffer()),
          desktopFiles,
        )
        if (!saved) throw new WebDownloadCanceledError()
        return 'picker'
      },
    }
  }

  const picker = getShowSaveFilePicker()
  if (picker) {
    let handlePromise: Promise<FileSystemFileHandle>
    try {
      // Must be called synchronously from the click handler; awaiting the
      // remote file read first loses user activation in Chromium browsers.
      handlePromise = picker({ suggestedName: filename })
    } catch (error) {
      handlePromise = Promise.reject(isWebDownloadCanceled(error) ? new WebDownloadCanceledError() : error)
    }
    return {
      mode: 'picker',
      async saveBlob(blob: Blob) {
        let handle: FileSystemFileHandle
        try {
          handle = await handlePromise
        } catch (error) {
          if (isWebDownloadCanceled(error)) throw new WebDownloadCanceledError()
          throw error
        }
        const writable = await handle.createWritable()
        try {
          await writable.write(blob)
        } finally {
          await writable.close()
        }
        return 'picker'
      },
    }
  }

  return {
    mode: 'browser',
    async saveBlob(blob: Blob) {
      const ok = triggerWebDownloadBlob(filename, blob)
      if (!ok) throw new Error('Browser download is not available')
      return 'browser'
    },
  }
}

export function isUnsupportedArchiveZipError(message: string): boolean {
  return /unknown method|method not found|not supported/i.test(message)
}

export async function archiveRemoteDirectory(send: SendFn, entry: FsEntry): Promise<FsEntry> {
  const res = await send({
    type: 'req',
    method: 'fs.archive.zip',
    params: {
      path: entry.path,
      rootPath: entry.path,
    },
  })
  if (!res.ok) throw new Error(res.error ?? 'Folder download failed')
  const payload = res.payload as { outputPath: string; entry?: FsEntry }
  const fallbackName = `${entry.name.replace(/\.zip$/i, '')}.zip`
  return {
    path: payload.outputPath,
    name: payload.entry?.name ?? fallbackName,
    isDir: false,
    ...(payload.entry ?? {}),
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function readRemoteFileBytes(
  send: SendFn,
  filePath: string,
  onProgress: (pct: number) => void,
  rootPath?: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let offset = 0

  while (true) {
    const res = await send({
      type: 'req',
      method: 'fs.read',
      params: { path: filePath, rootPath: rootPath ?? filePath, offset, length: CHUNK_SIZE, encoding: 'base64' },
    })
    if (!res.ok) throw new Error(res.error ?? 'Download failed')

    const payload = res.payload as { data: string; length: number; totalSize: number }

    if (payload.length > 0) {
      const raw = atob(payload.data)
      const view = new Uint8Array(raw.length)
      for (let index = 0; index < raw.length; index += 1) view[index] = raw.charCodeAt(index)
      chunks.push(view)
    }

    offset += payload.length
    onProgress(payload.totalSize > 0 ? Math.min(100, Math.round((offset / payload.totalSize) * 100)) : 100)

    if (offset >= payload.totalSize || payload.length === 0) break
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(totalLength)
  let writeOffset = 0
  for (const chunk of chunks) {
    merged.set(chunk, writeOffset)
    writeOffset += chunk.length
  }
  return merged
}

export async function readRemoteImagePreviewBase64(
  send: SendFn,
  filePath: string,
  formatTooLargeError: (size: number) => string,
  rootPath?: string,
): Promise<string> {
  const chunks: string[] = []
  let offset = 0

  while (true) {
    const res = await send({
      type: 'req',
      method: 'fs.read',
      params: { path: filePath, rootPath: rootPath ?? filePath, offset, length: IMAGE_PREVIEW_CHUNK_SIZE, encoding: 'base64' },
    })
    if (!res.ok) throw new Error(res.error ?? 'Download failed')

    const payload = res.payload as { data?: string; length: number; totalSize: number }
    if (payload.totalSize > IMAGE_PREVIEW_MAX_SIZE) {
      throw new Error(formatTooLargeError(payload.totalSize))
    }
    if (payload.data) chunks.push(payload.data)

    offset += payload.length
    if (offset >= payload.totalSize || payload.length === 0) break
  }

  const data = chunks.join('')
  if (!data) throw new Error('Unable to load image preview')
  return data
}

export async function saveNativeBytes(
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<'downloads' | 'share'> {
  const tempDir = new Directory(Paths.cache, 'downloads')
  tempDir.create({ idempotent: true, intermediates: true })

  const tempFile = new ExpoFile(tempDir, filename)
  if (tempFile.exists) tempFile.delete()
  tempFile.create({ overwrite: true, intermediates: true })
  tempFile.write(bytes)

  if (Platform.OS === 'android') {
    try {
      const result = await saveAndroidDocument(filename, bytes, mimeType)
      if (result === 'saved') return 'downloads'
    } catch (error) {
      console.warn(
        '[file-download] Android document save failed; using share sheet',
        error instanceof Error ? error.message : 'unknown error',
      )
      // Fall back to the system share sheet if the document picker cannot save the file.
    }
  }

  const shareUrl =
    Platform.OS === 'android'
      ? await FileSystemLegacy.getContentUriAsync(tempFile.uri)
      : tempFile.uri
  await Share.share({
    title: filename,
    url: shareUrl,
    message: filename,
  })
  return 'share'
}

export async function writeNativeTempFile(filename: string, bytes: Uint8Array): Promise<ExpoFile> {
  const tempDir = new Directory(Paths.cache, 'downloads')
  tempDir.create({ idempotent: true, intermediates: true })

  const tempFile = new ExpoFile(tempDir, filename)
  if (tempFile.exists) tempFile.delete()
  tempFile.create({ overwrite: true, intermediates: true })
  tempFile.write(bytes)
  return tempFile
}

export type NativeMediaType = 'photo' | 'video'

export async function saveNativeMediaToLibrary(
  filename: string,
  bytes: Uint8Array,
  mediaType: NativeMediaType,
): Promise<'library' | 'permission-denied'> {
  if (Platform.OS === 'web') throw new Error('Media library is not available on web')

  const MediaLibrary = await import('expo-media-library').catch(() => null)
  if (!MediaLibrary) return 'permission-denied'

  const permission = await MediaLibrary.requestPermissionsAsync(true, [mediaType])
  if (!permission.granted) return 'permission-denied'

  const tempFile = await writeNativeTempFile(filename, bytes)
  await MediaLibrary.saveToLibraryAsync(tempFile.uri)
  return 'library'
}

export async function saveNativeImageToLibrary(
  filename: string,
  bytes: Uint8Array,
): Promise<'library' | 'permission-denied'> {
  return saveNativeMediaToLibrary(filename, bytes, 'photo')
}

export async function chunkedUpload(
  send: SendFn,
  file: UploadReadableFile,
  targetPath: string,
  direct: boolean,
  onProgress: (pct: number) => void,
  options?: { rootPath?: string; relativePath?: string; transferId?: string; finish?: boolean },
): Promise<void> {
  let transferId = options?.transferId
  if (!transferId) {
    const startRes = await send({
      type: 'req',
      method: 'fs.transfer.start',
      params: { name: file.name, targetPath, rootPath: options?.rootPath ?? targetPath, totalSize: file.size, direct },
    })
    if (!startRes.ok) throw new Error(startRes.error ?? 'Upload start failed')
    transferId = (startRes.payload as { transferId: string }).transferId
  }

  try {
    let offset = 0
    while (offset < file.size) {
      const chunkLen = Math.min(CHUNK_SIZE, file.size - offset)
      const base64 = file.readChunk
        ? encodeBytesBase64(await file.readChunk(offset, chunkLen), chunkLen)
        : await blobToBase64(requireUploadSlice(file, offset, chunkLen))

      const chunkRes = await send({
        type: 'req',
        method: 'fs.transfer.chunk',
        params: { transferId, offset, data: base64, relativePath: options?.relativePath },
      })
      if (!chunkRes.ok) throw new Error(chunkRes.error ?? 'Chunk upload failed')

      offset += chunkLen
      onProgress(Math.min(100, Math.round((offset / file.size) * 100)))
    }

    if (options?.finish !== false) {
      const finishRes = await send({
        type: 'req',
        method: 'fs.transfer.finish',
        params: { transferId },
      })
      if (!finishRes.ok) throw new Error(finishRes.error ?? 'Upload finish failed')
    }
  } catch (err) {
    if (transferId) await send({ type: 'req', method: 'fs.transfer.abort', params: { transferId } }).catch(() => {})
    throw err
  }
}

export async function uploadFolder(
  send: SendFn,
  files: UploadReadableFile[],
  targetPath: string,
  direct: boolean,
  onProgress: (pct: number) => void,
  rootPath?: string,
): Promise<string> {
  const folderFiles = files
    .map((file) => ({
      file,
      relativePath:
        file.relativePath ||
        (file as UploadReadableFile & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name,
    }))
    .filter((item) => item.relativePath)
  if (!folderFiles.length) throw new Error('No files selected')
  const firstPath = folderFiles[0].relativePath
  const folderName = firstPath.split('/')[0] || 'folder'
  const totalSize = folderFiles.reduce((sum, item) => sum + item.file.size, 0)
  const startRes = await send({
    type: 'req',
    method: 'fs.transfer.start',
    params: {
      name: folderName,
      baseName: folderName,
      kind: 'folder',
      targetPath,
      rootPath: rootPath ?? targetPath,
      totalSize,
      direct,
      manifest: folderFiles.map((item) => ({
        relativePath: item.relativePath.split('/').slice(1).join('/') || item.file.name,
        size: item.file.size,
        mimeType: item.file.type || guessMimeType(item.file.name),
        modifiedAt: item.file.lastModified ?? 0,
      })),
    },
  })
  if (!startRes.ok) throw new Error(startRes.error ?? 'Folder upload start failed')
  const { transferId, path } = startRes.payload as { transferId: string; path?: string }

  let uploaded = 0
  try {
    for (const item of folderFiles) {
      const relativePath = item.relativePath.split('/').slice(1).join('/') || item.file.name
      await chunkedUpload(
        send,
        item.file,
        targetPath,
        direct,
        (filePct) => {
          const fileUploaded = Math.round((filePct / 100) * item.file.size)
          onProgress(totalSize > 0 ? Math.min(99, Math.round(((uploaded + fileUploaded) / totalSize) * 100)) : 99)
        },
        { rootPath: rootPath ?? targetPath, relativePath, transferId, finish: false },
      )
      uploaded += item.file.size
    }
    const finishRes = await send({ type: 'req', method: 'fs.transfer.finish', params: { transferId } })
    if (!finishRes.ok) throw new Error(finishRes.error ?? 'Folder upload finish failed')
    onProgress(100)
    return (finishRes.payload as { path?: string }).path ?? path ?? targetPath
  } catch (err) {
    await send({ type: 'req', method: 'fs.transfer.abort', params: { transferId } }).catch(() => {})
    throw err
  }
}

function requireUploadSlice(file: UploadReadableFile, offset: number, chunkLen: number): Blob {
  if (!file.slice) throw new Error('Upload source is unreadable')
  return file.slice(offset, offset + chunkLen)
}

function encodeBytesBase64(bytes: Uint8Array, expectedLength: number): string {
  if (bytes.byteLength !== expectedLength) throw new Error('Upload source changed while reading')
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 16 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.byteLength, offset + 16 * 1024)))
  }
  return btoa(binary)
}
