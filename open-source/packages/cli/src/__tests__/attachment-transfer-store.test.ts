// @arch open-source/docs/cli-runtime.md
// @covers src/session/attachment-transfer-store.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { serializeFsTransferManifest, type FsTransferManifestEntry } from '@shennian/wire'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ATTACHMENT_ORPHAN_TTL_MS,
  ATTACHMENT_TRANSFER_IDLE_MS,
  abortAttachmentTransfer,
  appendAttachmentTransferChunk,
  finishAttachmentTransfer,
  markAttachmentReferences,
  startAttachmentTransfer,
  sweepAttachmentTransfers,
  sweepAttachmentTransfersCooperatively,
} from '../session/attachment-transfer-store.js'

let rootPath: string

function digest(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function transferId(suffix: string): string {
  return `transfer_${suffix.padEnd(8, '0')}`
}

beforeEach(() => {
  const base = path.join(os.tmpdir(), 'shennian-tests', 'unit')
  fs.mkdirSync(base, { recursive: true })
  rootPath = fs.mkdtempSync(path.join(base, 'attachment-transfer-'))
})

afterEach(() => {
  fs.rmSync(rootPath, { recursive: true, force: true })
})

describe('personal attachment transfer store', () => {
  it('persists a resumable manifest, validates sequential offsets, and atomically finishes', () => {
    const content = Buffer.from('durable attachment bytes')
    const sha256 = digest(content)
    const id = transferId('file')
    const started = startAttachmentTransfer({
      transferId: id,
      rootPath,
      name: 'notes.txt',
      mimeType: 'text/plain',
      kind: 'file',
      totalSize: content.length,
      sha256,
    }, 1_000)
    expect(started).toMatchObject({ transferId: id, reused: false, offsets: { __file__: 0 } })
    expect(started.path).toBe(path.join(rootPath, '.uploads', 'notes.txt'))

    const first = content.subarray(0, 8)
    expect(appendAttachmentTransferChunk({
      rootPath, transferId: id, offset: 0, data: first, now: 2_000,
    })).toEqual({ written: first.length, nextOffset: first.length })
    expect(() => appendAttachmentTransferChunk({
      rootPath, transferId: id, offset: 0, data: first,
    })).toThrow('duplicate_attachment_chunk')
    expect(() => appendAttachmentTransferChunk({
      rootPath, transferId: id, offset: first.length + 1, data: Buffer.from('x'),
    })).toThrow('out_of_order_attachment_chunk')

    // A new process can call start with the same stable transfer ID and resume.
    expect(startAttachmentTransfer({
      transferId: id,
      rootPath,
      name: 'notes.txt',
      mimeType: 'text/plain',
      kind: 'file',
      totalSize: content.length,
      sha256,
    }, 3_000).offsets).toEqual({ __file__: first.length })
    appendAttachmentTransferChunk({
      rootPath, transferId: id, offset: first.length, data: content.subarray(first.length), now: 4_000,
    })
    const finished = finishAttachmentTransfer(rootPath, id, 5_000)
    expect(finished).toEqual({
      transferId: id,
      path: path.join(rootPath, '.uploads', 'notes.txt'),
      name: 'notes.txt',
      mimeType: 'text/plain',
      kind: 'file',
      byteSize: content.length,
      sha256,
      reused: false,
    })
    expect(fs.readFileSync(finished.path)).toEqual(content)
    expect(fs.existsSync(path.join(rootPath, '.uploads', '.staging', id))).toBe(false)
  })

  it('refuses size and hash corruption without publishing a final file', () => {
    const expected = Buffer.from('expected')
    const id = transferId('hash')
    startAttachmentTransfer({
      transferId: id,
      rootPath,
      name: 'hash.bin',
      mimeType: 'application/octet-stream',
      kind: 'file',
      totalSize: expected.length,
      sha256: digest(expected),
    })
    appendAttachmentTransferChunk({
      rootPath, transferId: id, offset: 0, data: Buffer.from('tampered'),
    })
    expect(() => finishAttachmentTransfer(rootPath, id)).toThrow('attachment_hash_mismatch')
    expect(fs.existsSync(path.join(rootPath, '.uploads', 'hash.bin'))).toBe(false)
    expect(fs.existsSync(path.join(rootPath, '.uploads', '.staging', id))).toBe(true)
  })

  it('reuses a finished upload by hash and does not create another staging copy', () => {
    const content = Buffer.from('same bytes')
    const sha256 = digest(content)
    const firstId = transferId('reuse_a')
    startAttachmentTransfer({
      transferId: firstId, rootPath, name: 'same.txt', mimeType: 'text/plain', kind: 'file',
      totalSize: content.length, sha256,
    })
    appendAttachmentTransferChunk({ rootPath, transferId: firstId, offset: 0, data: content })
    const first = finishAttachmentTransfer(rootPath, firstId)

    const secondId = transferId('reuse_b')
    expect(startAttachmentTransfer({
      transferId: secondId, rootPath, name: 'renamed.txt', mimeType: 'text/plain', kind: 'file',
      totalSize: content.length, sha256,
    })).toMatchObject({
      transferId: secondId, path: first.path, reused: true, offsets: {},
      attachment: { transferId: secondId, path: first.path, name: 'same.txt', sha256, reused: true },
    })
    expect(fs.existsSync(path.join(rootPath, '.uploads', '.staging', secondId))).toBe(false)
  })

  it('cleans idle staging after ten minutes and only unreferenced finished files after 24 hours', () => {
    const orphan = Buffer.from('orphan')
    const orphanHash = digest(orphan)
    const orphanId = transferId('orphan')
    startAttachmentTransfer({
      transferId: orphanId, rootPath, name: 'orphan.txt', mimeType: 'text/plain', kind: 'file',
      totalSize: orphan.length, sha256: orphanHash,
    }, 1_000)
    appendAttachmentTransferChunk({ rootPath, transferId: orphanId, offset: 0, data: orphan, now: 2_000 })
    const orphanResult = finishAttachmentTransfer(rootPath, orphanId, 3_000)

    const retained = Buffer.from('referenced')
    const retainedHash = digest(retained)
    const retainedId = transferId('retained')
    startAttachmentTransfer({
      transferId: retainedId, rootPath, name: 'retained.txt', mimeType: 'text/plain', kind: 'file',
      totalSize: retained.length, sha256: retainedHash,
    }, 4_000)
    appendAttachmentTransferChunk({ rootPath, transferId: retainedId, offset: 0, data: retained, now: 5_000 })
    const retainedResult = finishAttachmentTransfer(rootPath, retainedId, 6_000)
    markAttachmentReferences(rootPath, [{ path: retainedResult.path, sha256: retainedHash }], 7_000)

    const idleId = transferId('idle')
    startAttachmentTransfer({
      transferId: idleId, rootPath, name: 'idle.txt', mimeType: 'text/plain', kind: 'file',
      totalSize: 1, sha256: digest('x'),
    }, 8_000)

    const cleaned = sweepAttachmentTransfers(
      rootPath,
      Math.max(8_000 + ATTACHMENT_TRANSFER_IDLE_MS, 3_000 + ATTACHMENT_ORPHAN_TTL_MS),
    )
    expect(cleaned).toEqual({ stagingRemoved: 1, orphanRemoved: 1 })
    expect(fs.existsSync(orphanResult.path)).toBe(false)
    expect(fs.readFileSync(retainedResult.path)).toEqual(retained)
  })

  it('uploads a folder as one transaction and rejects traversal paths', () => {
    const first = Buffer.from('one')
    const second = Buffer.from('two')
    const manifest: FsTransferManifestEntry[] = [
      { relativePath: 'a.txt', size: first.length, sha256: digest(first), mimeType: 'text/plain' },
      { relativePath: 'nested/b.txt', size: second.length, sha256: digest(second), mimeType: 'text/plain' },
    ]
    const id = transferId('folder')
    const sha256 = digest(serializeFsTransferManifest(manifest))
    startAttachmentTransfer({
      transferId: id, rootPath, name: 'folder', mimeType: 'inode/directory', kind: 'folder',
      totalSize: first.length + second.length, sha256, manifest,
    })
    appendAttachmentTransferChunk({ rootPath, transferId: id, relativePath: 'nested/b.txt', offset: 0, data: second })
    appendAttachmentTransferChunk({ rootPath, transferId: id, relativePath: 'a.txt', offset: 0, data: first })
    const result = finishAttachmentTransfer(rootPath, id)
    expect(fs.readFileSync(path.join(result.path, 'a.txt'))).toEqual(first)
    expect(fs.readFileSync(path.join(result.path, 'nested', 'b.txt'))).toEqual(second)

    expect(() => startAttachmentTransfer({
      transferId: transferId('traverse'), rootPath, name: 'bad', mimeType: 'inode/directory',
      kind: 'folder', totalSize: 1, sha256: digest('manifest'),
      manifest: [{ relativePath: '../escape', size: 1, sha256: digest('x') }],
    })).toThrow('invalid_attachment_relative_path')
  })

  it('allows control callbacks between batches and preserves a newly referenced attachment', async () => {
    const attachments: { path: string; sha256: string }[] = []
    for (let i = 0; i < 40; i++) {
      const data = Buffer.from(`batch attachment ${i}`)
      const id = transferId(`batch_${i}`)
      startAttachmentTransfer({ transferId: id, rootPath, name: `batch-${i}.txt`,
        mimeType: 'text/plain', kind: 'file', totalSize: data.length, sha256: digest(data) }, 1_000)
      appendAttachmentTransferChunk({ rootPath, transferId: id, offset: 0, data, now: 2_000 })
      attachments.push(finishAttachmentTransfer(rootPath, id, 3_000))
    }
    const lastMetadata = fs.readdirSync(path.join(rootPath, '.uploads', '.metadata')).at(-1)!
    const retained = attachments.find(attachment => `${attachment.sha256}.json` === lastMetadata)!
    let controlCallbackRan = false
    setImmediate(() => {
      markAttachmentReferences(rootPath, [retained], 4_000)
      controlCallbackRan = true
    })
    const result = await sweepAttachmentTransfersCooperatively(rootPath, 3_000 + ATTACHMENT_ORPHAN_TTL_MS)
    expect(controlCallbackRan).toBe(true)
    expect(result).toEqual({ stagingRemoved: 0, orphanRemoved: 39 })
    expect(fs.existsSync(retained.path)).toBe(true)
  })

  it('stops an in-progress sweep before removing the remaining staging transfers', async () => {
    for (let i = 0; i < 40; i++) {
      startAttachmentTransfer({ transferId: transferId(`cancel_${i}`), rootPath,
        name: `pending-${i}.txt`, mimeType: 'text/plain', kind: 'file',
        totalSize: 1, sha256: digest(`pending ${i}`) }, 1_000)
    }
    let running = true
    setImmediate(() => { running = false })
    const result = await sweepAttachmentTransfersCooperatively(rootPath,
      1_000 + ATTACHMENT_TRANSFER_IDLE_MS, () => running)
    expect(result.stagingRemoved).toBeGreaterThan(0)
    expect(result.stagingRemoved).toBeLessThan(40)
    expect(fs.readdirSync(path.join(rootPath, '.uploads', '.staging'))).toHaveLength(40 - result.stagingRemoved)
  })

  it('aborts only the exact staging transaction', () => {
    const id = transferId('abort')
    startAttachmentTransfer({
      transferId: id, rootPath, name: 'cancel.txt', mimeType: 'text/plain', kind: 'file',
      totalSize: 1, sha256: digest('x'),
    })
    expect(abortAttachmentTransfer(rootPath, id)).toBe(true)
    expect(abortAttachmentTransfer(rootPath, id)).toBe(false)
    expect(fs.existsSync(path.join(rootPath, '.uploads', '.staging', id))).toBe(false)
  })
})
