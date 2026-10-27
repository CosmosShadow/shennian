// @covers open-source/packages/server/src/services/request-log-credential-cleanup.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    requestLog: { findMany: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import { cleanupRequestLogCredentials } from '../services/request-log-credential-cleanup.js'

const credential = 'machine-canary-123456789'

describe('historical RequestLog credential cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.requestLog.findMany
      .mockResolvedValueOnce([{
        id: 1n,
        path: `/relay/machine?token=${credential}`,
        payload: { nested: { machineToken: credential } },
        metadata: { status: 'failed' },
        errorMessage: `Bearer ${credential}`,
        errorStack: null,
      }, {
        id: 2n,
        path: '/health',
        payload: null,
        metadata: { status: 'ok' },
        errorMessage: null,
        errorStack: null,
      }])
      .mockResolvedValueOnce([])
    mockPrisma.requestLog.update.mockResolvedValue({})
  })

  it('returns counts only during the read-only audit', async () => {
    const report = await cleanupRequestLogCredentials({ batchSize: 10 })

    expect(report).toEqual({
      mode: 'audit',
      scanned: 2,
      matchedRecords: 1,
      matchedFields: { path: 1, payload: 1, metadata: 0, errorMessage: 1, errorStack: 0 },
      cleanedRecords: 0,
    })
    expect(JSON.stringify(report)).not.toContain(credential)
    expect(mockPrisma.requestLog.update).not.toHaveBeenCalled()
  })

  it('overwrites only matched log fields with sanitized values', async () => {
    await cleanupRequestLogCredentials({ apply: true, batchSize: 10 })

    expect(mockPrisma.requestLog.update).toHaveBeenCalledOnce()
    const update = mockPrisma.requestLog.update.mock.calls[0][0]
    expect(update.where).toEqual({ id: 1n })
    expect(JSON.stringify(update, (_key, value) => typeof value === 'bigint' ? value.toString() : value))
      .not.toContain(credential)
    expect(update.data.path).toBe('/relay/machine')
  })
})
