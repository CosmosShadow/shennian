// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/attachment-transfer-store.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import {
  serializeFsTransferManifest,
  type FsTransferFinishResult,
  type FsTransferManifestEntry,
  type FsTransferStartParams,
  type FsTransferStartResult,
  type PersonalSyncIdentity,
} from '@shennian/wire'

type PersonalSyncIdentityKey = keyof PersonalSyncIdentity
type LocalFsTransferStartParams = Omit<FsTransferStartParams, PersonalSyncIdentityKey>
type LocalFsTransferFinishResult = Omit<FsTransferFinishResult, PersonalSyncIdentityKey>
type LocalFsTransferStartResult = Omit<FsTransferStartResult, PersonalSyncIdentityKey | 'attachment'> & {
  attachment?: LocalFsTransferFinishResult
}

export const ATTACHMENT_TRANSFER_IDLE_MS = 10 * 60 * 1000
export const ATTACHMENT_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000
export const ATTACHMENT_MAX_CHUNK_BYTES = 1024 * 1024
export const ATTACHMENT_MAX_FILE_BYTES = 1024 * 1024 * 1024
export const ATTACHMENT_MAX_FOLDER_FILES = 2000
export const ATTACHMENT_MAX_FOLDER_BYTES = 1024 * 1024 * 1024

const MANIFEST_VERSION = 1
const FILE_KEY = '__file__'
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

type PersistedFile = FsTransferManifestEntry & {
  receivedSize: number
}

type PersistedTransferManifest = {
  version: typeof MANIFEST_VERSION
  transferId: string
  rootPath: string
  uploadsRoot: string
  kind: 'file' | 'folder'
  name: string
  mimeType: string
  totalSize: number
  sha256: string
  targetPath: string
  createdAt: number
  lastActivityAt: number
  files: PersistedFile[]
}

type FinishedAttachmentMetadata = {
  version: typeof MANIFEST_VERSION
  transferId: string
  path: string
  name: string
  mimeType: string
  kind: 'file' | 'folder'
  byteSize: number
  sha256: string
  finishedAt: number
  referencedAt: number | null
  files?: FsTransferManifestEntry[]
}

export type AttachmentTransferCleanupResult = {
  stagingRemoved: number
  orphanRemoved: number
}

function uploadsRoot(rootPath: string): string {
  return path.join(rootPath, '.uploads')
}

function stagingRoot(rootPath: string): string {
  return path.join(uploadsRoot(rootPath), '.staging')
}

function metadataRoot(rootPath: string): string {
  return path.join(uploadsRoot(rootPath), '.metadata')
}

function transferDirectory(rootPath: string, transferId: string): string {
  return path.join(stagingRoot(rootPath), transferId)
}

function manifestPath(rootPath: string, transferId: string): string {
  return path.join(transferDirectory(rootPath, transferId), 'manifest.json')
}

function metadataPath(rootPath: string, sha256: string): string {
  return path.join(metadataRoot(rootPath), `${sha256.toLowerCase()}.json`)
}

function ensureWithin(parent: string, candidate: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new Error('attachment_path_outside_uploads')
}

function validateTransferId(transferId: string): void {
  if (!TRANSFER_ID_PATTERN.test(transferId)) throw new Error('invalid_transfer_id')
}

function validateSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) throw new Error('invalid_attachment_sha256')
  return value.toLowerCase()
}

function validateFileName(name: string): string {
  if (!name || name.trim() !== name || path.basename(name) !== name || name === '.' || name === '..') {
    throw new Error('invalid_attachment_name')
  }
  if (Array.from(name).some((char) => char.charCodeAt(0) <= 0x1f)) {
    throw new Error('invalid_attachment_name')
  }
  return name
}

function validateRelativePath(value: string): string {
  if (!value || value.trim() !== value || value.includes('\\')) {
    throw new Error('invalid_attachment_relative_path')
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error('invalid_attachment_relative_path')
  }
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('invalid_attachment_relative_path')
  }
  return value
}

function validateSize(value: number, limit: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error(`invalid_${field}`)
  return value
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  renameSyncWithRetry(tempPath, filePath)
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(256 * 1024)
  try {
    let read = 0
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (read > 0) hash.update(buffer.subarray(0, read))
    } while (read > 0)
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

function aggregateFolderHash(files: readonly FsTransferManifestEntry[]): string {
  return crypto.createHash('sha256').update(serializeFsTransferManifest(files)).digest('hex')
}

function payloadPath(rootPath: string, transferId: string, relativePath?: string): string {
  const payloadRoot = path.join(transferDirectory(rootPath, transferId), 'payload')
  const result = relativePath ? path.join(payloadRoot, ...relativePath.split('/')) : payloadRoot
  ensureWithin(transferDirectory(rootPath, transferId), result)
  return result
}

function parseManifest(rootPath: string, transferId: string): PersistedTransferManifest {
  validateTransferId(transferId)
  const manifest = readJson<PersistedTransferManifest>(manifestPath(rootPath, transferId))
  if (
    !manifest || manifest.version !== MANIFEST_VERSION || manifest.transferId !== transferId ||
    path.resolve(manifest.rootPath) !== path.resolve(rootPath)
  ) {
    throw new Error('invalid_transfer_id')
  }
  ensureWithin(uploadsRoot(rootPath), manifest.targetPath)
  return manifest
}

function persistManifest(manifest: PersistedTransferManifest): void {
  atomicWriteJson(manifestPath(manifest.rootPath, manifest.transferId), manifest)
}

function uniqueTargetPath(basePath: string, sha256: string): string {
  if (!fs.existsSync(basePath)) return basePath
  const parsed = path.parse(basePath)
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? sha256.slice(0, 10) : `${sha256.slice(0, 10)}-${index + 1}`
    const candidate = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('attachment_name_conflict')
}

function loadReusable(rootPath: string, sha256: string): FinishedAttachmentMetadata | null {
  const metadata = readJson<FinishedAttachmentMetadata>(metadataPath(rootPath, sha256))
  if (!metadata || metadata.version !== MANIFEST_VERSION || metadata.sha256 !== sha256) return null
  try {
    ensureWithin(uploadsRoot(rootPath), metadata.path)
    const stat = fs.statSync(metadata.path)
    if (
      metadata.kind === 'file' &&
      (!stat.isFile() || stat.size !== metadata.byteSize || hashFile(metadata.path) !== metadata.sha256)
    ) return null
    if (metadata.kind === 'folder') {
      if (!stat.isDirectory() || !metadata.files?.length) return null
      for (const file of metadata.files) {
        const filePath = path.join(metadata.path, ...validateRelativePath(file.relativePath).split('/'))
        ensureWithin(metadata.path, filePath)
        if (
          !fs.statSync(filePath).isFile() || fs.statSync(filePath).size !== file.size ||
          hashFile(filePath) !== file.sha256
        ) return null
      }
      if (aggregateFolderHash(metadata.files) !== metadata.sha256) return null
    }
    return metadata
  } catch {
    return null
  }
}

function resultFromMetadata(metadata: FinishedAttachmentMetadata, reused: boolean): LocalFsTransferFinishResult {
  return {
    transferId: metadata.transferId,
    path: metadata.path,
    name: metadata.name,
    mimeType: metadata.mimeType,
    kind: metadata.kind,
    byteSize: metadata.byteSize,
    sha256: metadata.sha256,
    reused,
  }
}

function normalizeFiles(input: LocalFsTransferStartParams): PersistedFile[] {
  if (input.kind === 'file') {
    return [{ relativePath: FILE_KEY, size: input.totalSize, sha256: input.sha256, receivedSize: 0 }]
  }
  if (!input.manifest?.length || input.manifest.length > ATTACHMENT_MAX_FOLDER_FILES) {
    throw new Error('invalid_attachment_manifest')
  }
  const seen = new Set<string>()
  let totalSize = 0
  const files = input.manifest.map((entry) => {
    const relativePath = validateRelativePath(entry.relativePath)
    if (seen.has(relativePath)) throw new Error('duplicate_attachment_relative_path')
    seen.add(relativePath)
    const size = validateSize(entry.size, ATTACHMENT_MAX_FILE_BYTES, 'attachment_size')
    totalSize += size
    if (totalSize > ATTACHMENT_MAX_FOLDER_BYTES) throw new Error('attachment_folder_too_large')
    return { ...entry, relativePath, size, sha256: validateSha256(entry.sha256), receivedSize: 0 }
  })
  if (totalSize !== input.totalSize) throw new Error('attachment_total_size_mismatch')
  if (aggregateFolderHash(files) !== input.sha256) throw new Error('attachment_manifest_hash_mismatch')
  return files
}

export function startAttachmentTransfer(
  input: LocalFsTransferStartParams,
  now = Date.now(),
): LocalFsTransferStartResult {
  validateTransferId(input.transferId)
  const name = validateFileName(input.name)
  const sha256 = validateSha256(input.sha256)
  const sizeLimit = input.kind === 'folder' ? ATTACHMENT_MAX_FOLDER_BYTES : ATTACHMENT_MAX_FILE_BYTES
  const totalSize = validateSize(input.totalSize, sizeLimit, 'attachment_total_size')
  if (!input.rootPath || !path.isAbsolute(input.rootPath)) throw new Error('invalid_attachment_root')
  if (!input.mimeType || input.mimeType.length > 255) throw new Error('invalid_attachment_mime_type')

  sweepAttachmentTransfers(input.rootPath, now)
  const reusable = loadReusable(input.rootPath, sha256)
  if (reusable && reusable.kind === input.kind && reusable.byteSize === totalSize) {
    return {
      transferId: input.transferId,
      path: reusable.path,
      reused: true,
      offsets: {},
      attachment: { ...resultFromMetadata(reusable, true), transferId: input.transferId },
    }
  }

  const existing = readJson<PersistedTransferManifest>(manifestPath(input.rootPath, input.transferId))
  if (existing) {
    if (
      existing.sha256 !== sha256 || existing.totalSize !== totalSize || existing.name !== name ||
      existing.kind !== input.kind || existing.mimeType !== input.mimeType
    ) throw new Error('transfer_identity_conflict')
    existing.lastActivityAt = now
    persistManifest(existing)
    return {
      transferId: input.transferId,
      path: existing.targetPath,
      reused: false,
      offsets: Object.fromEntries(existing.files.map((file) => [file.relativePath, file.receivedSize])),
    }
  }

  const files = normalizeFiles({ ...input, name, sha256, totalSize })
  const root = uploadsRoot(input.rootPath)
  fs.mkdirSync(stagingRoot(input.rootPath), { recursive: true, mode: 0o700 })
  fs.mkdirSync(metadataRoot(input.rootPath), { recursive: true, mode: 0o700 })
  const directory = transferDirectory(input.rootPath, input.transferId)
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 })
  const baseTargetPath = path.join(root, name)
  ensureWithin(root, baseTargetPath)
  const targetPath = uniqueTargetPath(baseTargetPath, sha256)
  if (input.kind === 'folder') {
    fs.mkdirSync(payloadPath(input.rootPath, input.transferId), { recursive: true, mode: 0o700 })
    for (const file of files) {
      const filePath = payloadPath(input.rootPath, input.transferId, file.relativePath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
      fs.writeFileSync(filePath, Buffer.alloc(0), { mode: 0o600 })
    }
  } else {
    fs.writeFileSync(payloadPath(input.rootPath, input.transferId), Buffer.alloc(0), { mode: 0o600 })
  }
  const manifest: PersistedTransferManifest = {
    version: MANIFEST_VERSION,
    transferId: input.transferId,
    rootPath: path.resolve(input.rootPath),
    uploadsRoot: root,
    kind: input.kind,
    name,
    mimeType: input.mimeType,
    totalSize,
    sha256,
    targetPath,
    createdAt: now,
    lastActivityAt: now,
    files,
  }
  persistManifest(manifest)
  return {
    transferId: input.transferId,
    path: targetPath,
    reused: false,
    offsets: Object.fromEntries(files.map((file) => [file.relativePath, 0])),
  }
}

export function appendAttachmentTransferChunk(input: {
  rootPath: string
  transferId: string
  relativePath?: string
  offset: number
  data: Buffer
  now?: number
}): { written: number; nextOffset: number } {
  const manifest = parseManifest(input.rootPath, input.transferId)
  const key = manifest.kind === 'file' ? FILE_KEY : validateRelativePath(input.relativePath ?? '')
  const file = manifest.files.find((entry) => entry.relativePath === key)
  if (!file) throw new Error('invalid_attachment_relative_path')
  if (!Number.isSafeInteger(input.offset) || input.offset !== file.receivedSize) {
    throw new Error(input.offset < file.receivedSize ? 'duplicate_attachment_chunk' : 'out_of_order_attachment_chunk')
  }
  if (input.data.length <= 0 || input.data.length > ATTACHMENT_MAX_CHUNK_BYTES) {
    throw new Error('invalid_attachment_chunk_size')
  }
  if (input.offset + input.data.length > file.size) throw new Error('attachment_chunk_exceeds_size')
  const filePath = payloadPath(
    input.rootPath,
    input.transferId,
    manifest.kind === 'folder' ? file.relativePath : undefined,
  )
  fs.appendFileSync(filePath, input.data)
  file.receivedSize += input.data.length
  manifest.lastActivityAt = input.now ?? Date.now()
  persistManifest(manifest)
  return { written: input.data.length, nextOffset: file.receivedSize }
}

export function finishAttachmentTransfer(
  rootPath: string,
  transferId: string,
  now = Date.now(),
): LocalFsTransferFinishResult {
  const manifest = parseManifest(rootPath, transferId)
  for (const file of manifest.files) {
    if (file.receivedSize !== file.size) throw new Error('attachment_transfer_incomplete')
    const filePath = payloadPath(
      rootPath,
      transferId,
      manifest.kind === 'folder' ? file.relativePath : undefined,
    )
    if (fs.statSync(filePath).size !== file.size) throw new Error('attachment_size_mismatch')
    if (hashFile(filePath) !== file.sha256) throw new Error('attachment_hash_mismatch')
  }
  if (manifest.kind === 'folder' && aggregateFolderHash(manifest.files) !== manifest.sha256) {
    throw new Error('attachment_manifest_hash_mismatch')
  }

  const reusable = loadReusable(rootPath, manifest.sha256)
  if (reusable && reusable.kind === manifest.kind && reusable.byteSize === manifest.totalSize) {
    fs.rmSync(transferDirectory(rootPath, transferId), { recursive: true, force: true })
    return { ...resultFromMetadata(reusable, true), transferId }
  }

  fs.mkdirSync(path.dirname(manifest.targetPath), { recursive: true, mode: 0o700 })
  const sourcePath = payloadPath(rootPath, transferId)
  renameSyncWithRetry(sourcePath, manifest.targetPath)
  const metadata: FinishedAttachmentMetadata = {
    version: MANIFEST_VERSION,
    transferId,
    path: manifest.targetPath,
    name: manifest.name,
    mimeType: manifest.mimeType,
    kind: manifest.kind,
    byteSize: manifest.totalSize,
    sha256: manifest.sha256,
    finishedAt: now,
    referencedAt: null,
    ...(manifest.kind === 'folder'
      ? {
          files: manifest.files.map(({ receivedSize: _receivedSize, ...file }) => file),
        }
      : {}),
  }
  atomicWriteJson(metadataPath(rootPath, manifest.sha256), metadata)
  fs.rmSync(transferDirectory(rootPath, transferId), { recursive: true, force: true })
  return resultFromMetadata(metadata, false)
}

export function abortAttachmentTransfer(rootPath: string, transferId: string): boolean {
  validateTransferId(transferId)
  const directory = transferDirectory(rootPath, transferId)
  ensureWithin(stagingRoot(rootPath), directory)
  const existed = fs.existsSync(directory)
  fs.rmSync(directory, { recursive: true, force: true })
  return existed
}

export function markAttachmentReferences(
  rootPath: string,
  attachments: readonly { path: string; sha256: string }[],
  now = Date.now(),
): void {
  for (const attachment of attachments) {
    if (!SHA256_PATTERN.test(attachment.sha256)) continue
    const metadataFile = metadataPath(rootPath, attachment.sha256)
    const metadata = readJson<FinishedAttachmentMetadata>(metadataFile)
    if (!metadata || path.resolve(metadata.path) !== path.resolve(attachment.path)) continue
    ensureWithin(uploadsRoot(rootPath), metadata.path)
    metadata.referencedAt = metadata.referencedAt ?? now
    atomicWriteJson(metadataFile, metadata)
  }
}

export function assertFinishedAttachmentReferences(
  rootPath: string,
  attachments: readonly {
    path: string
    name: string
    mimeType: string
    kind: 'file' | 'image' | 'folder'
    byteSize: number
    sha256: string
  }[],
): void {
  for (const attachment of attachments) {
    const sha256 = validateSha256(attachment.sha256)
    const metadata = loadReusable(rootPath, sha256)
    if (!metadata) throw new Error('attachment_not_finished')
    const expectedKind = metadata.kind === 'folder'
      ? 'folder'
      : metadata.mimeType.startsWith('image/') ? 'image' : 'file'
    if (
      path.resolve(metadata.path) !== path.resolve(attachment.path) ||
      metadata.name !== attachment.name || metadata.mimeType !== attachment.mimeType ||
      metadata.byteSize !== attachment.byteSize || expectedKind !== attachment.kind
    ) throw new Error('attachment_reference_mismatch')
  }
}

export function sweepAttachmentTransfers(
  rootPath: string,
  now = Date.now(),
): AttachmentTransferCleanupResult {
  const result = { stagingRemoved: 0, orphanRemoved: 0 }
  for (const _ of sweepAttachmentTransferEntries(rootPath, now, result)) { /* synchronous caller */ }
  return result
}

/** Keep each entry's read/check/delete atomic, yielding only between entries. */
export async function sweepAttachmentTransfersCooperatively(
  rootPath: string,
  now = Date.now(),
  shouldContinue: () => boolean = () => true,
): Promise<AttachmentTransferCleanupResult> {
  const result = { stagingRemoved: 0, orphanRemoved: 0 }
  let entries = 0
  for (const _ of sweepAttachmentTransferEntries(rootPath, now, result)) {
    if (++entries % 16 === 0) await new Promise<void>(resolve => setImmediate(resolve))
    if (!shouldContinue()) break
  }
  return result
}

function* sweepAttachmentTransferEntries(
  rootPath: string,
  now: number,
  result: AttachmentTransferCleanupResult,
): Generator<void> {
  const staging = stagingRoot(rootPath)
  try {
    for (const entry of fs.readdirSync(staging, { withFileTypes: true })) {
      yield
      if (!entry.isDirectory() || !TRANSFER_ID_PATTERN.test(entry.name)) continue
      const directory = path.join(staging, entry.name)
      const manifest = readJson<PersistedTransferManifest>(path.join(directory, 'manifest.json'))
      const lastActivityAt = manifest?.lastActivityAt ?? fs.statSync(directory).mtimeMs
      if (now - lastActivityAt < ATTACHMENT_TRANSFER_IDLE_MS) continue
      ensureWithin(staging, directory)
      fs.rmSync(directory, { recursive: true, force: true })
      result.stagingRemoved += 1
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const metadataDirectory = metadataRoot(rootPath)
  try {
    for (const entry of fs.readdirSync(metadataDirectory, { withFileTypes: true })) {
      yield
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const filePath = path.join(metadataDirectory, entry.name)
      const metadata = readJson<FinishedAttachmentMetadata>(filePath)
      if (!metadata || metadata.referencedAt !== null || now - metadata.finishedAt < ATTACHMENT_ORPHAN_TTL_MS) {
        continue
      }
      ensureWithin(uploadsRoot(rootPath), metadata.path)
      fs.rmSync(metadata.path, { recursive: metadata.kind === 'folder', force: true })
      fs.rmSync(filePath, { force: true })
      result.orphanRemoved += 1
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
