// @covers packages/app/src/features/chat/utils/nativeImagePreviewCache.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { files, manipulate } = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  manipulate: vi.fn(),
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_algorithm: string, key: string) => key,
}))
vi.mock('expo-file-system', () => {
  class File {
    uri: string
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = `${typeof parent === 'string' ? parent : parent.uri}${name ? `/${name}` : ''}`
    }
    get exists() {
      return files.has(this.uri)
    }
    get size() {
      return files.get(this.uri)?.length ?? 0
    }
    get name() {
      return this.uri.split('/').pop()!
    }
    get modificationTime() {
      return Date.now()
    }
    create() {
      files.set(this.uri, Buffer.alloc(0))
    }
    delete() {
      files.delete(this.uri)
    }
    copy(destination: File) {
      files.set(destination.uri, Buffer.from(files.get(this.uri)!))
    }
    write(data: string, options: { append: boolean }) {
      files.set(
        this.uri,
        Buffer.concat([
          options.append ? files.get(this.uri)! : Buffer.alloc(0),
          Buffer.from(data, 'base64'),
        ]),
      )
    }
  }
  return {
    File,
    Paths: { cache: 'file:///cache' },
    Directory: class {
      uri: string
      constructor(parent: string, name: string) {
        this.uri = `${parent}/${name}`
      }
      create() {}
      list() {
        return [...files.keys()]
          .filter((key) => key.startsWith(`${this.uri}/`))
          .map((key) => new File(key))
      }
    },
  }
})
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: manipulate,
  SaveFormat: { JPEG: 'jpeg' },
}))

import {
  cacheNativeLocalImagePreview,
  loadNativeImagePreview,
  loadNativePdfPreview,
} from '../features/chat/utils/nativeImagePreviewCache'

const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><text>神念</text></svg>',
)
function chunk(offset: number) {
  const bytes = svg.subarray(offset, offset + 24)
  return Promise.resolve({
    data: bytes.toString('base64'),
    length: bytes.length,
    totalSize: svg.length,
  })
}

describe('native chat image preview cache', () => {
  beforeEach(() => {
    files.clear()
    manipulate.mockReset().mockImplementation(async () => {
      files.set('file:///normalized.jpg', Buffer.from('jpeg'))
      return { uri: 'file:///normalized.jpg' }
    })
  })

  it('preserves chunked SVG bytes and extension without the bitmap decoder', async () => {
    const uri = await loadNativeImagePreview({
      cacheKey: 'logo',
      svg: true,
      maxSize: 1024,
      readChunk: chunk,
    })
    expect(uri).toBe('file:///cache/chat-image-previews/logo.svg')
    expect(files.get(uri)).toEqual(svg)
    expect(manipulate).not.toHaveBeenCalled()
    expect([...files.keys()].some((key) => key.endsWith('.part'))).toBe(false)
    const readChunk = vi.fn()
    expect(
      await loadNativeImagePreview({ cacheKey: 'logo', svg: true, maxSize: 1024, readChunk }),
    ).toBe(uri)
    expect(readChunk).not.toHaveBeenCalled()
  })

  it('stores PDF chunks as a local file and refreshes replaced bytes without decoding an image', async () => {
    const options = { cacheKey: 'report', maxSize: 1024, readChunk: chunk }
    const uri = await loadNativePdfPreview(options)
    expect(uri).toBe('file:///cache/chat-image-previews/report.pdf')
    expect(files.get(uri)).toEqual(svg)
    expect(manipulate).not.toHaveBeenCalled()
    const replacement = Buffer.from('%PDF-new')
    const readChunk = vi.fn().mockResolvedValue({
      data: replacement.toString('base64'),
      length: replacement.length,
      totalSize: replacement.length,
    })
    await loadNativePdfPreview({ ...options, readChunk })
    expect(readChunk).not.toHaveBeenCalled()
    await loadNativePdfPreview({ ...options, readChunk, refresh: true })
    expect(files.get(uri)).toEqual(replacement)
    expect([...files.keys()].some((key) => key.endsWith('.part'))).toBe(false)
  })

  it('rejects oversized PDFs after the first chunk and removes temporary bytes', async () => {
    const readChunk = vi
      .fn()
      .mockResolvedValue({ data: 'YQ==', length: 1, totalSize: 21 * 1024 * 1024 })
    await expect(
      loadNativePdfPreview({ cacheKey: 'large-pdf', maxSize: 20 * 1024 * 1024, readChunk }),
    ).rejects.toThrow('preview_too_large')
    expect(readChunk).toHaveBeenCalledTimes(1)
    expect(files.size).toBe(0)
  })

  it('rejects truncated PDF bytes even when the declared lengths add up', async () => {
    await expect(
      loadNativePdfPreview({
        cacheKey: 'broken-pdf',
        maxSize: 1024,
        readChunk: async () => ({ data: 'YQ==', length: 8, totalSize: 8 }),
      }),
    ).rejects.toThrow('preview_incomplete')
    expect(files.size).toBe(0)
  })

  it('rejects a PDF whose total size changes during download', async () => {
    const readChunk = vi
      .fn()
      .mockResolvedValueOnce({ data: 'YWJj', length: 3, totalSize: 6 })
      .mockResolvedValueOnce({ data: 'ZGVm', length: 3, totalSize: 7 })
    await expect(
      loadNativePdfPreview({ cacheKey: 'changed-pdf', maxSize: 1024, readChunk }),
    ).rejects.toThrow('preview_size_changed')
    expect(files.size).toBe(0)
  })

  it('copies a local picker SVG without converting or losing transparency', async () => {
    files.set('file:///picker', svg)
    const uri = await cacheNativeLocalImagePreview('picked', 'file:///picker', true)
    expect(files.get(uri)).toEqual(svg)
    expect(uri).toMatch(/\.svg$/)
    expect(manipulate).not.toHaveBeenCalled()
  })

  it('continues normalizing bitmap previews to bounded JPEG thumbnails', async () => {
    const uri = await loadNativeImagePreview({ cacheKey: 'photo', maxSize: 1024, readChunk: chunk })
    expect(uri).toMatch(/\.jpg$/)
    expect(manipulate).toHaveBeenCalledWith(expect.any(String), [{ resize: { width: 960 } }], {
      compress: 0.72,
      format: 'jpeg',
    })
    expect(files.get(uri)?.toString()).toBe('jpeg')
  })

  it('rejects oversized SVG and cleans the partial file', async () => {
    await expect(
      loadNativeImagePreview({ cacheKey: 'large', svg: true, maxSize: 10, readChunk: chunk }),
    ).rejects.toThrow('preview_too_large')
    expect(files.size).toBe(0)
  })

  it('rejects incomplete SVG instead of caching a broken image', async () => {
    const readChunk = vi
      .fn()
      .mockResolvedValueOnce({ data: 'PHN2Zw==', length: 4, totalSize: 10 })
      .mockResolvedValueOnce({ length: 0, totalSize: 10 })
    await expect(
      loadNativeImagePreview({ cacheKey: 'short', svg: true, maxSize: 1024, readChunk }),
    ).rejects.toThrow('preview_incomplete')
    expect(files.size).toBe(0)
  })
})
