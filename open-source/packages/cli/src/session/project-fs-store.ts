// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-fs-store.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  PROJECT_FS_LIMITS,
  type ProjectFsDirectoryPage,
  type ProjectFsEntry,
  type ProjectFsAuthority,
  type ProjectFsErrorCode,
  type ProjectFsListParams,
  type ProjectFsListResult,
  type ProjectFsOpenParams,
  type ProjectFsOpenResult,
  type ProjectFsReadParams,
  type ProjectFsReadResult,
  type ProjectFsRequiredAction,
} from '@shennian/wire'
import { resolveProtectedShennianDirectories } from '../security/managed-agent-credential-paths.js'

const LEASE_IDLE_MS = 10 * 60_000
const LEASE_MAX_MS = 30 * 60_000
const MAX_ACTIVE_LEASES_PER_SCOPE = 8
const MAX_HANDLES_PER_LEASE = 2_000
const MAX_DIRECTORY_ENTRIES = 10_000
const MAX_PREVIEW_FILE_BYTES = 25 * 1024 * 1024

export type TrustedProjectFsAuthority = ProjectFsAuthority

type SourceIdentity = {
  dev: number
  ino: number
  mode: number
  size: number
  mtimeMs: number
  ctimeMs: number
}

type SnapshotEntry = {
  name: string
  kind: 'directory' | 'file'
  identity: SourceIdentity
}

type HandleRecord = {
  handle: string
  leaseId: string
  targetPath: string
  parentHandle: string | null
  kind: 'directory' | 'file'
  identity: SourceIdentity
  directorySnapshot?: SnapshotEntry[]
  nextCursor?: number | null
  nextReadOffset?: number
}

type LeaseRecord = {
  leaseId: string
  scopeHash: string
  authority: TrustedProjectFsAuthority
  rootPath: string
  rootHandle: string
  createdAt: number
  expiresAt: number
  handles: Map<string, HandleRecord>
}

export class ProjectFsStoreError extends Error {
  constructor(
    readonly code: ProjectFsErrorCode,
    readonly retryable: boolean,
    readonly requiredAction: ProjectFsRequiredAction,
  ) {
    super(code)
    this.name = 'ProjectFsStoreError'
  }
}

export type ProjectFsHandleStoreOptions = {
  now?: () => number
  randomToken?: () => string
  protectedRoots?: () => readonly string[]
}

/**
 * Keeps every native path daemon-side. Callers must obtain authority through a
 * server-verifying resolver; no method accepts a renderer-supplied path.
 */
export class ProjectFsHandleStore {
  private readonly leases = new Map<string, LeaseRecord>()
  private readonly now: () => number
  private readonly randomToken: () => string
  private readonly protectedRoots: () => readonly string[]

  constructor(options: ProjectFsHandleStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.randomToken = options.randomToken ?? (() => crypto.randomBytes(32).toString('base64url'))
    this.protectedRoots = options.protectedRoots ?? resolveProtectedShennianDirectories
  }

  async open(
    authority: TrustedProjectFsAuthority,
    params: ProjectFsOpenParams,
  ): Promise<ProjectFsOpenResult> {
    this.assertAuthority(authority, params.projectRef)
    this.revokeStale(authority)
    const now = this.now()
    const scopeHash = this.scopeHash(authority)
    const activeCount = Array.from(this.leases.values()).filter(
      (lease) => lease.authority.accountScope === authority.accountScope &&
        lease.authority.machineId === authority.machineId &&
        lease.expiresAt > now,
    ).length
    if (activeCount >= MAX_ACTIVE_LEASES_PER_SCOPE) throw rejected('rate_limited', true, 'retry')

    const requestedRoot = path.resolve(authority.rootPath)
    const rootLstat = await safeLstat(requestedRoot, 'project_not_found')
    if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) {
      throw rejected('unsupported_entry', false, 'refresh_project')
    }
    const canonicalRoot = await safeRealpath(requestedRoot, 'project_not_found')
    if (canonicalRoot !== requestedRoot) throw rejected('project_scope_changed', false, 'refresh_project')
    this.assertNotProtected(canonicalRoot)
    const verifiedRoot = await safeLstat(canonicalRoot, 'project_not_found')
    if (!sameIdentity(rootLstat, verifiedRoot)) {
      throw rejected('source_changed', true, 'refresh_project')
    }

    const leaseId = this.issueUniqueToken(this.leases)
    const rootHandle = this.issueUniqueToken()
    const expiresAt = Math.min(authority.expiresAt, now + LEASE_IDLE_MS)
    const rootRecord: HandleRecord = {
      handle: rootHandle,
      leaseId,
      targetPath: canonicalRoot,
      parentHandle: null,
      kind: 'directory',
      identity: identityOf(verifiedRoot),
    }
    const lease: LeaseRecord = {
      leaseId,
      scopeHash,
      authority: { ...authority, rootPath: canonicalRoot },
      rootPath: canonicalRoot,
      rootHandle,
      createdAt: now,
      expiresAt,
      handles: new Map([[rootHandle, rootRecord]]),
    }
    this.leases.set(leaseId, lease)
    try {
      const page = await this.listPage(lease, rootRecord, 0, params.limit)
      return {
        leaseId,
        root: { handle: rootHandle, name: safeDisplayName(canonicalRoot), kind: 'directory' },
        page,
        expiresAt: lease.expiresAt,
      }
    } catch (error) {
      this.leases.delete(leaseId)
      throw error
    }
  }

  async list(
    authority: TrustedProjectFsAuthority,
    params: ProjectFsListParams,
  ): Promise<ProjectFsListResult> {
    const lease = this.requireLease(authority, params.projectRef, params.leaseId)
    const record = this.requireHandle(lease, params.directoryHandle, 'directory')
    const page = await this.listPage(lease, record, params.cursor ?? 0, params.limit)
    this.renew(lease)
    return { ...page, leaseId: lease.leaseId, expiresAt: lease.expiresAt }
  }

  async read(
    authority: TrustedProjectFsAuthority,
    params: ProjectFsReadParams,
  ): Promise<ProjectFsReadResult> {
    const lease = this.requireLease(authority, params.projectRef, params.leaseId)
    const record = this.requireHandle(lease, params.fileHandle, 'file')
    if (params.limitBytes > PROJECT_FS_LIMITS.maxReadBytes) {
      throw rejected('read_too_large', false, 'none')
    }
    if (params.offset !== (record.nextReadOffset ?? 0)) {
      throw rejected('source_changed', true, 'retry')
    }
    const before = await this.verifyRecord(lease, record)
    if (before.size > MAX_PREVIEW_FILE_BYTES || params.offset > before.size) {
      throw rejected('read_too_large', false, 'none')
    }

    let descriptor: fs.promises.FileHandle | null = null
    try {
      const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
      descriptor = await fs.promises.open(record.targetPath, fs.constants.O_RDONLY | noFollow)
      const opened = await descriptor.stat()
      if (!opened.isFile() || opened.nlink !== 1 || !sameIdentity(before, opened)) {
        throw rejected('source_changed', true, 'retry')
      }
      const requested = Math.min(params.limitBytes, opened.size - params.offset)
      const buffer = Buffer.alloc(requested)
      const result = await descriptor.read(buffer, 0, requested, params.offset)
      const after = await descriptor.stat()
      if (!sameIdentity(opened, after)) throw rejected('source_changed', true, 'retry')
      const afterPath = await safeLstat(record.targetPath, 'source_changed')
      if (!sameIdentity(after, afterPath)) throw rejected('source_changed', true, 'retry')
      await this.assertContained(lease.rootPath, record.targetPath)
      const bytes = buffer.subarray(0, result.bytesRead)
      const nextOffset = params.offset + result.bytesRead < after.size
        ? params.offset + result.bytesRead
        : null
      record.nextReadOffset = nextOffset ?? after.size
      this.renew(lease)
      return {
        leaseId: lease.leaseId,
        fileHandle: record.handle,
        offset: params.offset,
        bytesRead: result.bytesRead,
        nextOffset,
        totalSize: after.size,
        dataBase64: bytes.toString('base64'),
        mimeType: mimeFor(record.targetPath),
        expiresAt: lease.expiresAt,
      }
    } catch (error) {
      if (error instanceof ProjectFsStoreError) throw error
      throw rejected('io_error', true, 'retry')
    } finally {
      await descriptor?.close().catch(() => {})
    }
  }

  close(authority: TrustedProjectFsAuthority, projectRef: string, leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) return
    this.assertLeaseAuthority(lease, authority, projectRef)
    this.leases.delete(leaseId)
  }

  revokeScope(scopeId: string): void {
    for (const [leaseId, lease] of this.leases) {
      if (lease.authority.scopeId === scopeId) this.leases.delete(leaseId)
    }
  }

  revokeAll(): void {
    this.leases.clear()
  }

  private async listPage(
    lease: LeaseRecord,
    directory: HandleRecord,
    cursor: number,
    requestedLimit?: number,
  ): Promise<ProjectFsDirectoryPage> {
    await this.verifyRecord(lease, directory)
    const current = await this.readDirectorySnapshot(lease, directory.targetPath)
    if (directory.directorySnapshot) {
      if (!sameSnapshot(directory.directorySnapshot, current)) {
        throw rejected('source_changed', true, 'retry')
      }
      if (cursor !== directory.nextCursor) throw rejected('source_changed', true, 'retry')
    } else {
      if (cursor !== 0) throw rejected('source_changed', true, 'retry')
      directory.directorySnapshot = current
    }
    const limit = requestedLimit ?? PROJECT_FS_LIMITS.defaultDirectoryPageItems
    const pageEntries = current.slice(cursor, cursor + limit)
    const entries: ProjectFsEntry[] = []
    for (const entry of pageEntries) {
      if (lease.handles.size >= MAX_HANDLES_PER_LEASE) {
        throw rejected('rate_limited', true, 'refresh_project')
      }
      const targetPath = path.join(directory.targetPath, entry.name)
      const stat = await safeLstat(targetPath, 'source_changed')
      if (!sameIdentity(entry.identity, stat)) throw rejected('source_changed', true, 'retry')
      await this.assertContained(lease.rootPath, targetPath)
      const verified = await safeLstat(targetPath, 'source_changed')
      if (!sameIdentity(stat, verified)) throw rejected('source_changed', true, 'retry')
      const handle = this.issueUniqueToken(lease.handles)
      lease.handles.set(handle, {
        handle,
        leaseId: lease.leaseId,
        targetPath,
        parentHandle: directory.handle,
        kind: entry.kind,
        identity: entry.identity,
      })
      entries.push({
        handle,
        name: entry.name,
        kind: entry.kind,
        ...(entry.kind === 'file' ? { size: entry.identity.size } : {}),
        modifiedAt: entry.identity.mtimeMs,
      })
    }
    const nextCursor = cursor + entries.length < current.length ? cursor + entries.length : null
    directory.nextCursor = nextCursor
    return { directoryHandle: directory.handle, cursor, nextCursor, entries }
  }

  private async readDirectorySnapshot(lease: LeaseRecord, directoryPath: string): Promise<SnapshotEntry[]> {
    let names: string[]
    try {
      names = await fs.promises.readdir(directoryPath)
    } catch {
      throw rejected('io_error', true, 'retry')
    }
    if (names.length > MAX_DIRECTORY_ENTRIES) throw rejected('rate_limited', true, 'none')
    names.sort(compareNames)
    const entries: SnapshotEntry[] = []
    for (const name of names) {
      if (!isSafeEntryName(name) || isHiddenOrSensitive(name)) continue
      const targetPath = path.join(directoryPath, name)
      const stat = await safeLstat(targetPath, 'source_changed')
      if (stat.isSymbolicLink()) continue
      const kind = stat.isDirectory() ? 'directory' : stat.isFile() && stat.nlink === 1 ? 'file' : null
      if (!kind) continue
      await this.assertContained(lease.rootPath, targetPath)
      const verified = await safeLstat(targetPath, 'source_changed')
      if (!sameIdentity(stat, verified)) throw rejected('source_changed', true, 'retry')
      entries.push({ name, kind, identity: identityOf(stat) })
    }
    return entries
  }

  private async verifyRecord(lease: LeaseRecord, record: HandleRecord): Promise<fs.Stats> {
    const stat = await safeLstat(record.targetPath, 'source_changed')
    if (stat.isSymbolicLink() || !sameIdentity(record.identity, stat)) {
      throw rejected('source_changed', true, 'retry')
    }
    if (record.kind === 'file' && (!stat.isFile() || stat.nlink !== 1)) {
      throw rejected('unsupported_entry', false, 'none')
    }
    if (record.kind === 'directory' && !stat.isDirectory()) {
      throw rejected('unsupported_entry', false, 'none')
    }
    await this.assertContained(lease.rootPath, record.targetPath)
    return stat
  }

  private async assertContained(rootPath: string, targetPath: string): Promise<void> {
    const real = await safeRealpath(targetPath, 'source_changed')
    const relative = path.relative(rootPath, real)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw rejected('permission_denied', false, 'refresh_project')
    }
    this.assertNotProtected(real)
  }

  private assertNotProtected(realPath: string): void {
    let protectedRoots: readonly string[]
    try {
      protectedRoots = this.protectedRoots()
    } catch {
      throw rejected('sensitive_path_denied', false, 'none')
    }
    if (protectedRoots.some((root) => isWithinOrEqual(realPath, path.resolve(root)))) {
      throw rejected('sensitive_path_denied', false, 'none')
    }
  }

  private requireLease(
    authority: TrustedProjectFsAuthority,
    projectRef: string,
    leaseId: string,
  ): LeaseRecord {
    this.assertAuthority(authority, projectRef)
    this.revokeStale(authority)
    const lease = this.leases.get(leaseId)
    if (!lease) throw rejected('handle_invalid', false, 'refresh_project')
    if (lease.expiresAt <= this.now()) {
      this.leases.delete(leaseId)
      throw rejected('handle_expired', false, 'refresh_project')
    }
    this.assertLeaseAuthority(lease, authority, projectRef)
    lease.expiresAt = Math.min(lease.expiresAt, authority.expiresAt)
    return lease
  }

  private requireHandle(
    lease: LeaseRecord,
    handle: string,
    kind: 'directory' | 'file',
  ): HandleRecord {
    const record = lease.handles.get(handle)
    if (!record || record.kind !== kind) throw rejected('handle_invalid', false, 'refresh_project')
    return record
  }

  private assertAuthority(authority: TrustedProjectFsAuthority, projectRef: string): void {
    if (
      !authority ||
      authority.projectRef !== projectRef ||
      !authority.scopeId ||
      !authority.accountScope ||
      !authority.machineId ||
      !authority.projectId ||
      !authority.rootDigest ||
      !authority.daemonInstallationId ||
      !authority.generation ||
      !path.isAbsolute(authority.rootPath) ||
      !Number.isSafeInteger(authority.authorizationEpoch) ||
      authority.authorizationEpoch < 0 ||
      !Number.isSafeInteger(authority.expiresAt) ||
      authority.expiresAt <= this.now()
    ) {
      throw rejected('permission_denied', false, 'reauthenticate')
    }
  }

  private assertLeaseAuthority(
    lease: LeaseRecord,
    authority: TrustedProjectFsAuthority,
    projectRef: string,
  ): void {
    if (lease.scopeHash !== this.scopeHash(authority) || lease.authority.projectRef !== projectRef) {
      throw rejected('project_scope_changed', false, 'refresh_project')
    }
  }

  private revokeStale(authority: TrustedProjectFsAuthority): void {
    const now = this.now()
    for (const [leaseId, lease] of this.leases) {
      const sameProject = lease.authority.accountScope === authority.accountScope &&
        lease.authority.machineId === authority.machineId &&
        lease.authority.projectId === authority.projectId
      if (lease.expiresAt <= now || (sameProject && lease.scopeHash !== this.scopeHash(authority))) {
        this.leases.delete(leaseId)
      }
    }
  }

  private renew(lease: LeaseRecord): void {
    lease.expiresAt = Math.min(
      lease.authority.expiresAt,
      lease.createdAt + LEASE_MAX_MS,
      this.now() + LEASE_IDLE_MS,
    )
  }

  private scopeHash(authority: TrustedProjectFsAuthority): string {
    return crypto.createHash('sha256').update([
      authority.scopeId,
      authority.accountScope,
      authority.machineId,
      authority.projectId,
      path.resolve(authority.rootPath),
      authority.rootDigest,
      String(authority.authorizationEpoch),
      authority.daemonInstallationId,
      authority.generation,
    ].join('\0')).digest('base64url')
  }

  private issueUniqueToken(records?: Map<string, unknown>): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = this.randomToken()
      if (/^[A-Za-z0-9_-]{32,512}$/.test(token) && !this.leases.has(token) && !records?.has(token)) {
        return token
      }
    }
    throw rejected('io_error', true, 'retry')
  }
}

function rejected(
  code: ProjectFsErrorCode,
  retryable: boolean,
  requiredAction: ProjectFsRequiredAction,
): ProjectFsStoreError {
  return new ProjectFsStoreError(code, retryable, requiredAction)
}

async function safeLstat(value: string, missingCode: ProjectFsErrorCode): Promise<fs.Stats> {
  try {
    return await fs.promises.lstat(value)
  } catch {
    throw rejected(missingCode, missingCode === 'source_changed', missingCode === 'project_not_found' ? 'refresh_project' : 'retry')
  }
}

async function safeRealpath(value: string, missingCode: ProjectFsErrorCode): Promise<string> {
  try {
    return await fs.promises.realpath(value)
  } catch {
    throw rejected(missingCode, missingCode === 'source_changed', missingCode === 'project_not_found' ? 'refresh_project' : 'retry')
  }
}

function identityOf(stat: fs.Stats): SourceIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  }
}

function sameIdentity(left: SourceIdentity | fs.Stats, right: SourceIdentity | fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function sameSnapshot(left: SnapshotEntry[], right: SnapshotEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const candidate = right[index]
    return candidate !== undefined && entry.name === candidate.name && entry.kind === candidate.kind &&
      sameIdentity(entry.identity, candidate.identity)
  })
}

function isSafeEntryName(name: string): boolean {
  return name.length > 0 && name.length <= PROJECT_FS_LIMITS.maxNameLength &&
    name !== '.' && name !== '..' && !/[\u0000-\u001f\u007f\\/]/.test(name)
}

function isHiddenOrSensitive(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('.') || lower.endsWith('.key') || lower.endsWith('.pem') ||
    lower === 'credentials' || lower === 'id_rsa' || lower === 'id_ed25519'
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isWithinOrEqual(candidate: string, root: string): boolean {
  const normalize = (value: string) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value)
  const relative = path.relative(normalize(root), normalize(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function safeDisplayName(rootPath: string): string {
  const name = path.basename(rootPath)
  return isSafeEntryName(name) ? name : 'Project'
}

function mimeFor(value: string): string {
  const extension = path.extname(value).toLowerCase()
  const known: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  }
  return known[extension] ?? 'application/octet-stream'
}
