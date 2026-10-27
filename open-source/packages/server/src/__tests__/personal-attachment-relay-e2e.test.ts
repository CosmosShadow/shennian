// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/sensitive-personal-relay.ts
// @covers open-source/packages/cli/src/session/attachment-transfer-store.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReqFrame, ResFrame } from '@shennian/wire'
import {
  appendAttachmentTransferChunk,
  finishAttachmentTransfer,
  startAttachmentTransfer,
} from '../../../cli/src/session/attachment-transfer-store.js'
import { buildCodexQueuedText } from '../../../cli/src/agents/codex.js'
import {
  getSensitivePersonalIdentity,
  SensitivePersonalRelay,
} from '../relay/sensitive-personal-relay.js'

type TransferMethod =
  | 'fs.transfer.start'
  | 'fs.transfer.chunk'
  | 'fs.transfer.finish'

const personalIdentity = {
  protocolVersion: 2 as const, dataEpoch: 2 as const, daemonInstallationId: 'install-e2e',
}

describe('personal attachment relay end to end', () => {
  const temporaryRoots: string[] = []
  const relays: SensitivePersonalRelay[] = []

  afterEach(() => {
    for (const relay of relays) relay.reset()
    for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true })
    relays.length = 0
    temporaryRoots.length = 0
    vi.restoreAllMocks()
  })

  it('keeps attachment bytes on the phone and origin machine while Server only routes transient frames', () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-attachment-relay-'))
    temporaryRoots.push(testRoot)
    const phoneRoot = path.join(testRoot, 'phone-cache')
    const originRoot = path.join(testRoot, 'origin-workspace')
    const serverRoot = path.join(testRoot, 'server-container')
    fs.mkdirSync(phoneRoot, { recursive: true })
    fs.mkdirSync(originRoot, { recursive: true })
    fs.mkdirSync(serverRoot, { recursive: true })

    const sentinel = Buffer.concat([
      Buffer.from(`PERSONAL_ATTACHMENT_SENTINEL_${crypto.randomUUID()}\n`),
      crypto.randomBytes(1_100_000),
    ])
    const sourcePath = path.join(phoneRoot, 'private.bin')
    fs.writeFileSync(sourcePath, sentinel)
    const sha256 = crypto.createHash('sha256').update(sentinel).digest('hex')
    const transferId = 'attachment_privacy_e2e'
    const relay = new SensitivePersonalRelay()
    relays.push(relay)
    const delivered: string[] = []
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((data: string) => delivered.push(data)),
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let requestSequence = 0

    const roundTrip = (method: TransferMethod, params: Record<string, unknown>): ResFrame => {
      const frame: ReqFrame = {
        type: 'req',
        id: `attachment-e2e-${++requestSequence}`,
        method,
        params: { ...personalIdentity, ...params },
      }
      const identity = getSensitivePersonalIdentity(frame)
      expect(identity).toEqual({ kind: 'attachment_transfer', ...personalIdentity, method, transferId })
      expect(JSON.stringify(identity)).not.toContain(sentinel.subarray(0, 48).toString('base64'))
      relay.registerClientRequest({
        socket: socket as never,
        machineId: 'origin-machine',
        frame,
        mode: 'multiplex',
      })
      relay.observeForwardedRequest('origin-machine', frame)

      let payload: unknown
      if (method === 'fs.transfer.start') {
        payload = startAttachmentTransfer(params as never)
      } else if (method === 'fs.transfer.chunk') {
        payload = appendAttachmentTransferChunk({
          rootPath: String(params.rootPath),
          transferId: String(params.transferId),
          offset: Number(params.offset),
          data: Buffer.from(String(params.data), 'base64'),
        })
      } else {
        payload = finishAttachmentTransfer(String(params.rootPath), String(params.transferId))
      }

      expect(relay.routeMachineFrame('origin-machine', JSON.stringify({
        type: 'res', id: frame.id, ok: true, payload: { ...personalIdentity, ...(payload as object) },
      }))).toBe(true)
      const envelope = JSON.parse(delivered.pop()!) as { frame: ResFrame }
      expect(envelope.frame.id).toBe(frame.id)
      expect(envelope.frame.ok).toBe(true)
      expect(relay.rejectMachineOffline(frame.id)).toBe(false)
      return envelope.frame
    }

    roundTrip('fs.transfer.start', {
      transferId,
      rootPath: originRoot,
      name: 'private.bin',
      mimeType: 'application/octet-stream',
      kind: 'file',
      totalSize: sentinel.length,
      sha256,
    })

    const chunkBytes = 768 * 1024
    for (let offset = 0; offset < sentinel.length; offset += chunkBytes) {
      const chunk = sentinel.subarray(offset, Math.min(sentinel.length, offset + chunkBytes))
      const response = roundTrip('fs.transfer.chunk', {
        transferId,
        rootPath: originRoot,
        offset,
        data: chunk.toString('base64'),
      })
      expect((response.payload as { nextOffset: number }).nextOffset).toBe(offset + chunk.length)
    }

    const finished = roundTrip('fs.transfer.finish', { transferId, rootPath: originRoot })
      .payload as { path: string; byteSize: number; sha256: string }
    expect(finished.byteSize).toBe(sentinel.length)
    expect(finished.sha256).toBe(sha256)
    expect(finished.path).toBe(path.join(originRoot, '.uploads', 'private.bin'))
    // Byte equality without asking the matcher to recursively traverse / format
    // two million individual Buffer entries on a small CI runner.
    expect(fs.readFileSync(finished.path).equals(sentinel)).toBe(true)
    expect(fs.readFileSync(sourcePath).equals(sentinel)).toBe(true)
    expect(buildCodexQueuedText('读取并概括这个附件', [{
      path: finished.path,
      name: 'private.bin',
      mimeType: 'application/octet-stream',
      kind: 'file',
      byteSize: finished.byteSize,
      sha256: finished.sha256,
    }])).toContain(`(<${finished.path}>)`)

    expect(listFiles(serverRoot)).toEqual([])
    expect(findFilesContaining(testRoot, sentinel.subarray(0, 48))).toEqual([
      sourcePath,
      finished.path,
    ].sort())
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  }, 20_000)
})

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
}

function findFilesContaining(root: string, needle: Buffer): string[] {
  return listFiles(root)
    .filter((filePath) => fs.readFileSync(filePath).includes(needle))
    .sort()
}
