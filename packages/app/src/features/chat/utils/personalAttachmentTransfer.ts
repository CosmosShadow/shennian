// @arch docs/architecture/data-sync.md#82-个人-session-附件的直达分片与本地权威
// @test src/__tests__/personal-attachment-transfer.test.ts

import * as Crypto from 'expo-crypto'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  serializeFsTransferManifest,
  type FsTransferAbortResult,
  type FsTransferChunkResult,
  type FsTransferFinishResult,
  type FsTransferManifestEntry,
  type FsTransferStartResult,
  type PersonalSyncIdentity,
  type ResFrame,
} from '@shennian/wire'

export const PERSONAL_ATTACHMENT_CHUNK_BYTES = 768 * 1024

export type PersonalAttachmentTransferFile = {
  bytes: Uint8Array
  mimeType: string
  relativePath?: string
}

type RelaySend = (
  machineId: string,
  frame: {
    type: 'req'
    method: 'fs.transfer.start' | 'fs.transfer.chunk' | 'fs.transfer.finish' | 'fs.transfer.abort'
    params: Record<string, unknown>
  },
  timeout?: number,
) => Promise<ResFrame>

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 16 * 1024)))
  }
  return btoa(binary)
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  digestInput.set(bytes)
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, digestInput)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Text(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value)
}

function hasExpectedIdentity(
  value: Partial<PersonalSyncIdentity> | null | undefined,
  expected: PersonalSyncIdentity,
): boolean {
  return value?.protocolVersion === expected.protocolVersion &&
    value.dataEpoch === expected.dataEpoch &&
    value.daemonInstallationId === expected.daemonInstallationId
}

function requireStartResult(
  response: ResFrame,
  transferId: string,
  identity: PersonalSyncIdentity,
): FsTransferStartResult {
  if (!response.ok) throw new Error(response.error ?? 'attachment_transfer_start_failed')
  const result = response.payload as Partial<FsTransferStartResult> | undefined
  if (
    !result || !hasExpectedIdentity(result, identity) ||
    result.transferId !== transferId || typeof result.path !== 'string' ||
    typeof result.reused !== 'boolean' || !result.offsets || typeof result.offsets !== 'object'
  ) throw new Error('invalid_attachment_transfer_start')
  return result as FsTransferStartResult
}

function requireFinishResult(
  response: ResFrame,
  expected: Omit<FsTransferFinishResult, 'path' | 'reused'>,
): FsTransferFinishResult {
  if (!response.ok) throw new Error(response.error ?? 'attachment_transfer_finish_failed')
  const result = response.payload as Partial<FsTransferFinishResult> | undefined
  if (
    !result || !hasExpectedIdentity(result, expected) ||
    result.transferId !== expected.transferId || typeof result.path !== 'string' ||
    result.name !== expected.name || result.mimeType !== expected.mimeType ||
    result.kind !== expected.kind || result.byteSize !== expected.byteSize ||
    result.sha256 !== expected.sha256 || typeof result.reused !== 'boolean'
  ) throw new Error('invalid_attachment_transfer_finish')
  return result as FsTransferFinishResult
}

export async function uploadPersonalAttachment(input: {
  send: RelaySend
  machineId: string
  daemonInstallationId: string
  rootPath: string
  transferId: string
  name: string
  mimeType: string
  kind: 'file' | 'folder'
  files: PersonalAttachmentTransferFile[]
  timeoutMs: number
  isAborted?: () => boolean
  onProgress?: (progress: number) => void
}): Promise<FsTransferFinishResult> {
  const identity: PersonalSyncIdentity = {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: input.daemonInstallationId,
  }
  if (!input.files.length) throw new Error('missing_attachment_data')
  const prepared = await Promise.all(input.files.map(async (file) => ({
    ...file,
    sha256: await sha256Bytes(file.bytes),
  })))
  const manifest: FsTransferManifestEntry[] | undefined = input.kind === 'folder'
    ? prepared.map((file) => ({
        relativePath: file.relativePath ?? '',
        size: file.bytes.byteLength,
        sha256: file.sha256,
        mimeType: file.mimeType,
      }))
    : undefined
  const totalSize = prepared.reduce((sum, file) => sum + file.bytes.byteLength, 0)
  const sha256 = manifest
    ? await sha256Text(serializeFsTransferManifest(manifest))
    : prepared[0]!.sha256
  const start = requireStartResult(await input.send(input.machineId, {
    type: 'req',
    method: 'fs.transfer.start',
    params: {
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: input.daemonInstallationId,
      transferId: input.transferId,
      rootPath: input.rootPath,
      name: input.name,
      totalSize,
      sha256,
      mimeType: input.mimeType,
      kind: input.kind,
      ...(manifest ? { manifest } : {}),
    },
  }, input.timeoutMs), input.transferId, identity)

  if (start.reused) {
    if (!start.attachment) throw new Error('invalid_attachment_reuse_metadata')
    return requireFinishResult({
      type: 'res', id: input.transferId, ok: true, payload: start.attachment,
    }, {
      ...identity,
      transferId: input.transferId,
      name: start.attachment.name,
      mimeType: start.attachment.mimeType,
      kind: start.attachment.kind,
      byteSize: totalSize,
      sha256,
    })
  }

  let uploadedBytes = 0
  for (const file of prepared) {
    const key = input.kind === 'folder' ? file.relativePath ?? '' : '__file__'
    let offset = Number(start.offsets[key] ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.bytes.byteLength) {
      throw new Error('invalid_attachment_resume_offset')
    }
    uploadedBytes += offset
    while (offset < file.bytes.byteLength) {
      if (input.isAborted?.()) throw new Error('attachment_transfer_aborted')
      const chunk = file.bytes.subarray(offset, Math.min(file.bytes.byteLength, offset + PERSONAL_ATTACHMENT_CHUNK_BYTES))
      const response = await input.send(input.machineId, {
        type: 'req',
        method: 'fs.transfer.chunk',
        params: {
          protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
          dataEpoch: SESSION_SYNC_DATA_EPOCH,
          daemonInstallationId: input.daemonInstallationId,
          transferId: input.transferId,
          rootPath: input.rootPath,
          offset,
          data: bytesToBase64(chunk),
          ...(input.kind === 'folder' ? { relativePath: file.relativePath } : {}),
        },
      }, input.timeoutMs)
      if (!response.ok) throw new Error(response.error ?? 'attachment_transfer_chunk_failed')
      const chunkResult = response.payload as Partial<FsTransferChunkResult> | undefined
      const nextOffset = chunkResult?.nextOffset
      if (
        !hasExpectedIdentity(chunkResult, identity) ||
        chunkResult?.transferId !== input.transferId ||
        chunkResult.written !== chunk.byteLength ||
        nextOffset !== offset + chunk.byteLength
      ) throw new Error('invalid_attachment_chunk_ack')
      offset = nextOffset
      uploadedBytes += chunk.byteLength
      input.onProgress?.(Math.min(0.99, uploadedBytes / Math.max(1, totalSize)))
    }
  }

  return requireFinishResult(await input.send(input.machineId, {
    type: 'req',
    method: 'fs.transfer.finish',
    params: {
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: input.daemonInstallationId,
      transferId: input.transferId,
      rootPath: input.rootPath,
    },
  }, input.timeoutMs), {
    ...identity,
    transferId: input.transferId,
    name: input.name,
    mimeType: input.mimeType,
    kind: input.kind,
    byteSize: totalSize,
    sha256,
  })
}

export async function abortPersonalAttachmentUpload(input: {
  send: RelaySend
  machineId: string
  daemonInstallationId: string
  rootPath: string
  transferId: string
  timeoutMs: number
}): Promise<void> {
  const identity: PersonalSyncIdentity = {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: input.daemonInstallationId,
  }
  const response = await input.send(input.machineId, {
    type: 'req',
    method: 'fs.transfer.abort',
    params: {
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: input.daemonInstallationId,
      transferId: input.transferId,
      rootPath: input.rootPath,
    },
  }, input.timeoutMs)
  if (!response.ok) throw new Error(response.error ?? 'attachment_transfer_abort_failed')
  const result = response.payload as Partial<FsTransferAbortResult> | undefined
  if (
    !hasExpectedIdentity(result, identity) ||
    result?.transferId !== input.transferId || result.aborted !== true
  ) throw new Error('invalid_attachment_transfer_abort')
}
