// @covers src/services/security-audit.ts
// @covers src/jobs/security-audit-cleanup.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreate, mockExecuteRaw } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExecuteRaw: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    securityAuditEvent: { create: mockCreate },
    $executeRaw: mockExecuteRaw,
  },
}))

import {
  addCalendarMonths,
  auditEventType,
  isAuditedPath,
  writeSecurityAudit,
} from '../services/security-audit.js'
import { cleanupExpiredSecurityAuditEvents } from '../jobs/security-audit-cleanup.js'

describe('security audit retention', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses six calendar months rather than a fixed number of days', () => {
    expect(addCalendarMonths(new Date('2026-02-28T12:00:00.000Z'), 6).toISOString()).toBe(
      '2026-08-28T12:00:00.000Z',
    )
    expect(addCalendarMonths(new Date('2026-08-31T12:00:00.000Z'), -6).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    )
  })

  it('normalizes identifiers and never accepts arbitrary event names', async () => {
    mockCreate.mockResolvedValue({})
    expect(auditEventType('DELETE', '/auth/devices/:id')).toBe('http.delete.auth.devices.:id')
    expect(isAuditedPath('/rooms/room_123/messages')).toBe(true)
    expect(isAuditedPath('/health')).toBe(false)

    await writeSecurityAudit({
      occurredAt: new Date('2026-09-07T00:00:00.000Z'),
      eventType: 'account.deleted',
      result: 'success',
      actorUserId: 'user-1',
      method: 'DELETE',
      path: '/auth/account',
      reasonCode: null,
    })
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expiresAt: new Date('2027-03-07T00:00:00.000Z'),
        eventType: 'account.deleted',
        path: '/auth/account',
      }),
    })
    expect(Object.keys(mockCreate.mock.calls[0][0].data)).not.toEqual(
      expect.arrayContaining(['payload', 'body', 'text', 'token', 'prompt']),
    )

    await writeSecurityAudit({ eventType: 'contains spaces', result: 'failed' })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('drops free text and credential-shaped values at the write boundary', async () => {
    mockCreate.mockResolvedValue({})

    await writeSecurityAudit({
      eventType: 'http.post.auth.verify-code',
      result: 'denied',
      actorUserId: 'phone 15200000000',
      sourceIp: 'Bearer secret-token',
      method: 'POST with payload',
      path: '/auth/verify-code?code=123456',
      traceId: 'not a trace id',
      reasonCode: '验证码 123456',
    })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: null,
        sourceIp: null,
        method: null,
        path: null,
        traceId: null,
        reasonCode: null,
      }),
    })
  })

  it('deletes expired audit rows in bounded batches', async () => {
    mockExecuteRaw.mockResolvedValueOnce(10_000).mockResolvedValueOnce(3)
    await expect(cleanupExpiredSecurityAuditEvents(new Date('2026-09-07T00:00:00Z'))).resolves.toBe(
      10_003,
    )
  })
})
