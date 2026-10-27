// @covers open-source/packages/cli/src/room/attachment-cache.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomAttachmentCache } from '../room/attachment-cache.js'
import { managedAttachmentDirectory } from '../room/managed-attachment-directory.js'

const roots: string[] = []
const content = Buffer.from('room attachment')
const sha256 = crypto.createHash('sha256').update(content).digest('hex')

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Room attachment cache', () => {
  it('uses a caller-scoped root without writing to the default cache', async () => {
    const defaultRoot = createRoot()
    const scopedRoot = createRoot()
    const sessionDirectory = managedAttachmentDirectory('session-a', scopedRoot)
    const cache = new RoomAttachmentCache({
      actionClient: { getAttachmentCapability: vi.fn(async () => responseCapability()) },
      fetchImpl: vi.fn(async () => new Response(content)) as typeof fetch,
      rootDirectory: defaultRoot,
    })
    const result = await cache.materialize({ ...input(), contextKey: 'session-a', rootDirectory: scopedRoot })
    expect(result.path.startsWith(`${sessionDirectory}${path.sep}`)).toBe(true)
    expect(fs.readdirSync(defaultRoot)).toEqual([])
  })

  it('downloads without forwarding credentials, verifies content, and reuses a valid cache', async () => {
    const root = createRoot()
    const capability = vi.fn(async () => responseCapability())
    const download = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined()
      expect(init?.redirect).toBe('error')
      return new Response(content, { headers: { 'content-length': String(content.byteLength) } })
    })
    const cache = new RoomAttachmentCache({
      actionClient: { getAttachmentCapability: capability },
      fetchImpl: download as typeof fetch,
      rootDirectory: root,
    })

    const first = await cache.materialize(input())
    expect(first.cached).toBe(false)
    expect(fs.readFileSync(first.path)).toEqual(content)
    if (process.platform !== 'win32') expect(fs.statSync(first.path).mode & 0o777).toBe(0o600)

    const second = await cache.materialize(input())
    expect(second).toMatchObject({ path: first.path, cached: true })
    expect(download).toHaveBeenCalledTimes(1)
    expect(capability).toHaveBeenCalledTimes(2)
    const metadata = fs.readFileSync(path.join(path.dirname(first.path), 'metadata.json'), 'utf8')
    expect(metadata).not.toContain('downloadUrl')
    expect(metadata).not.toContain('signature=short')
  })

  it('rejects metadata changes before downloading', async () => {
    const download = vi.fn()
    const cache = createCache({ ...responseCapability(), sha256: 'a'.repeat(64) }, download)

    await expect(cache.materialize(input())).rejects.toMatchObject({
      code: 'attachment_metadata_mismatch',
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('removes partial files when size or hash verification fails', async () => {
    const root = createRoot()
    const cache = new RoomAttachmentCache({
      actionClient: { getAttachmentCapability: vi.fn(async () => responseCapability()) },
      fetchImpl: vi.fn(async () => new Response(Buffer.from('tampered'))) as typeof fetch,
      rootDirectory: root,
    })

    await expect(cache.materialize(input())).rejects.toMatchObject({
      code: 'attachment_size_mismatch',
    })
    const directory = cacheDirectory(root, 'attachment_1')
    expect(fs.readdirSync(directory)).toEqual([])
  })

  it('rejects path traversal and oversized attachments', async () => {
    await expect(
      createCache({ ...responseCapability(), safeName: '../secret' }).materialize(input()),
    ).rejects.toMatchObject({ code: 'invalid_attachment_capability' })

    await expect(
      createCache(
        { ...responseCapability(), byteSize: String(content.byteLength) },
        undefined,
        3,
      ).materialize(input()),
    ).rejects.toMatchObject({ code: 'attachment_too_large' })
  })

  it('prunes expired and least-recently-used cache entries without touching JSONL', () => {
    const root = createRoot()
    writeCacheEntry(root, 'attachment_old', '2026-07-01T00:00:00.000Z')
    writeCacheEntry(root, 'attachment_new', '2026-08-23T09:00:00.000Z')
    const cache = new RoomAttachmentCache({
      actionClient: { getAttachmentCapability: vi.fn() },
      rootDirectory: root,
      maxCacheBytes: content.byteLength,
      maxCacheAgeMs: 30 * 24 * 60 * 60_000,
    })

    expect(cache.prune({ now: new Date('2026-08-23T10:00:00.000Z') })).toEqual({
      removedEntries: 1,
      removedBytes: content.byteLength,
      remainingBytes: content.byteLength,
    })
    expect(fs.existsSync(cacheDirectory(root, 'attachment_old'))).toBe(false)
    expect(fs.existsSync(cacheDirectory(root, 'attachment_new'))).toBe(true)
    expect(fs.readFileSync(path.join(root, 'legacy-messages.jsonl'), 'utf8')).toBe('history\n')
  })
})

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-attachment-'))
  roots.push(root)
  return root
}

function responseCapability() {
  return {
    attachmentId: 'attachment_1',
    roomId: 'room_1',
    safeName: 'diagram.png',
    mimeType: 'image/png',
    byteSize: String(content.byteLength),
    sha256,
    downloadUrl: 'https://room-files.example/diagram.png?signature=short',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
}

function input() {
  return {
    machineToken: 'machine-secret',
    roomId: 'room_1',
    bindingId: 'binding_1',
    attachmentId: 'attachment_1',
    expected: {
      downloadRef: 'shennian-room-attachment:attachment_1',
      byteSize: String(content.byteLength),
      sha256,
    },
  }
}

function createCache(
  capabilityValue: ReturnType<typeof responseCapability>,
  download = vi.fn(),
  maxAttachmentBytes?: number,
) {
  return new RoomAttachmentCache({
    actionClient: { getAttachmentCapability: vi.fn(async () => capabilityValue) },
    fetchImpl: download as typeof fetch,
    rootDirectory: createRoot(),
    maxAttachmentBytes,
  })
}

function writeCacheEntry(root: string, attachmentId: string, lastAccessedAt: string): void {
  const directory = cacheDirectory(root, attachmentId)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(root, 'legacy-messages.jsonl'), 'history\n')
  fs.writeFileSync(path.join(directory, 'file.bin'), content)
  fs.writeFileSync(
    path.join(directory, 'metadata.json'),
    JSON.stringify({
      schemaVersion: 1,
      safeName: 'file.bin',
      lastAccessedAt,
    }),
  )
}

function cacheDirectory(root: string, attachmentId: string): string {
  const contextHash = crypto.createHash('sha256').update('binding_1\0room_1', 'utf8').digest('hex')
  const attachmentHash = crypto.createHash('sha256').update(attachmentId, 'utf8').digest('hex')
  return path.join(root, contextHash, attachmentHash)
}
