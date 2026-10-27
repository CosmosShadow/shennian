// @covers src/room/public-attachment-cache.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicAttachmentCache } from '../room/public-attachment-cache.js'
import { PublicRoomClient } from '../room/public-room-client.js'

describe('public Room attachment cache', () => {
  const roots: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it('downloads, hashes, and stores under opaque context directories', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-public-cache-'))
    roots.push(root)
    const data = Buffer.from('verified attachment')
    const sha256 = crypto.createHash('sha256').update(data).digest('hex')
    const client = {
      getAttachmentDownload: vi.fn().mockResolvedValue({
        attachmentId: 'ratt_public', name: 'report.txt', mimeType: 'text/plain',
        byteSize: String(data.length), sha256,
        downloadUrl: 'https://files.example/download?signature=short',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      download: vi.fn().mockResolvedValue(new Response(data, {
        status: 200,
        headers: { 'content-length': String(data.length) },
      })),
    }
    const cache = new PublicAttachmentCache({
      client: client as unknown as PublicRoomClient,
      rootDirectory: root,
    })

    const result = await cache.materialize('room_secret', 'ratt_public')

    expect(result).toMatchObject({ downloaded: true, cached: false, sha256 })
    expect(fs.readFileSync(result.localPath)).toEqual(data)
    expect(result.localPath).not.toContain('room_secret')
    const relative = path.relative(root, result.localPath).split(path.sep)
    expect(relative[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(relative[1]).toMatch(/^[a-f0-9]{64}$/)
    const metadata = fs.readFileSync(path.join(path.dirname(result.localPath), 'metadata.json'), 'utf8')
    expect(metadata).not.toContain('room_secret')

    expect(cache.lookup('room_secret', {
      attachmentId: 'ratt_public', name: 'report.txt', mimeType: 'text/plain',
      byteSize: String(data.length), sha256,
    })).toEqual({ downloaded: true, localPath: result.localPath })
  })

  it('rejects a hash mismatch without leaving a downloaded file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-public-cache-'))
    roots.push(root)
    const data = Buffer.from('tampered')
    const client = {
      getAttachmentDownload: vi.fn().mockResolvedValue({
        attachmentId: 'ratt_public', name: 'report.txt', mimeType: 'text/plain',
        byteSize: String(data.length), sha256: 'a'.repeat(64),
        downloadUrl: 'https://files.example/download',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      download: vi.fn().mockResolvedValue(new Response(data, { status: 200 })),
    }
    const cache = new PublicAttachmentCache({ client: client as unknown as PublicRoomClient, rootDirectory: root })

    await expect(cache.materialize('room_secret', 'ratt_public')).rejects.toMatchObject({
      code: 'attachment_hash_mismatch',
    })
    expect(findRegularFiles(root).filter((file) => !file.endsWith('metadata.json'))).toEqual([])
  })

  it('prunes least-recently-used entries when the cache exceeds its byte budget', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-public-cache-lru-'))
    roots.push(root)
    const bodies = new Map([
      ['ratt_first', Buffer.from('first')],
      ['ratt_second', Buffer.from('second')],
    ])
    let current = Buffer.alloc(0)
    const client = {
      getAttachmentDownload: vi.fn(async (_roomId: string, attachmentId: string) => {
        current = bodies.get(attachmentId)!
        return {
          attachmentId, name: `${attachmentId}.txt`, mimeType: 'text/plain',
          byteSize: String(current.length), sha256: crypto.createHash('sha256').update(current).digest('hex'),
          downloadUrl: `https://files.example/${attachmentId}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }
      }),
      download: vi.fn(async () => new Response(current, { status: 200 })),
    }
    const cache = new PublicAttachmentCache({
      client: client as unknown as PublicRoomClient,
      rootDirectory: root,
      maxCacheBytes: bodies.get('ratt_second')!.length,
    })

    await cache.materialize('room_secret', 'ratt_first')
    const second = await cache.materialize('room_secret', 'ratt_second')

    expect(second.downloaded).toBe(true)
    expect(findRegularFiles(root).filter((file) => !file.endsWith('metadata.json'))).toEqual([second.localPath])
  })
})

function findRegularFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}
