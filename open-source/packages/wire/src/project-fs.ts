// @arch open-source/docs/wire.md
// @test src/__tests__/project-fs.test.ts

export const PROJECT_FS_OPAQUE_CAPABILITY = 'project_fs_opaque_v1' as const
export type ProjectFsOpaqueCapability = typeof PROJECT_FS_OPAQUE_CAPABILITY

export const PROJECT_FS_NEGOTIATION_METHOD = 'project.fs.negotiate' as const
export const PROJECT_FS_SENSITIVE_AUTHORITY_VERSION = 1 as const

export type ProjectFsNegotiationChallenge = {
  version: typeof PROJECT_FS_SENSITIVE_AUTHORITY_VERSION
  nonce: string
  daemonInstallationId: string
}

export type ProjectFsNegotiationResponse = {
  version: typeof PROJECT_FS_SENSITIVE_AUTHORITY_VERSION
  capability: ProjectFsOpaqueCapability
  nonce: string
  daemonInstallationId: string
  proof: string
}

export function projectFsNegotiationProofPayload(
  requestId: string,
  challenge: ProjectFsNegotiationChallenge,
): string {
  return JSON.stringify([
    PROJECT_FS_NEGOTIATION_METHOD,
    requestId,
    challenge.version,
    challenge.nonce,
    challenge.daemonInstallationId,
    PROJECT_FS_OPAQUE_CAPABILITY,
  ])
}

export function parseProjectFsNegotiationChallenge(
  value: unknown,
): ProjectFsNegotiationChallenge | null {
  const input = recordWithExactKeys(value, ['version', 'nonce', 'daemonInstallationId'])
  if (
    !input ||
    input.version !== PROJECT_FS_SENSITIVE_AUTHORITY_VERSION ||
    !isOpaqueToken(input.nonce) ||
    typeof input.daemonInstallationId !== 'string' ||
    input.daemonInstallationId.length < 1 ||
    input.daemonInstallationId.length > 191
  )
    return null
  return {
    version: PROJECT_FS_SENSITIVE_AUTHORITY_VERSION,
    nonce: input.nonce,
    daemonInstallationId: input.daemonInstallationId,
  }
}

export function parseProjectFsNegotiationResponse(
  value: unknown,
): ProjectFsNegotiationResponse | null {
  const input = recordWithExactKeys(value, [
    'version',
    'capability',
    'nonce',
    'daemonInstallationId',
    'proof',
  ])
  if (!input || input.capability !== PROJECT_FS_OPAQUE_CAPABILITY) return null
  if (
    input.version !== PROJECT_FS_SENSITIVE_AUTHORITY_VERSION ||
    !isOpaqueToken(input.nonce) ||
    typeof input.daemonInstallationId !== 'string' ||
    input.daemonInstallationId.length < 1 ||
    input.daemonInstallationId.length > 191 ||
    !isOpaqueToken(input.proof)
  )
    return null
  return {
    version: PROJECT_FS_SENSITIVE_AUTHORITY_VERSION,
    capability: PROJECT_FS_OPAQUE_CAPABILITY,
    nonce: input.nonce,
    daemonInstallationId: input.daemonInstallationId,
    proof: input.proof,
  }
}

export const PROJECT_FS_METHODS = [
  'project.fs.open',
  'project.fs.list',
  'project.fs.read',
  'project.fs.close',
] as const
export type ProjectFsMethod = (typeof PROJECT_FS_METHODS)[number]

export const PROJECT_FS_LIMITS = {
  defaultDirectoryPageItems: 50,
  maxDirectoryPageItems: 200,
  maxReadBytes: 256 * 1024,
  maxTokenLength: 512,
  maxProjectRefLength: 1024,
  maxNameLength: 255,
} as const

export type ProjectFsEntryKind = 'directory' | 'file'
export type ProjectFsReadEncoding = 'binary' | 'auto'

export type ProjectFsEntry = {
  handle: string
  name: string
  kind: ProjectFsEntryKind
  size?: number
  modifiedAt?: number
}

export type ProjectFsDirectoryPage = {
  directoryHandle: string
  cursor: number
  nextCursor: number | null
  entries: ProjectFsEntry[]
}

export type ProjectFsOpenParams = {
  projectRef: string
  limit?: number
}

export type ProjectFsOpenResult = {
  leaseId: string
  root: {
    handle: string
    name: string
    kind: 'directory'
  }
  page: ProjectFsDirectoryPage
  expiresAt: number
}

export type ProjectFsListParams = {
  projectRef: string
  leaseId: string
  directoryHandle: string
  cursor?: number
  limit?: number
}

export type ProjectFsListResult = ProjectFsDirectoryPage & {
  leaseId: string
  expiresAt: number
}

export type ProjectFsReadParams = {
  projectRef: string
  leaseId: string
  fileHandle: string
  offset: number
  limitBytes: number
  encoding?: ProjectFsReadEncoding
}

export type ProjectFsReadResult = {
  leaseId: string
  fileHandle: string
  offset: number
  bytesRead: number
  nextOffset: number | null
  totalSize: number
  dataBase64?: string
  text?: string
  encoding?: string
  encodingFallback?: boolean
  mimeType?: string
  expiresAt: number
}

export type ProjectFsCloseParams = {
  projectRef: string
  leaseId: string
}

export type ProjectFsCloseResult = { closed: true }

export const PROJECT_FS_ERROR_CODES = [
  'capability_required',
  'machine_offline',
  'permission_denied',
  'project_not_found',
  'project_scope_changed',
  'handle_invalid',
  'handle_expired',
  'source_changed',
  'sensitive_path_denied',
  'unsupported_entry',
  'read_too_large',
  'rate_limited',
  'io_error',
] as const
export type ProjectFsErrorCode = (typeof PROJECT_FS_ERROR_CODES)[number]

export const PROJECT_FS_REQUIRED_ACTIONS = [
  'retry',
  'refresh_project',
  'upgrade_daemon',
  'reauthenticate',
  'none',
] as const
export type ProjectFsRequiredAction = (typeof PROJECT_FS_REQUIRED_ACTIONS)[number]

/** Server-only envelope. Clients may send this key, but Server must replace it wholesale. */
export const PROJECT_FS_AUTHORITY_PARAM = '__projectFsAuthority' as const

export type ProjectFsAuthority = {
  projectRef: string
  scopeId: string
  accountScope: string
  machineId: string
  projectId: string
  rootPath: string
  rootDigest: string
  authorizationEpoch: number
  daemonInstallationId: string
  generation: string
  expiresAt: number
}

export type ProjectFsTrustedEnvelope = {
  version: 1
  requestId: string
  method: ProjectFsMethod
  params: ProjectFsOpenParams | ProjectFsListParams | ProjectFsReadParams | ProjectFsCloseParams
  authority: ProjectFsAuthority
  signature: string
}

export type ProjectFsRejection = {
  code: ProjectFsErrorCode
  message?: string
  retryable: boolean
  requiredAction: ProjectFsRequiredAction
}

export function isProjectFsMethod(value: unknown): value is ProjectFsMethod {
  return typeof value === 'string' && PROJECT_FS_METHODS.includes(value as ProjectFsMethod)
}

type UnknownRecord = Record<string, unknown>

const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function recordWithExactKeys(value: unknown, allowedKeys: readonly string[]): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as UnknownRecord
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) return null
  }
  return record
}

function isSafeIntegerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
}

function isOpaqueToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    value.length <= PROJECT_FS_LIMITS.maxTokenLength &&
    OPAQUE_TOKEN_PATTERN.test(value)
  )
}

function isProjectRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    value.length <= PROJECT_FS_LIMITS.maxProjectRefLength &&
    OPAQUE_TOKEN_PATTERN.test(value)
  )
}

function isDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PROJECT_FS_LIMITS.maxNameLength &&
    !/[\u0000-\u001f\u007f\\/]/.test(value) &&
    value !== '.' &&
    value !== '..'
  )
}

function optionalLimit(value: unknown): value is number | undefined {
  return (
    value === undefined || isSafeIntegerBetween(value, 1, PROJECT_FS_LIMITS.maxDirectoryPageItems)
  )
}

function parseEntry(value: unknown): ProjectFsEntry | null {
  const entry = recordWithExactKeys(value, ['handle', 'name', 'kind', 'size', 'modifiedAt'])
  if (!entry || !isOpaqueToken(entry.handle) || !isDisplayName(entry.name)) return null
  if (entry.kind !== 'directory' && entry.kind !== 'file') return null
  if (entry.size !== undefined && !isSafeIntegerBetween(entry.size, 0, Number.MAX_SAFE_INTEGER)) {
    return null
  }
  if (entry.kind === 'directory' && entry.size !== undefined) return null
  if (
    entry.modifiedAt !== undefined &&
    (!Number.isFinite(entry.modifiedAt) || Number(entry.modifiedAt) < 0)
  ) {
    return null
  }
  return {
    handle: entry.handle,
    name: entry.name,
    kind: entry.kind,
    ...(entry.size === undefined ? {} : { size: Number(entry.size) }),
    ...(entry.modifiedAt === undefined ? {} : { modifiedAt: Number(entry.modifiedAt) }),
  }
}

export function parseProjectFsDirectoryPage(value: unknown): ProjectFsDirectoryPage | null {
  const page = recordWithExactKeys(value, ['directoryHandle', 'cursor', 'nextCursor', 'entries'])
  if (!page || !isOpaqueToken(page.directoryHandle)) return null
  if (!isSafeIntegerBetween(page.cursor, 0, Number.MAX_SAFE_INTEGER)) return null
  if (
    page.nextCursor !== null &&
    !isSafeIntegerBetween(page.nextCursor, 1, Number.MAX_SAFE_INTEGER)
  )
    return null
  if (
    !Array.isArray(page.entries) ||
    page.entries.length > PROJECT_FS_LIMITS.maxDirectoryPageItems
  ) {
    return null
  }
  const entries: ProjectFsEntry[] = []
  const handles = new Set<string>()
  for (const rawEntry of page.entries) {
    const entry = parseEntry(rawEntry)
    if (!entry || handles.has(entry.handle)) return null
    handles.add(entry.handle)
    entries.push(entry)
  }
  const expectedNextCursor = Number(page.cursor) + entries.length
  if (page.nextCursor !== null && page.nextCursor !== expectedNextCursor) return null
  if (page.nextCursor === null && entries.length === 0 && Number(page.cursor) !== 0) return null
  return {
    directoryHandle: page.directoryHandle,
    cursor: Number(page.cursor),
    nextCursor: page.nextCursor === null ? null : Number(page.nextCursor),
    entries,
  }
}

export function parseProjectFsOpenParams(value: unknown): ProjectFsOpenParams | null {
  const params = recordWithExactKeys(value, ['projectRef', 'limit'])
  if (!params || !isProjectRef(params.projectRef) || !optionalLimit(params.limit)) return null
  return {
    projectRef: params.projectRef,
    ...(params.limit === undefined ? {} : { limit: Number(params.limit) }),
  }
}

export function parseProjectFsOpenResult(value: unknown): ProjectFsOpenResult | null {
  const result = recordWithExactKeys(value, ['leaseId', 'root', 'page', 'expiresAt'])
  if (
    !result ||
    !isOpaqueToken(result.leaseId) ||
    !isSafeIntegerBetween(result.expiresAt, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return null
  }
  const root = recordWithExactKeys(result.root, ['handle', 'name', 'kind'])
  if (
    !root ||
    !isOpaqueToken(root.handle) ||
    !isDisplayName(root.name) ||
    root.kind !== 'directory'
  ) {
    return null
  }
  const page = parseProjectFsDirectoryPage(result.page)
  if (!page || page.directoryHandle !== root.handle) return null
  return {
    leaseId: result.leaseId,
    root: { handle: root.handle, name: root.name, kind: 'directory' },
    page,
    expiresAt: Number(result.expiresAt),
  }
}

export function parseProjectFsListParams(value: unknown): ProjectFsListParams | null {
  const params = recordWithExactKeys(value, [
    'projectRef',
    'leaseId',
    'directoryHandle',
    'cursor',
    'limit',
  ])
  if (
    !params ||
    !isProjectRef(params.projectRef) ||
    !isOpaqueToken(params.leaseId) ||
    !isOpaqueToken(params.directoryHandle) ||
    !optionalLimit(params.limit) ||
    (params.cursor !== undefined &&
      !isSafeIntegerBetween(params.cursor, 0, Number.MAX_SAFE_INTEGER))
  ) {
    return null
  }
  return {
    projectRef: params.projectRef,
    leaseId: params.leaseId,
    directoryHandle: params.directoryHandle,
    ...(params.cursor === undefined ? {} : { cursor: Number(params.cursor) }),
    ...(params.limit === undefined ? {} : { limit: Number(params.limit) }),
  }
}

export function parseProjectFsListResult(value: unknown): ProjectFsListResult | null {
  const result = recordWithExactKeys(value, [
    'leaseId',
    'directoryHandle',
    'cursor',
    'nextCursor',
    'entries',
    'expiresAt',
  ])
  if (
    !result ||
    !isOpaqueToken(result.leaseId) ||
    !isSafeIntegerBetween(result.expiresAt, 1, Number.MAX_SAFE_INTEGER)
  )
    return null
  const page = parseProjectFsDirectoryPage({
    directoryHandle: result.directoryHandle,
    cursor: result.cursor,
    nextCursor: result.nextCursor,
    entries: result.entries,
  })
  if (!page) return null
  return { ...page, leaseId: result.leaseId, expiresAt: Number(result.expiresAt) }
}

export function parseProjectFsReadParams(value: unknown): ProjectFsReadParams | null {
  const params = recordWithExactKeys(value, [
    'projectRef',
    'leaseId',
    'fileHandle',
    'offset',
    'limitBytes',
    'encoding',
  ])
  if (
    !params ||
    !isProjectRef(params.projectRef) ||
    !isOpaqueToken(params.leaseId) ||
    !isOpaqueToken(params.fileHandle) ||
    !isSafeIntegerBetween(params.offset, 0, Number.MAX_SAFE_INTEGER) ||
    !isSafeIntegerBetween(params.limitBytes, 1, PROJECT_FS_LIMITS.maxReadBytes) ||
    (params.encoding !== undefined && params.encoding !== 'binary' && params.encoding !== 'auto')
  ) {
    return null
  }
  return {
    projectRef: params.projectRef,
    leaseId: params.leaseId,
    fileHandle: params.fileHandle,
    offset: Number(params.offset),
    limitBytes: Number(params.limitBytes),
    ...(params.encoding === undefined ? {} : { encoding: params.encoding }),
  }
}

function isBase64Page(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= Math.ceil(PROJECT_FS_LIMITS.maxReadBytes / 3) * 4 &&
    BASE64_PATTERN.test(value)
  )
}

function base64ByteLength(value: string): number {
  if (!value) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function isOptionalMetadataString(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 255 &&
      !/[\u0000-\u001f\u007f]/.test(value))
  )
}

export function parseProjectFsReadResult(value: unknown): ProjectFsReadResult | null {
  const result = recordWithExactKeys(value, [
    'leaseId',
    'fileHandle',
    'offset',
    'bytesRead',
    'nextOffset',
    'totalSize',
    'dataBase64',
    'text',
    'encoding',
    'encodingFallback',
    'mimeType',
    'expiresAt',
  ])
  if (
    !result ||
    !isOpaqueToken(result.leaseId) ||
    !isOpaqueToken(result.fileHandle) ||
    !isSafeIntegerBetween(result.offset, 0, Number.MAX_SAFE_INTEGER) ||
    !isSafeIntegerBetween(result.bytesRead, 0, PROJECT_FS_LIMITS.maxReadBytes) ||
    !isSafeIntegerBetween(result.totalSize, 0, Number.MAX_SAFE_INTEGER) ||
    !isSafeIntegerBetween(result.expiresAt, 1, Number.MAX_SAFE_INTEGER)
  )
    return null
  const expectedNextOffset = Number(result.offset) + Number(result.bytesRead)
  if (expectedNextOffset > Number(result.totalSize)) return null
  if (result.nextOffset !== null && result.nextOffset !== expectedNextOffset) return null
  if (result.nextOffset === null && expectedNextOffset !== Number(result.totalSize)) return null
  const hasBinary = result.dataBase64 !== undefined
  const hasText = result.text !== undefined
  if (hasBinary === hasText) return null
  if (hasBinary && !isBase64Page(result.dataBase64)) return null
  if (hasBinary && base64ByteLength(result.dataBase64 as string) !== Number(result.bytesRead)) {
    return null
  }
  if (
    hasText &&
    (typeof result.text !== 'string' || result.text.length > PROJECT_FS_LIMITS.maxReadBytes)
  ) {
    return null
  }
  if (!isOptionalMetadataString(result.encoding) || !isOptionalMetadataString(result.mimeType)) {
    return null
  }
  if (result.encodingFallback !== undefined && typeof result.encodingFallback !== 'boolean') {
    return null
  }
  return {
    leaseId: result.leaseId,
    fileHandle: result.fileHandle,
    offset: Number(result.offset),
    bytesRead: Number(result.bytesRead),
    nextOffset: result.nextOffset === null ? null : Number(result.nextOffset),
    totalSize: Number(result.totalSize),
    ...(hasBinary ? { dataBase64: result.dataBase64 as string } : { text: result.text as string }),
    ...(result.encoding === undefined ? {} : { encoding: result.encoding }),
    ...(result.encodingFallback === undefined ? {} : { encodingFallback: result.encodingFallback }),
    ...(result.mimeType === undefined ? {} : { mimeType: result.mimeType }),
    expiresAt: Number(result.expiresAt),
  }
}

export function parseProjectFsCloseParams(value: unknown): ProjectFsCloseParams | null {
  const params = recordWithExactKeys(value, ['projectRef', 'leaseId'])
  if (!params || !isProjectRef(params.projectRef) || !isOpaqueToken(params.leaseId)) return null
  return { projectRef: params.projectRef, leaseId: params.leaseId }
}

export function parseProjectFsCloseResult(value: unknown): ProjectFsCloseResult | null {
  const result = recordWithExactKeys(value, ['closed'])
  return result?.closed === true ? { closed: true } : null
}

export function parseProjectFsRejection(value: unknown): ProjectFsRejection | null {
  const rejection = recordWithExactKeys(value, ['code', 'message', 'retryable', 'requiredAction'])
  if (
    !rejection ||
    !PROJECT_FS_ERROR_CODES.includes(rejection.code as ProjectFsErrorCode) ||
    !PROJECT_FS_REQUIRED_ACTIONS.includes(rejection.requiredAction as ProjectFsRequiredAction) ||
    typeof rejection.retryable !== 'boolean' ||
    (rejection.message !== undefined &&
      (typeof rejection.message !== 'string' ||
        rejection.message.length > 512 ||
        /[\u0000-\u001f\u007f]/.test(rejection.message) ||
        /(?:^|\s)(?:\/[A-Za-z0-9._-]|[A-Za-z]:[\\/]|\\\\)/.test(rejection.message)))
  )
    return null
  return {
    code: rejection.code as ProjectFsErrorCode,
    ...(rejection.message === undefined ? {} : { message: rejection.message as string }),
    retryable: rejection.retryable,
    requiredAction: rejection.requiredAction as ProjectFsRequiredAction,
  }
}

/** Future clients must require this exact capability and never probe legacy path RPCs. */
export function hasProjectFsOpaqueCapability(
  capabilities: readonly string[] | null | undefined,
): boolean {
  return capabilities?.includes(PROJECT_FS_OPAQUE_CAPABILITY) === true
}

export function parseProjectFsTrustedEnvelope(value: unknown): ProjectFsTrustedEnvelope | null {
  const envelope = recordWithExactKeys(value, [
    'version', 'requestId', 'method', 'params', 'authority', 'signature',
  ])
  if (
    !envelope || envelope.version !== 1 || typeof envelope.requestId !== 'string' ||
    !envelope.requestId || envelope.requestId.length > 191 || !isProjectFsMethod(envelope.method) ||
    typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(envelope.signature)
  ) return null
  const params = envelope.method === 'project.fs.open'
      ? parseProjectFsOpenParams(envelope.params)
      : envelope.method === 'project.fs.list'
        ? parseProjectFsListParams(envelope.params)
        : envelope.method === 'project.fs.read'
          ? parseProjectFsReadParams(envelope.params)
          : parseProjectFsCloseParams(envelope.params)
  const authority = recordWithExactKeys(envelope.authority, [
    'projectRef', 'scopeId', 'accountScope', 'machineId', 'projectId', 'rootPath', 'rootDigest',
    'authorizationEpoch', 'daemonInstallationId', 'generation', 'expiresAt',
  ])
  if (
    !params || !authority || authority.projectRef !== params.projectRef ||
    !isProjectRef(authority.projectRef) || !isOpaqueToken(authority.scopeId) ||
    !isOpaqueToken(authority.accountScope) || typeof authority.machineId !== 'string' ||
    !authority.machineId || authority.machineId.length > 191 || typeof authority.projectId !== 'string' ||
    !authority.projectId || authority.projectId.length > 64 || typeof authority.rootPath !== 'string' ||
    !authority.rootPath || authority.rootPath.length > 4096 || !isOpaqueToken(authority.rootDigest) ||
    !isSafeIntegerBetween(authority.authorizationEpoch, 0, Number.MAX_SAFE_INTEGER) ||
    typeof authority.daemonInstallationId !== 'string' || !authority.daemonInstallationId ||
    authority.daemonInstallationId.length > 191 || typeof authority.generation !== 'string' ||
    !isOpaqueToken(authority.generation) ||
    !isSafeIntegerBetween(authority.expiresAt, 1, Number.MAX_SAFE_INTEGER)
  ) return null
  return {
    version: 1,
    requestId: envelope.requestId,
    method: envelope.method,
    params,
    authority: authority as ProjectFsAuthority,
    signature: envelope.signature,
  }
}

export function projectFsAuthoritySigningPayload(
  envelope: Omit<ProjectFsTrustedEnvelope, 'signature'>,
): string {
  const authority = envelope.authority
  return JSON.stringify([
    envelope.version, envelope.requestId, envelope.method, envelope.params,
    authority.projectRef, authority.scopeId, authority.accountScope, authority.machineId,
    authority.projectId, authority.rootPath, authority.rootDigest, authority.authorizationEpoch,
    authority.daemonInstallationId, authority.generation, authority.expiresAt,
  ])
}
