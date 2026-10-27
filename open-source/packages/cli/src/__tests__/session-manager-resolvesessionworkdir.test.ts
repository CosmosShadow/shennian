// @covers src/session/manager.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deletionOrder,
  mockDeliveryStates,
  mockFiles,
  mockFindSourceTombstone,
  mockIsCodexThreadTailInterrupted,
  mockLookupClaudeTranscriptCwd,
  mockMergeProjectedSessions,
  mockPlatform,
  mockReadDeletionRevision,
  mockSessionMessages,
  mockSessionRecords,
  mockToolDetails,
  originalPlatform,
  importedTestDependencies,
} from './session-manager-test-harness.js'

const { os } = importedTestDependencies

describe('SessionManager resolvesessionworkdir', () => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  describe('resolveSessionWorkDir', () => {
    it('maps legacy /tmp workdirs to the Windows temp directory', async () => {
      mockPlatform('win32')
      vi.spyOn(os, 'tmpdir').mockReturnValue('C:\\Users\\demo\\AppData\\Local\\Temp')
      const { resolveSessionWorkDir } = await import('../session/manager.js')

      expect(resolveSessionWorkDir('/tmp')).toBe('C:\\Users\\demo\\AppData\\Local\\Temp')
      expect(resolveSessionWorkDir('/tmp/project')).toBe(
        'C:\\Users\\demo\\AppData\\Local\\Temp\\project',
      )
    })

    it('expands home-relative workdirs consistently', async () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/demo')
      const { resolveSessionWorkDir } = await import('../session/manager.js')

      expect(resolveSessionWorkDir('~')).toBe('/Users/demo')
      expect(resolveSessionWorkDir('~/repo')).toBe('/Users/demo/repo')
    })

    it('preserves Windows absolute workdirs instead of resolving them against the host cwd', async () => {
      mockPlatform('darwin')
      const { resolveSessionWorkDir } = await import('../session/manager.js')

      expect(resolveSessionWorkDir('G:\\Documents')).toBe('G:\\Documents')
      expect(resolveSessionWorkDir('\\\\server\\share\\repo')).toBe('\\\\server\\share\\repo')
    })

    it('normalizes route-style Windows drive paths before resolving', async () => {
      mockPlatform('win32')
      const { resolveSessionWorkDir } = await import('../session/manager.js')

      expect(resolveSessionWorkDir('/C:/Users/pc/Desktop/index.html')).toBe(
        'C:\\Users\\pc\\Desktop\\index.html',
      )
      expect(resolveSessionWorkDir('\\C:\\Users\\pc\\Desktop\\index.html')).toBe(
        'C:\\Users\\pc\\Desktop\\index.html',
      )
    })
  })
})
