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

describe('SessionManager fs-write', () => {
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

  describe('fs.write', () => {
    it('writes a text file inside the authorized workdir', async () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true)
      vi.spyOn(fs, 'statSync').mockImplementation(
        (target) =>
          ({
            isFile: () => String(target).endsWith('README.md'),
            isDirectory: () => !String(target).endsWith('README.md'),
            size: String(target).endsWith('README.md') ? 11 : 0,
            mtimeMs: String(target).endsWith('README.md') ? 2345 : 1,
          }) as Stats,
      )

      await manager.handleReq({
        type: 'req',
        id: 'write-1',
        method: 'fs.write',
        params: {
          path: '/tmp/project/README.md',
          rootPath: '/tmp/project',
          content: '# Updated\n',
        },
      })

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/project/README.md',
        '# Updated\n',
        'utf-8',
      )
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'write-1',
        ok: true,
        payload: { path: '/tmp/project/README.md', size: 11, modifiedAt: 2345 },
      })
    })

    it('rejects missing content and directory targets', async () => {
      await manager.handleReq({
        type: 'req',
        id: 'write-missing',
        method: 'fs.write',
        params: { path: '/tmp/project/README.md', rootPath: '/tmp/project' },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'write-missing',
        ok: false,
        error: 'path and content are required',
      })

      vi.mocked(fs.existsSync).mockReturnValueOnce(true)
      vi.spyOn(fs, 'statSync')
        .mockReturnValueOnce({
          isFile: () => false,
          isDirectory: () => true,
        } as Stats)
        .mockReturnValueOnce({
          isFile: () => false,
          isDirectory: () => true,
        } as Stats)

      await manager.handleReq({
        type: 'req',
        id: 'write-dir',
        method: 'fs.write',
        params: { path: '/tmp/project/docs', rootPath: '/tmp/project', content: 'x' },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'write-dir',
        ok: false,
        error: 'Not a file',
      })
    })
  })
})
