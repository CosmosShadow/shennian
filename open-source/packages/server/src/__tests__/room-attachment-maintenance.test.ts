// @covers open-source/packages/server/src/jobs/room-attachment-maintenance.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tombstone, reclaim, deletion } = vi.hoisted(() => ({
  tombstone: vi.fn(),
  reclaim: vi.fn(),
  deletion: vi.fn(),
}))

vi.mock('../services/room-attachments.js', () => ({
  tombstoneExpiredRoomAttachments: tombstone,
  reclaimOrphanRoomAttachments: reclaim,
  processRoomAttachmentDeletionJobs: deletion,
}))
vi.mock('../services/agent-direct-attachments.js', () => ({
  cleanupDirectAttachments: vi.fn(async () => 0),
}))

import {
  getRoomAttachmentMaintenanceStatus,
  runRoomAttachmentMaintenance,
} from '../jobs/room-attachment-maintenance.js'

describe('Room attachment maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tombstone.mockResolvedValue(2)
    reclaim.mockResolvedValue(1)
    deletion.mockResolvedValue({ processed: 3, failed: 0 })
  })

  it('tombstones expiry, reclaims orphan uploads, then processes durable deletion jobs', async () => {
    await expect(runRoomAttachmentMaintenance()).resolves.toMatchObject({
      expiredTombstoned: 2,
      orphansReclaimed: 1,
      deletionJobsProcessed: 3,
      deletionJobsFailed: 0,
    })

    expect(tombstone).toHaveBeenCalledOnce()
    expect(reclaim).toHaveBeenCalledOnce()
    expect(deletion).toHaveBeenCalledOnce()
    expect(tombstone.mock.invocationCallOrder[0]).toBeLessThan(reclaim.mock.invocationCallOrder[0]!)
    expect(reclaim.mock.invocationCallOrder[0]).toBeLessThan(deletion.mock.invocationCallOrder[0]!)
    expect(getRoomAttachmentMaintenanceStatus()).toMatchObject({ state: 'ok' })
  })

  it('coalesces concurrent runs and exposes a privacy-safe failure status', async () => {
    let release: (() => void) | undefined
    tombstone.mockImplementation(() => new Promise<number>((resolve) => {
      release = () => resolve(2)
    }))

    const first = runRoomAttachmentMaintenance()
    const second = runRoomAttachmentMaintenance()
    expect(second).toBe(first)
    expect(getRoomAttachmentMaintenanceStatus()).toMatchObject({ state: 'running' })
    release?.()
    await first
    expect(tombstone).toHaveBeenCalledOnce()

    tombstone.mockResolvedValue(2)
    reclaim.mockRejectedValueOnce(new TypeError('private object key must not be exposed'))
    await expect(runRoomAttachmentMaintenance()).rejects.toThrow(TypeError)
    expect(getRoomAttachmentMaintenanceStatus()).toMatchObject({
      state: 'failed',
      errorCode: 'TypeError',
    })
    expect(JSON.stringify(getRoomAttachmentMaintenanceStatus())).not.toContain('private object key')
  })
})
