// @covers src/services/room-operations.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, maintenanceStatus } = vi.hoisted(() => ({
  mockPrisma: {
    room: { count: vi.fn() },
    roomMembership: { count: vi.fn() },
    roomBinding: { count: vi.fn() },
    roomMessage: { count: vi.fn(), findFirst: vi.fn() },
    securityAuditEvent: { count: vi.fn(), findFirst: vi.fn() },
    roomJoinRequest: { count: vi.fn() },
    roomAttachment: { count: vi.fn() },
    roomAttachmentDeletionJob: { count: vi.fn() },
  },
  maintenanceStatus: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../jobs/room-attachment-maintenance.js', () => ({
  getRoomAttachmentMaintenanceStatus: maintenanceStatus,
}))

import { getRoomOperationsSnapshot } from '../services/room-operations.js'

describe('Room operations snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.room.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    mockPrisma.roomMembership.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3)
    mockPrisma.roomBinding.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(4)
    mockPrisma.roomMessage.count.mockResolvedValueOnce(12).mockResolvedValueOnce(0)
    mockPrisma.roomMessage.findFirst.mockResolvedValue({
      createdAt: new Date('2026-08-24T01:00:00.000Z'),
    })
    mockPrisma.securityAuditEvent.count.mockResolvedValueOnce(24).mockResolvedValueOnce(0)
    mockPrisma.securityAuditEvent.findFirst
      .mockResolvedValueOnce({ occurredAt: new Date('2026-08-01T00:00:00.000Z') })
      .mockResolvedValueOnce({ occurredAt: new Date('2026-08-24T01:30:00.000Z') })
    mockPrisma.roomJoinRequest.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    mockPrisma.roomAttachment.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    mockPrisma.roomAttachmentDeletionJob.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
    maintenanceStatus.mockReturnValue({ state: 'failed', errorCode: 'Error' })
  })

  it('returns aggregate health and alert codes without Room or user identifiers', async () => {
    const result = await getRoomOperationsSnapshot(new Date('2026-08-24T02:00:00.000Z'))

    expect(result).toMatchObject({
      status: 'attention',
      generatedAt: '2026-08-24T02:00:00.000Z',
      rooms: { active: 4, archived: 1, deleted: 2 },
      participants: { activeHumans: 5, activeAgents: 3 },
      bindings: { active: 2, paused: 1, pendingApproval: 1, detached: 4 },
      messages: { last24Hours: 12, latestAt: '2026-08-24T01:00:00.000Z' },
      securityAudit: { count: 24, expiredBacklog: 0 },
      attachments: { deletionExhausted: 1 },
    })
    expect(result.alerts).toEqual(
      expect.arrayContaining([
        'old_pending_join_requests',
        'orphan_attachment_candidates',
        'expired_attachments_waiting_tombstone',
        'attachment_deletions_retrying',
        'attachment_deletions_exhausted',
        'attachment_maintenance_failed',
      ]),
    )
    expect(JSON.stringify(result)).not.toMatch(/roomId|userId|phone|messageText|objectKey/i)
  })
})
