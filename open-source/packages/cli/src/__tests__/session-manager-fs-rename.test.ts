// @covers src/session/manager.ts

import type { Stats } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockClient,
  createTestSessionManager,
  deletionOrder,
  mockDeliveryStates,
  mockFiles,
  mockFindSourceTombstone,
  mockIsCodexThreadTailInterrupted,
  mockLookupClaudeTranscriptCwd,
  mockMergeProjectedSessions,
  mockReadDeletionRevision,
  mockSessionMessages,
  mockSessionRecords,
  mockToolDetails,
  originalPlatform,
  importedTestDependencies,
} from './session-manager-test-harness.js'

const { fs } = importedTestDependencies

describe('SessionManager fs-rename', () => {
  let client: ReturnType<typeof createMockClient>
  let manager: ReturnType<typeof createTestSessionManager>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFiles.clear()
    mockSessionMessages.clear()
    mockDeliveryStates.clear()
    mockToolDetails.clear()
    mockSessionRecords.clear()
    deletionOrder.length = 0
    mockReadDeletionRevision.mockReturnValue(0)
    mockFindSourceTombstone.mockReturnValue(null)
    mockLookupClaudeTranscriptCwd.mockReturnValue(null)
    mockIsCodexThreadTailInterrupted.mockReturnValue(false)
    mockMergeProjectedSessions.mockClear()
    client = createMockClient()
    manager = createTestSessionManager(client as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  describe('fs.rename', () => {
    it('renames a file inside the authorized workdir', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.spyOn(fs, 'statSync').mockImplementation(
        (target) =>
          ({
            size: String(target).endsWith('/new.txt') ? 12 : 0,
            mtimeMs: String(target).endsWith('/new.txt') ? 1234 : 1,
            isFile: () => String(target).endsWith('.txt'),
            isDirectory: () => !String(target).endsWith('.txt'),
          }) as Stats,
      )

      await manager.handleReq({
        type: 'req',
        id: 'rename-1',
        method: 'fs.rename',
        params: { path: '/tmp/project/old.txt', rootPath: '/tmp/project', newName: 'new.txt' },
      })

      expect(fs.renameSync).toHaveBeenCalledWith('/tmp/project/old.txt', '/tmp/project/new.txt')
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'rename-1',
        ok: true,
        payload: {
          oldPath: '/tmp/project/old.txt',
          newPath: '/tmp/project/new.txt',
          entry: {
            name: 'new.txt',
            path: '/tmp/project/new.txt',
            isDir: false,
            size: 12,
            modifiedAt: 1234,
          },
        },
      })
    })

    it('renames a sibling when rootPath is omitted by older clients', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.spyOn(fs, 'statSync').mockImplementation(
        (target) =>
          ({
            size: String(target).endsWith('/new-folder') ? 0 : 8,
            mtimeMs: String(target).endsWith('/new-folder') ? 4567 : 1,
            isFile: () => false,
            isDirectory: () => true,
          }) as Stats,
      )

      await manager.handleReq({
        type: 'req',
        id: 'rename-omitted-root',
        method: 'fs.rename',
        params: { path: '/tmp/project/old-folder', newName: 'new-folder' },
      })

      expect(fs.renameSync).toHaveBeenCalledWith(
        '/tmp/project/old-folder',
        '/tmp/project/new-folder',
      )
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'rename-omitted-root',
        ok: true,
        payload: {
          oldPath: '/tmp/project/old-folder',
          newPath: '/tmp/project/new-folder',
          entry: {
            name: 'new-folder',
            path: '/tmp/project/new-folder',
            isDir: true,
            size: undefined,
            modifiedAt: 4567,
          },
        },
      })
    })

    it('rejects path-like new names and existing targets', async () => {
      await manager.handleReq({
        type: 'req',
        id: 'rename-bad-name',
        method: 'fs.rename',
        params: { path: '/tmp/project/old.txt', rootPath: '/tmp/project', newName: '../new.txt' },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'rename-bad-name',
        ok: false,
        error: 'Invalid newName',
      })

      vi.spyOn(fs, 'statSync').mockImplementation(
        (target) =>
          ({
            size: 0,
            mtimeMs: 1,
            isFile: () => String(target).endsWith('.txt'),
            isDirectory: () => !String(target).endsWith('.txt'),
          }) as Stats,
      )
      vi.mocked(fs.existsSync).mockReturnValueOnce(true)
      await manager.handleReq({
        type: 'req',
        id: 'rename-exists',
        method: 'fs.rename',
        params: { path: '/tmp/project/old.txt', rootPath: '/tmp/project', newName: 'new.txt' },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'rename-exists',
        ok: false,
        error: 'Target already exists',
      })
    })
  })
})
