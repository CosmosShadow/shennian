// @arch docs/architecture/data-sync.md#82-个人-session-附件的直达分片与本地权威
// @covers src/features/chat/utils/personalAttachmentTransfer.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { digest, digestStringAsync } = vi.hoisted(() => ({
  digest: vi.fn(async () => Uint8Array.from({ length: 32 }, () => 1).buffer),
  digestStringAsync: vi.fn(async () => '02'.repeat(32)),
}))

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest,
  digestStringAsync,
}))

import {
  abortPersonalAttachmentUpload,
  PERSONAL_ATTACHMENT_CHUNK_BYTES,
  uploadPersonalAttachment,
} from '../features/chat/utils/personalAttachmentTransfer'

const FILE_SHA = '01'.repeat(32)
const RESULT_IDENTITY = {
  protocolVersion: 2 as const,
  dataEpoch: 2 as const,
  daemonInstallationId: 'daemon-1',
}

beforeEach(() => {
  digest.mockClear()
  digestStringAsync.mockClear()
})

describe('personal attachment transfer client', () => {
  it('uploads real bounded chunks and requires the exact finish metadata', async () => {
    const bytes = new Uint8Array(PERSONAL_ATTACHMENT_CHUNK_BYTES + 3).fill(7)
    const send = vi.fn(async (_machineId: string, frame: { method: string; params: Record<string, unknown> }) => {
      if (frame.method === 'fs.transfer.start') {
        return {
          type: 'res' as const, id: 'start', ok: true,
          payload: {
            ...RESULT_IDENTITY,
            transferId: 'attachment_12345678', path: '/project/.uploads/data.bin',
            reused: false, offsets: { __file__: 0 },
          },
        }
      }
      if (frame.method === 'fs.transfer.chunk') {
        const data = atob(String(frame.params.data))
        return {
          type: 'res' as const, id: 'chunk', ok: true,
          payload: {
            ...RESULT_IDENTITY,
            transferId: 'attachment_12345678',
            nextOffset: Number(frame.params.offset) + data.length,
            written: data.length,
          },
        }
      }
      return {
        type: 'res' as const, id: 'finish', ok: true,
        payload: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_12345678', path: '/project/.uploads/data.bin',
          name: 'data.bin', mimeType: 'application/octet-stream', kind: 'file',
          byteSize: bytes.byteLength, sha256: FILE_SHA, reused: false,
        },
      }
    })
    const progress = vi.fn()
    await expect(uploadPersonalAttachment({
      send,
      machineId: 'machine-1',
      daemonInstallationId: 'daemon-1',
      rootPath: '/project',
      transferId: 'attachment_12345678',
      name: 'data.bin',
      mimeType: 'application/octet-stream',
      kind: 'file',
      files: [{ bytes, mimeType: 'application/octet-stream' }],
      timeoutMs: 10_000,
      onProgress: progress,
    })).resolves.toMatchObject({ path: '/project/.uploads/data.bin', sha256: FILE_SHA })
    const chunks = send.mock.calls.filter((call) => call[1].method === 'fs.transfer.chunk')
    expect(chunks).toHaveLength(2)
    for (const call of send.mock.calls) {
      expect(call[1].params).toMatchObject({
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-1',
      })
    }
    expect(chunks.map((call) => call[1].params.offset)).toEqual([0, PERSONAL_ATTACHMENT_CHUNK_BYTES])
    expect(progress).toHaveBeenCalled()
  })

  it('continues from the daemon-confirmed offset after an interrupted client request', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const send = vi.fn(async (_machineId: string, frame: { method: string; params: Record<string, unknown> }) => {
      if (frame.method === 'fs.transfer.start') return {
        type: 'res' as const, id: 'start', ok: true,
        payload: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_resume1', path: '/project/.uploads/data.bin',
          reused: false, offsets: { __file__: 3 },
        },
      }
      if (frame.method === 'fs.transfer.chunk') return {
        type: 'res' as const, id: 'chunk', ok: true,
        payload: { ...RESULT_IDENTITY, transferId: 'attachment_resume1', written: 2, nextOffset: 5 },
      }
      return {
        type: 'res' as const, id: 'finish', ok: true,
        payload: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_resume1', path: '/project/.uploads/data.bin', name: 'data.bin',
          mimeType: 'application/octet-stream', kind: 'file', byteSize: 5,
          sha256: FILE_SHA, reused: false,
        },
      }
    })
    await uploadPersonalAttachment({
      send, machineId: 'machine-1', daemonInstallationId: 'daemon-1', rootPath: '/project', transferId: 'attachment_resume1',
      name: 'data.bin', mimeType: 'application/octet-stream', kind: 'file',
      files: [{ bytes, mimeType: 'application/octet-stream' }], timeoutMs: 10_000,
    })
    expect(send.mock.calls.find((call) => call[1].method === 'fs.transfer.chunk')?.[1].params)
      .toMatchObject({ offset: 3 })
  })

  it('reuses a daemon-finished hash without sending chunks again', async () => {
    const send = vi.fn(async () => ({
      type: 'res' as const, id: 'start', ok: true,
      payload: {
        ...RESULT_IDENTITY,
        transferId: 'attachment_reuse01', path: '/project/.uploads/existing.txt',
        reused: true, offsets: {},
        attachment: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_reuse01', path: '/project/.uploads/existing.txt',
          name: 'existing.txt', mimeType: 'text/plain', kind: 'file', byteSize: 1,
          sha256: FILE_SHA, reused: true,
        },
      },
    }))
    await expect(uploadPersonalAttachment({
      send, machineId: 'machine-1', daemonInstallationId: 'daemon-1', rootPath: '/project', transferId: 'attachment_reuse01',
      name: 'same.txt', mimeType: 'text/plain', kind: 'file',
      files: [{ bytes: new Uint8Array([1]), mimeType: 'text/plain' }], timeoutMs: 10_000,
    })).resolves.toMatchObject({
      path: '/project/.uploads/existing.txt', name: 'existing.txt', reused: true,
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('builds one folder manifest and aborts with the same transfer identity', async () => {
    const send = vi.fn(async (_machineId: string, frame: { method: string; params: Record<string, unknown> }) => {
      if (frame.method === 'fs.transfer.start') return {
        type: 'res' as const, id: 'start', ok: true,
        payload: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_folder1', path: '/project/.uploads/folder',
          reused: false, offsets: { 'a.txt': 0, 'nested/b.txt': 0 },
        },
      }
      if (frame.method === 'fs.transfer.chunk') {
        const length = atob(String(frame.params.data)).length
        return {
          type: 'res' as const, id: 'chunk', ok: true,
          payload: {
            ...RESULT_IDENTITY,
            transferId: 'attachment_folder1',
            written: length,
            nextOffset: Number(frame.params.offset) + length,
          },
        }
      }
      if (frame.method === 'fs.transfer.finish') return {
        type: 'res' as const, id: 'finish', ok: true,
        payload: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_folder1', path: '/project/.uploads/folder', name: 'folder',
          mimeType: 'inode/directory', kind: 'folder', byteSize: 2,
          sha256: '02'.repeat(32), reused: false,
        },
      }
      return {
        type: 'res' as const, id: 'abort', ok: true,
        payload: { ...RESULT_IDENTITY, transferId: 'attachment_folder1', aborted: true },
      }
    })
    await uploadPersonalAttachment({
      send, machineId: 'machine-1', daemonInstallationId: 'daemon-1', rootPath: '/project', transferId: 'attachment_folder1',
      name: 'folder', mimeType: 'inode/directory', kind: 'folder', timeoutMs: 10_000,
      files: [
        { bytes: new Uint8Array([1]), mimeType: 'text/plain', relativePath: 'a.txt' },
        { bytes: new Uint8Array([2]), mimeType: 'text/plain', relativePath: 'nested/b.txt' },
      ],
    })
    const start = send.mock.calls.find((call) => call[1].method === 'fs.transfer.start')![1]
    expect(start.params).toMatchObject({ kind: 'folder', totalSize: 2, sha256: '02'.repeat(32) })
    expect(start.params.manifest).toHaveLength(2)
    expect(digestStringAsync).toHaveBeenCalledTimes(1)

    await abortPersonalAttachmentUpload({
      send, machineId: 'machine-1', daemonInstallationId: 'daemon-1', rootPath: '/project',
      transferId: 'attachment_folder1', timeoutMs: 10_000,
    })
    expect(send).toHaveBeenLastCalledWith('machine-1', expect.objectContaining({
      method: 'fs.transfer.abort',
      params: expect.objectContaining({
        protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
        transferId: 'attachment_folder1', rootPath: '/project',
      }),
    }), 10_000)
  })

  it('rejects a finish response whose hash does not match the uploaded bytes', async () => {
    const send = vi.fn(async (_machineId: string, frame: { method: string }) => {
      if (frame.method === 'fs.transfer.start') return {
        type: 'res' as const, id: 'start', ok: true,
        payload: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_hashbad1', path: '/project/.uploads/data.bin',
          reused: false, offsets: { __file__: 0 },
        },
      }
      if (frame.method === 'fs.transfer.chunk') return {
        type: 'res' as const, id: 'chunk', ok: true,
        payload: { ...RESULT_IDENTITY, transferId: 'attachment_hashbad1', written: 1, nextOffset: 1 },
      }
      return {
        type: 'res' as const, id: 'finish', ok: true,
        payload: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_hashbad1', path: '/project/.uploads/data.bin', name: 'data.bin',
          mimeType: 'application/octet-stream', kind: 'file', byteSize: 1,
          sha256: 'ff'.repeat(32), reused: false,
        },
      }
    })

    await expect(uploadPersonalAttachment({
      send, machineId: 'machine-1', daemonInstallationId: 'daemon-1', rootPath: '/project', transferId: 'attachment_hashbad1',
      name: 'data.bin', mimeType: 'application/octet-stream', kind: 'file',
      files: [{ bytes: new Uint8Array([7]), mimeType: 'application/octet-stream' }],
      timeoutMs: 10_000,
    })).rejects.toThrow('invalid_attachment_transfer_finish')
  })

  it('does not send another chunk after deletion cancels an active transfer', async () => {
    const send = vi.fn(async (_machineId: string, frame: { method: string }) => {
      if (frame.method === 'fs.transfer.start') return {
        type: 'res' as const, id: 'start', ok: true,
        payload: {
          ...RESULT_IDENTITY,
          transferId: 'attachment_deleted1', path: '/project/.uploads/data.bin',
          reused: false, offsets: { __file__: 0 },
        },
      }
      return { type: 'res' as const, id: 'unexpected', ok: true, payload: {} }
    })

    await expect(uploadPersonalAttachment({
      send, machineId: 'machine-1', daemonInstallationId: 'daemon-1', rootPath: '/project', transferId: 'attachment_deleted1',
      name: 'data.bin', mimeType: 'application/octet-stream', kind: 'file',
      files: [{ bytes: new Uint8Array([7]), mimeType: 'application/octet-stream' }],
      timeoutMs: 10_000, isAborted: () => true,
    })).rejects.toThrow('attachment_transfer_aborted')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
