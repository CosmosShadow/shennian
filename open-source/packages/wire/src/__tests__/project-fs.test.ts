// @covers open-source/packages/wire/src/project-fs.ts
// @covers open-source/packages/wire/src/methods.ts
// @covers open-source/packages/wire/src/session-sync.ts

import { describe, expect, it } from 'vitest'
import {
  PROJECT_FS_LIMITS,
  PROJECT_FS_METHODS,
  PROJECT_FS_NEGOTIATION_METHOD,
  PROJECT_FS_OPAQUE_CAPABILITY,
  SESSION_SYNC_ADVERTISED_CAPABILITIES,
  SESSION_SYNC_REQUIRED_CAPABILITIES,
  getMissingSessionSyncCapabilities,
  hasProjectFsOpaqueCapability,
  isProjectFsMethod,
  parseProjectFsCloseParams,
  parseProjectFsCloseResult,
  parseProjectFsDirectoryPage,
  parseProjectFsListParams,
  parseProjectFsListResult,
  parseProjectFsNegotiationChallenge,
  parseProjectFsNegotiationResponse,
  parseProjectFsOpenParams,
  parseProjectFsOpenResult,
  parseProjectFsReadParams,
  parseProjectFsReadResult,
  parseProjectFsRejection,
} from '../index.ts'

const projectRef = 'p'.repeat(32)
const leaseId = 'l'.repeat(32)
const rootHandle = 'r'.repeat(32)
const directoryHandle = 'd'.repeat(32)
const fileHandle = 'f'.repeat(32)

const entries = [
  { handle: directoryHandle, name: 'src', kind: 'directory' as const, modifiedAt: 100 },
  { handle: fileHandle, name: 'README.md', kind: 'file' as const, size: 12, modifiedAt: 101 },
]

describe('project-scoped opaque file contract', () => {
  it('is known but neither required nor advertised before the secure runtime exists', () => {
    expect(PROJECT_FS_OPAQUE_CAPABILITY).toBe('project_fs_opaque_v1')
    expect(SESSION_SYNC_REQUIRED_CAPABILITIES).not.toContain(PROJECT_FS_OPAQUE_CAPABILITY)
    expect(SESSION_SYNC_ADVERTISED_CAPABILITIES).not.toContain(PROJECT_FS_OPAQUE_CAPABILITY)
    expect(getMissingSessionSyncCapabilities(SESSION_SYNC_REQUIRED_CAPABILITIES)).toEqual([])
    expect(
      getMissingSessionSyncCapabilities([
        ...SESSION_SYNC_REQUIRED_CAPABILITIES,
        PROJECT_FS_OPAQUE_CAPABILITY,
        'unknown_future_capability',
      ]),
    ).toEqual([])
    expect(hasProjectFsOpaqueCapability(undefined)).toBe(false)
    expect(hasProjectFsOpaqueCapability(['unknown_future_capability'])).toBe(false)
    expect(hasProjectFsOpaqueCapability([PROJECT_FS_OPAQUE_CAPABILITY])).toBe(true)
    expect(PROJECT_FS_METHODS).toEqual([
      'project.fs.open',
      'project.fs.list',
      'project.fs.read',
      'project.fs.close',
    ])
    expect(isProjectFsMethod('project.fs.open')).toBe(true)
    expect(isProjectFsMethod('fs.ls')).toBe(false)
    expect(isProjectFsMethod('project.fs.future')).toBe(false)
  })

  it('accepts only exact server challenge and daemon proof envelopes', () => {
    const challenge = {
      version: 1 as const,
      nonce: 'n'.repeat(32),
      daemonInstallationId: 'install-1',
    }
    expect(PROJECT_FS_NEGOTIATION_METHOD).toBe('project.fs.negotiate')
    expect(parseProjectFsNegotiationChallenge(challenge)).toEqual(challenge)
    expect(parseProjectFsNegotiationChallenge({ ...challenge, supported: true })).toBeNull()
    const response = {
      ...challenge,
      capability: PROJECT_FS_OPAQUE_CAPABILITY,
      proof: 'p'.repeat(32),
    }
    expect(parseProjectFsNegotiationResponse(response)).toEqual(response)
    expect(parseProjectFsNegotiationResponse({ ...response, capability: 'forged' })).toBeNull()
    expect(parseProjectFsNegotiationResponse({ ...response, proof: '/absolute/path' })).toBeNull()
  })

  it('accepts bounded path-free public requests and rejects renderer-supplied authority', () => {
    expect(parseProjectFsOpenParams({ projectRef, limit: 50 })).toEqual({ projectRef, limit: 50 })
    expect(
      parseProjectFsListParams({
        projectRef,
        leaseId,
        directoryHandle,
        cursor: 0,
        limit: 200,
      }),
    ).toEqual({ projectRef, leaseId, directoryHandle, cursor: 0, limit: 200 })
    expect(
      parseProjectFsReadParams({
        projectRef,
        leaseId,
        fileHandle,
        offset: 0,
        limitBytes: 256 * 1024,
        encoding: 'binary',
      }),
    ).toEqual({
      projectRef,
      leaseId,
      fileHandle,
      offset: 0,
      limitBytes: 256 * 1024,
      encoding: 'binary',
    })
    expect(parseProjectFsCloseParams({ projectRef, leaseId })).toEqual({ projectRef, leaseId })

    for (const forbidden of ['path', 'rootPath', 'workDir', 'scopeId', 'authority']) {
      expect(parseProjectFsOpenParams({ projectRef, [forbidden]: '/private/project' })).toBeNull()
      expect(
        parseProjectFsListParams({
          projectRef,
          leaseId,
          directoryHandle,
          [forbidden]: 'C:\\secret',
        }),
      ).toBeNull()
      expect(
        parseProjectFsReadParams({
          projectRef,
          leaseId,
          fileHandle,
          offset: 0,
          limitBytes: 1,
          [forbidden]: '/secret',
        }),
      ).toBeNull()
    }
  })

  it('rejects malformed tokens, traversal-shaped names and invalid numeric bounds', () => {
    expect(parseProjectFsOpenParams({ projectRef: '/Users/me/project' })).toBeNull()
    expect(parseProjectFsOpenParams({ projectRef, limit: 0 })).toBeNull()
    expect(
      parseProjectFsOpenParams({ projectRef, limit: PROJECT_FS_LIMITS.maxDirectoryPageItems + 1 }),
    ).toBeNull()
    expect(parseProjectFsListParams({ projectRef, leaseId: 'short', directoryHandle })).toBeNull()
    expect(
      parseProjectFsReadParams({
        projectRef,
        leaseId,
        fileHandle,
        offset: -1,
        limitBytes: 1,
      }),
    ).toBeNull()
    expect(
      parseProjectFsReadParams({
        projectRef,
        leaseId,
        fileHandle,
        offset: 0,
        limitBytes: PROJECT_FS_LIMITS.maxReadBytes + 1,
      }),
    ).toBeNull()
    expect(
      parseProjectFsDirectoryPage({
        directoryHandle: rootHandle,
        cursor: 0,
        nextCursor: null,
        entries: [{ handle: fileHandle, name: '../secret', kind: 'file', size: 1 }],
      }),
    ).toBeNull()
  })

  it('parses stable directory pages and refuses duplicate or discontinuous entries', () => {
    const page = { directoryHandle: rootHandle, cursor: 0, nextCursor: 2, entries }
    expect(parseProjectFsDirectoryPage(page)).toEqual(page)
    expect(parseProjectFsDirectoryPage({ ...page, nextCursor: 3 })).toBeNull()
    expect(
      parseProjectFsDirectoryPage({
        ...page,
        entries: [entries[0], { ...entries[1], handle: entries[0].handle }],
      }),
    ).toBeNull()
    expect(
      parseProjectFsDirectoryPage({
        directoryHandle: rootHandle,
        cursor: 10,
        nextCursor: null,
        entries: [],
      }),
    ).toBeNull()
  })

  it('keeps open/list responses opaque and binds the first page to the root handle', () => {
    const page = { directoryHandle: rootHandle, cursor: 0, nextCursor: 2, entries }
    const opened = {
      leaseId,
      root: { handle: rootHandle, name: 'shennian', kind: 'directory' as const },
      page,
      expiresAt: 2_000,
    }
    expect(parseProjectFsOpenResult(opened)).toEqual(opened)
    expect(
      parseProjectFsOpenResult({
        ...opened,
        page: { ...page, directoryHandle },
      }),
    ).toBeNull()
    expect(parseProjectFsOpenResult({ ...opened, rootPath: '/Users/me/shennian' })).toBeNull()

    const listed = { leaseId, ...page, expiresAt: 2_001 }
    expect(parseProjectFsListResult(listed)).toEqual(listed)
    expect(parseProjectFsListResult({ ...listed, path: 'C:\\project' })).toBeNull()
  })

  it('validates exact chunk continuity and a single text or binary representation', () => {
    const binary = {
      leaseId,
      fileHandle,
      offset: 0,
      bytesRead: 3,
      nextOffset: 3,
      totalSize: 6,
      dataBase64: 'YWJj',
      mimeType: 'application/octet-stream',
      expiresAt: 2_000,
    }
    expect(parseProjectFsReadResult(binary)).toEqual(binary)
    expect(
      parseProjectFsReadResult({
        ...binary,
        offset: 3,
        nextOffset: null,
        totalSize: 6,
      }),
    ).toEqual({ ...binary, offset: 3, nextOffset: null, totalSize: 6 })
    expect(parseProjectFsReadResult({ ...binary, nextOffset: 4 })).toBeNull()
    expect(parseProjectFsReadResult({ ...binary, text: 'abc' })).toBeNull()
    expect(parseProjectFsReadResult({ ...binary, bytesRead: 2 })).toBeNull()
    expect(parseProjectFsReadResult({ ...binary, dataBase64: '/Users/me/project' })).toBeNull()

    const text = {
      leaseId,
      fileHandle,
      offset: 0,
      bytesRead: 6,
      nextOffset: null,
      totalSize: 6,
      text: '你好',
      encoding: 'utf8',
      encodingFallback: false,
      mimeType: 'text/plain',
      expiresAt: 2_000,
    }
    expect(parseProjectFsReadResult(text)).toEqual(text)
  })

  it('parses close and structured failures without accepting unknown defaults', () => {
    expect(parseProjectFsCloseResult({ closed: true })).toEqual({ closed: true })
    expect(parseProjectFsCloseResult({ closed: false })).toBeNull()
    expect(
      parseProjectFsRejection({
        code: 'permission_denied',
        retryable: false,
        requiredAction: 'none',
      }),
    ).toEqual({ code: 'permission_denied', retryable: false, requiredAction: 'none' })
    expect(
      parseProjectFsRejection({
        code: 'future_error',
        retryable: false,
        requiredAction: 'none',
      }),
    ).toBeNull()
    expect(
      parseProjectFsRejection({
        code: 'machine_offline',
        retryable: true,
        requiredAction: 'retry',
        path: '/secret',
      }),
    ).toBeNull()
    expect(
      parseProjectFsRejection({
        code: 'io_error',
        message: 'Cannot read /Users/me/project',
        retryable: true,
        requiredAction: 'retry',
      }),
    ).toBeNull()
  })
})
