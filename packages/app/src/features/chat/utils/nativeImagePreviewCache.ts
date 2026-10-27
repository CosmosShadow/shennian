// @arch docs/architecture/app/chat-attachments-preview.md#Native-图片磁盘缓存
// @test src/__tests__/native-image-preview-cache.test.ts

import * as Crypto from 'expo-crypto'
import { Directory, File as ExpoFile, Paths } from 'expo-file-system'
import * as ImageManipulator from 'expo-image-manipulator'

const CACHE_DIRECTORY_NAME = 'chat-image-previews'
const PART_SUFFIX = '.part'
const MAX_CACHE_BYTES = 96 * 1024 * 1024
const MAX_CACHE_FILES = 120
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const THUMBNAIL_WIDTH = 960

export type NativeImagePreviewChunk = {
  data?: string
  length?: number
  totalSize?: number
}

type LoadNativeImagePreviewOptions = {
  cacheKey: string
  maxSize: number
  svg?: boolean
  pdf?: boolean
  refresh?: boolean
  readChunk: (offset: number) => Promise<NativeImagePreviewChunk>
}

let prunePromise: Promise<void> | null = null
const activePartials = new Set<string>()

function getCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME)
  directory.create({ idempotent: true, intermediates: true })
  return directory
}

async function cacheBasename(cacheKey: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, cacheKey)
}

function validCachedFile(file: ExpoFile): boolean {
  return file.exists && Number(file.size) > 0
}

function schedulePrune(directory: Directory): void {
  if (prunePromise) return
  prunePromise = Promise.resolve()
    .then(() => {
      const now = Date.now()
      const files = directory
        .list()
        .filter((entry): entry is ExpoFile => entry instanceof ExpoFile)

      for (const file of files) {
        if (activePartials.has(file.uri)) continue
        const age = now - (file.modificationTime ?? now)
        if (file.name.endsWith(PART_SUFFIX) || age > MAX_CACHE_AGE_MS) {
          try {
            file.delete()
          } catch {
            // Cache cleanup is best effort.
          }
        }
      }

      const remaining = directory
        .list()
        .filter((entry): entry is ExpoFile => entry instanceof ExpoFile)
        .filter((entry) => !activePartials.has(entry.uri))
        .sort((left, right) => (right.modificationTime ?? 0) - (left.modificationTime ?? 0))
      let totalBytes = 0
      for (let index = 0; index < remaining.length; index++) {
        const file = remaining[index]!
        totalBytes += Number(file.size) || 0
        if (index < MAX_CACHE_FILES && totalBytes <= MAX_CACHE_BYTES) continue
        try {
          file.delete()
        } catch {
          // Cache cleanup is best effort.
        }
      }
    })
    .finally(() => {
      prunePromise = null
    })
}

async function normalizeThumbnail(source: ExpoFile, destination: ExpoFile): Promise<void> {
  const result = await ImageManipulator.manipulateAsync(
    source.uri,
    [{ resize: { width: THUMBNAIL_WIDTH } }],
    { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG },
  )
  const normalized = new ExpoFile(result.uri)
  if (destination.exists) destination.delete()
  normalized.copy(destination)
}

export async function cacheNativeLocalImagePreview(
  cacheKey: string,
  sourceUri: string,
  svg = false,
): Promise<string> {
  const directory = getCacheDirectory()
  const basename = await cacheBasename(cacheKey)
  const destination = new ExpoFile(directory, `${basename}.${svg ? 'svg' : 'jpg'}`)
  if (!validCachedFile(destination)) {
    if (svg) new ExpoFile(sourceUri).copy(destination)
    else await normalizeThumbnail(new ExpoFile(sourceUri), destination)
  }
  schedulePrune(directory)
  return destination.uri
}

async function loadNativePreview(options: LoadNativeImagePreviewOptions): Promise<string> {
  const directory = getCacheDirectory()
  const basename = await cacheBasename(options.cacheKey)
  const destination = new ExpoFile(
    directory,
    `${basename}.${options.pdf ? 'pdf' : options.svg ? 'svg' : 'jpg'}`,
  )
  if (!options.refresh && validCachedFile(destination)) return destination.uri

  const partial = new ExpoFile(directory, `${basename}${PART_SUFFIX}`)
  if (partial.exists) partial.delete()
  partial.create({ overwrite: true, intermediates: true })
  activePartials.add(partial.uri)

  let offset = 0
  let expectedSize = 0
  try {
    while (true) {
      const payload = await options.readChunk(offset)
      const totalSize = Number(payload.totalSize) || 0
      const readLength = Number(payload.length) || 0
      if (totalSize > options.maxSize) {
        throw new Error(`preview_too_large:${totalSize}`)
      }
      if (expectedSize > 0 && totalSize !== expectedSize) {
        throw new Error('preview_size_changed')
      }
      if (totalSize > 0) expectedSize = totalSize
      if (
        !Number.isSafeInteger(totalSize) ||
        totalSize <= 0 ||
        !Number.isSafeInteger(readLength) ||
        readLength <= 0 ||
        readLength > 768 * 1024 ||
        offset + readLength > totalSize ||
        !payload.data
      ) {
        throw new Error('preview_incomplete')
      }
      if (payload.data) {
        partial.write(payload.data, {
          encoding: 'base64',
          append: offset > 0,
        })
      }
      offset += readLength
      if (readLength <= 0 || offset >= totalSize) break
    }

    if (offset <= 0 || (expectedSize > 0 && offset !== expectedSize)) {
      throw new Error('preview_incomplete')
    }
    // SVG is not supported by the native bitmap decoder. Preserve its vectors.
    if (Number(partial.size) !== expectedSize) throw new Error('preview_incomplete')
    if (options.svg || options.pdf) {
      if (destination.exists) destination.delete()
      partial.copy(destination)
    } else await normalizeThumbnail(partial, destination)
    schedulePrune(directory)
    return destination.uri
  } finally {
    activePartials.delete(partial.uri)
    if (partial.exists) {
      try {
        partial.delete()
      } catch {
        // A failed temporary-file cleanup must not hide the real preview error.
      }
    }
  }
}

// Keep only one bounded chunk in JS; PDFs stay on disk, never in a data URL.
export function loadNativeImagePreview(
  options: Omit<LoadNativeImagePreviewOptions, 'pdf' | 'refresh'>,
): Promise<string> {
  return loadNativePreview(options)
}

export function loadNativePdfPreview(
  options: Omit<LoadNativeImagePreviewOptions, 'svg' | 'pdf'>,
): Promise<string> {
  return loadNativePreview({ ...options, pdf: true })
}

export function getNativeImagePreviewCacheDirectoryUri(): string {
  return getCacheDirectory().uri
}

export async function clearNativeImagePreviewCache(): Promise<void> {
  const directory = getCacheDirectory()
  for (const entry of directory.list()) {
    try {
      entry.delete()
    } catch {
      // Cache cleanup is retried on the next epoch reset/prune.
    }
  }
}
