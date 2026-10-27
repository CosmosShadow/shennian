// @covers open-source/packages/cli/src/agents/public-attachments.ts
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { materializePublicAttachments } from '../agents/public-attachments.js'
import type { PublicAgentClaim } from '../agents/public-delivery-client.js'

const root = path.join(os.tmpdir(), 'shennian-tests', 'unit', `public-attachments-${process.pid}`)
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('leased public attachments', () => {
  it('copies a hash-verified image into the isolated visitor directory', async () => {
    await fs.mkdir(root, { recursive: true })
    const bytes = Buffer.from('image data')
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    const file = { attachmentId: `datt_${crypto.randomUUID()}`, name: 'photo.png',
      mimeType: 'image/png', mediaKind: 'image' as const,
      byteSize: String(bytes.length), sha256 }
    const claim = { attachments: [file] } as PublicAgentClaim
    const delivery = { attachment: vi.fn(async () => ({ ...file,
      downloadUrl: 'https://example.invalid/photo' })) }
    const fetchImpl = vi.fn(async () => new Response(bytes, {
      headers: { 'content-length': String(bytes.length) },
    })) as unknown as typeof fetch
    const result = await materializePublicAttachments({ claim, machineToken: 'machine',
      workDir: root, delivery: delivery as never, fetchImpl })
    expect(result).toMatchObject([{ name: 'photo.png', kind: 'image', sha256 }])
    expect(await fs.readFile(result[0]!.path)).toEqual(bytes)
    expect(result[0]!.path.startsWith(root + path.sep)).toBe(true)
  })

  it('rejects a download whose bytes differ from the declared SHA-256', async () => {
    await fs.mkdir(root, { recursive: true })
    const file = { attachmentId: `datt_${crypto.randomUUID()}`, name: 'notes.pdf',
      mimeType: 'application/pdf', mediaKind: 'file' as const,
      byteSize: '4', sha256: 'a'.repeat(64) }
    const claim = { attachments: [file] } as PublicAgentClaim
    await expect(materializePublicAttachments({ claim, machineToken: 'machine',
      workDir: root, delivery: { attachment: vi.fn(async () => ({ ...file,
        downloadUrl: 'https://example.invalid/file' })) } as never,
      fetchImpl: (async () => new Response('nope', {
        headers: { 'content-length': '4' } })) as typeof fetch,
    })).rejects.toThrow('public_agent_attachment_hash_mismatch')
  })
})
