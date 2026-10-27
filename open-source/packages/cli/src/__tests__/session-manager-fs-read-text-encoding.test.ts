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

describe('SessionManager fs-read-text-encoding', () => {
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

  describe('fs.read text encoding', () => {
    const textFileStat = {
      size: 0,
      isFile: () => true,
      isDirectory: () => false,
    } as Stats

    it('keeps default utf8 reads compatible for older clients', async () => {
      mockFiles.set('/tmp/project/utf8.log', Buffer.from('中文字段：行情', 'utf8'))
      vi.spyOn(fs, 'statSync').mockReturnValue({
        ...textFileStat,
        size: mockFiles.get('/tmp/project/utf8.log')!.length,
      })

      await manager.handleReq({
        type: 'req',
        id: 'fs-read-default-utf8',
        method: 'fs.read',
        params: { path: '/tmp/project/utf8.log', rootPath: '/tmp/project/utf8.log' },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-read-default-utf8',
        ok: true,
        payload: {
          content: '中文字段：行情',
          path: '/tmp/project/utf8.log',
          size: mockFiles.get('/tmp/project/utf8.log')!.length,
        },
      })
    })

    it('auto-decodes UTF-8 text without marking fallback', async () => {
      mockFiles.set('/tmp/project/utf8-auto.log', Buffer.from('collector 信息 ok', 'utf8'))
      vi.spyOn(fs, 'statSync').mockReturnValue({
        ...textFileStat,
        size: mockFiles.get('/tmp/project/utf8-auto.log')!.length,
      })

      await manager.handleReq({
        type: 'req',
        id: 'fs-read-auto-utf8',
        method: 'fs.read',
        params: {
          path: '/tmp/project/utf8-auto.log',
          rootPath: '/tmp/project/utf8-auto.log',
          encoding: 'auto',
        },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-read-auto-utf8',
        ok: true,
        payload: {
          content: 'collector 信息 ok',
          path: '/tmp/project/utf8-auto.log',
          size: mockFiles.get('/tmp/project/utf8-auto.log')!.length,
          encoding: 'utf8',
          encodingFallback: false,
        },
      })
    })

    it('auto-decodes GB18030 text from Windows log files', async () => {
      const gb18030 = Buffer.from([
        0x32, 0x30, 0x32, 0x36, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0xd7, 0xd6, 0xb6, 0xce, 0xa3, 0xba,
        0xd0, 0xd0, 0xc7, 0xe9,
      ])
      mockFiles.set('/tmp/project/collector.err.log', gb18030)
      vi.spyOn(fs, 'statSync').mockReturnValue({
        ...textFileStat,
        size: gb18030.length,
      })

      await manager.handleReq({
        type: 'req',
        id: 'fs-read-auto-gb18030',
        method: 'fs.read',
        params: {
          path: '/tmp/project/collector.err.log',
          rootPath: '/tmp/project/collector.err.log',
          encoding: 'auto',
        },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-read-auto-gb18030',
        ok: true,
        payload: {
          content: '2026 中文字段：行情',
          path: '/tmp/project/collector.err.log',
          size: gb18030.length,
          encoding: 'gb18030',
          encodingFallback: true,
        },
      })
    })

    it('auto-decodes GB18030 four-byte characters', async () => {
      const gb18030 = Buffer.from([0x47, 0x42, 0x20, 0x95, 0x32, 0x82, 0x36])
      mockFiles.set('/tmp/project/gb18030-4byte.txt', gb18030)
      vi.spyOn(fs, 'statSync').mockReturnValue({
        ...textFileStat,
        size: gb18030.length,
      })

      await manager.handleReq({
        type: 'req',
        id: 'fs-read-auto-gb18030-4byte',
        method: 'fs.read',
        params: {
          path: '/tmp/project/gb18030-4byte.txt',
          rootPath: '/tmp/project/gb18030-4byte.txt',
          encoding: 'utf8-auto',
        },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-read-auto-gb18030-4byte',
        ok: true,
        payload: {
          content: 'GB 𠀀',
          path: '/tmp/project/gb18030-4byte.txt',
          size: gb18030.length,
          encoding: 'gb18030',
          encodingFallback: true,
        },
      })
    })

    it('rejects obvious binary files in auto text mode', async () => {
      const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
      mockFiles.set('/tmp/project/report.pdf', pdfHeader)
      vi.spyOn(fs, 'statSync').mockReturnValue({
        ...textFileStat,
        size: pdfHeader.length,
      })

      await manager.handleReq({
        type: 'req',
        id: 'fs-read-auto-binary',
        method: 'fs.read',
        params: {
          path: '/tmp/project/report.pdf',
          rootPath: '/tmp/project/report.pdf',
          encoding: 'auto',
        },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'fs-read-auto-binary',
        ok: false,
        error: 'File appears to be binary; use encoding=base64',
      })
    })
  })
})
