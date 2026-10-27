// @covers src/session/manager.ts

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

const { fs, os } = importedTestDependencies

describe('SessionManager fs-ls-roots-navigation', () => {
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

  describe('fs.ls roots navigation', () => {
    it('returns virtual filesystem roots for cross-directory browsing', async () => {
      vi.spyOn(os, 'platform').mockReturnValue('win32')
      vi.spyOn(fs, 'existsSync').mockImplementation(
        (target) => target === 'C:\\' || target === 'D:\\',
      )

      await manager.handleReq({
        type: 'req',
        id: 'fs-roots',
        method: 'fs.ls',
        params: { path: '__roots__' },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-roots',
        ok: true,
        payload: {
          path: '__roots__',
          entries: [
            { name: 'C:\\', path: 'C:\\', isDir: true },
            { name: 'D:\\', path: 'D:\\', isDir: true },
          ],
        },
      })
    })

    it('keeps Windows-style paths intact when listing nested directories', async () => {
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        {
          name: 'code',
          isDirectory: () => true,
        },
      ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>)

      await manager.handleReq({
        type: 'req',
        id: 'fs-win-dir',
        method: 'fs.ls',
        params: { path: 'G:\\Documents', rootPath: 'G:\\Documents' },
      })

      expect(fs.promises.readdir).toHaveBeenCalledWith('G:\\Documents', { withFileTypes: true })
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-win-dir',
        ok: true,
        payload: {
          path: 'G:\\Documents',
          entries: [{ name: 'code', path: 'G:\\Documents\\code', isDir: true }],
        },
      })
    })

    it('expands ~ to the Linux root user home before scanning', async () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/root')
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        {
          name: 'workspace',
          isDirectory: () => true,
        },
      ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>)

      await manager.handleReq({
        type: 'req',
        id: 'fs-home',
        method: 'fs.ls',
        params: { path: '~' },
      })

      expect(fs.promises.readdir).toHaveBeenCalledWith('/root', { withFileTypes: true })
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-home',
        ok: true,
        payload: {
          path: '/root',
          entries: [{ name: 'workspace', path: '/root/workspace', isDir: true }],
        },
      })
    })

    it('does not join ~ under /root when the current workDir is already /root', async () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/root')
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>,
      )

      await manager.handleReq({
        type: 'req',
        id: 'fs-root-home',
        method: 'fs.ls',
        params: { path: '~', rootPath: '/root' },
      })

      expect(fs.promises.readdir).toHaveBeenCalledWith('/root', { withFileTypes: true })
      expect(fs.promises.readdir).not.toHaveBeenCalledWith('/root/~', expect.anything())
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-root-home',
        ok: true,
        payload: {
          path: '/root',
          entries: [],
        },
      })
    })

    it('allows switching from /root to another absolute directory when the picker omits rootPath', async () => {
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        {
          name: 'app',
          isDirectory: () => true,
        },
      ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>)

      await manager.handleReq({
        type: 'req',
        id: 'fs-absolute-switch',
        method: 'fs.ls',
        params: { path: '/var/www' },
      })

      expect(fs.promises.readdir).toHaveBeenCalledWith('/var/www', { withFileTypes: true })
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-absolute-switch',
        ok: true,
        payload: {
          path: '/var/www',
          entries: [{ name: 'app', path: '/var/www/app', isDir: true }],
        },
      })
    })

    it('returns a readable error for missing directories', async () => {
      vi.spyOn(fs.promises, 'readdir').mockRejectedValue(
        Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
      )

      await manager.handleReq({
        type: 'req',
        id: 'fs-missing',
        method: 'fs.ls',
        params: { path: '/missing/project' },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-missing',
        ok: false,
        error: 'Directory not found: /missing/project',
      })
    })

    it('does not block daemon timers while a directory is slow', async () => {
      let finishListing!: (entries: never[]) => void
      vi.spyOn(fs.promises, 'readdir').mockReturnValue(
        new Promise<never[]>((resolve) => {
          finishListing = resolve
        }) as unknown as ReturnType<typeof fs.promises.readdir>,
      )

      const listing = manager.handleReq({
        type: 'req',
        id: 'fs-slow-directory',
        method: 'fs.ls',
        params: { path: '/slow-volume' },
      })
      let timerRan = false
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          timerRan = true
          resolve()
        })
      })

      expect(timerRan).toBe(true)
      expect(client.sendRes).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'fs-slow-directory' }),
      )

      finishListing([])
      await listing
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-slow-directory',
        ok: true,
        payload: { path: '/slow-volume', entries: [] },
      })
    })
  })
})
