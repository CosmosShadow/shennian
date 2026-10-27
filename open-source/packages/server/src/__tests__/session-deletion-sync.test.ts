// @covers open-source/packages/server/src/services/session-deletion-sync.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION } from '@shennian/wire'

const { database } = vi.hoisted(() => ({
  database: {
    machine: { findFirst: vi.fn() },
    sessionDeletion: { findMany: vi.fn(), updateMany: vi.fn() },
    nativeSourceDeletion: { findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: database }))

import {
  acknowledgeSessionDeletions,
  syncSessionDeletions,
} from '../services/session-deletion-sync.js'

const installation = 'daemon-installation-1'

describe('session deletion daemon catch-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    database.machine.findFirst.mockResolvedValue({
      id: 'machine-1', deletionRevision: 2, sessionSyncDataEpoch: SESSION_SYNC_DATA_EPOCH,
    })
    database.sessionDeletion.updateMany.mockResolvedValue({ count: 2 })
    database.nativeSourceDeletion.updateMany.mockResolvedValue({ count: 2 })
  })

  it('returns ordered metadata-only commands for the authenticated installation', async () => {
    database.sessionDeletion.findMany.mockResolvedValue([
      {
        sessionId: 's1', deletionRevision: 1,
        deletedAt: new Date('2026-09-02T01:00:00Z'), nativeCleanupPolicy: 'auto',
        workDir: '/code/project-one',
      },
      {
        sessionId: 's2', deletionRevision: 2,
        deletedAt: new Date('2026-09-02T02:00:00Z'), nativeCleanupPolicy: 'none',
      },
    ])
    database.nativeSourceDeletion.findMany.mockResolvedValue([
      { sessionId: 's1', deletionRevision: 1, agentType: 'gemini', sourceSessionKey: 'thread-1' },
      { sessionId: 's2', deletionRevision: 2, agentType: 'cursor', sourceSessionKey: 'thread-2' },
    ])

    await expect(syncSessionDeletions({
      machineId: 'machine-1',
      ownerId: 'user-1',
      params: {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId: installation,
        afterRevision: 0,
      },
    })).resolves.toEqual({
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: installation,
      baselineRevision: 0,
      latestRevision: 2,
      deletions: [
        expect.objectContaining({
        sessionId: 's1', deletionRevision: 1,
          nativeCleanupPolicy: 'auto',
          workDir: '/code/project-one',
          sources: [],
        }),
        expect.objectContaining({
          sessionId: 's2', deletionRevision: 2,
          sources: [{ agentType: 'cursor', sourceSessionKey: 'thread-2' }],
        }),
      ],
    })
    expect(database.sessionDeletion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        daemonInstallationId: installation, machineId: 'machine-1', dataEpoch: SESSION_SYNC_DATA_EPOCH,
        deletionRevision: { gt: 0, lte: 2 },
      }),
    }))
  })

  it('returns an explicit baseline when older tombstone commands were pruned', async () => {
    database.machine.findFirst.mockResolvedValue({ id: 'machine-1', deletionRevision: 130 })
    database.sessionDeletion.findMany.mockResolvedValue([])

    await expect(syncSessionDeletions({
      machineId: 'machine-1', ownerId: 'user-1',
      params: {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId: installation, afterRevision: 0,
      },
    })).resolves.toEqual({
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: installation, baselineRevision: 130, latestRevision: 130, deletions: [],
    })
  })

  it('durably acknowledges all applied revisions without deleting tombstones', async () => {
    await expect(acknowledgeSessionDeletions({
      machineId: 'machine-1',
      ownerId: 'user-1',
      params: {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId: installation,
        deletionRevision: 2,
      },
    })).resolves.toEqual({
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: installation, deletionRevision: 2, acknowledged: true,
    })
    expect(database.sessionDeletion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deletionRevision: { lte: 2 }, daemonAckedAt: null }),
      data: { daemonAckedAt: expect.any(Date) },
    }))
    expect(database.nativeSourceDeletion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deletionRevision: { lte: 2 }, acknowledgedAt: null }),
      data: { acknowledgedAt: expect.any(Date) },
    }))
  })

  it('rejects a mismatched installation and a future revision', async () => {
    database.machine.findFirst.mockResolvedValueOnce(null)
    await expect(syncSessionDeletions({
      machineId: 'machine-1', ownerId: 'user-1',
      params: {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId: 'other', afterRevision: 0,
      },
    })).rejects.toThrow('ownership_transferred')

    database.machine.findFirst.mockResolvedValueOnce({ id: 'machine-1', deletionRevision: 2 })
    await expect(acknowledgeSessionDeletions({
      machineId: 'machine-1', ownerId: 'user-1',
      params: {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId: installation, deletionRevision: 3,
      },
    })).rejects.toThrow('future_deletion_revision')
  })
})
