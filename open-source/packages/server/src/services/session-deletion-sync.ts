// @arch open-source/docs/server-runtime.md
// @test src/__tests__/session-deletion-sync.test.ts

import {
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_DATA_EPOCH,
  isAvailableAgentType,
  type SessionDeletionsAckParams,
  type SessionDeletionsAckResponse,
  type SessionDeletionsSyncParams,
  type SessionDeletionsSyncResponse,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { rejectSessionSync } from './session-sync-rejection.js'

function validateInstallationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 191) {
    throw new Error('invalid daemonInstallationId')
  }
}

function validateRevision(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`invalid ${name}`)
}

async function requireInstallation(input: {
  machineId: string
  ownerId: string
  daemonInstallationId: string
}) {
  const machine = await prisma.machine.findFirst({
    where: {
      id: input.machineId,
      userId: input.ownerId,
      daemonInstallationId: input.daemonInstallationId,
      paired: true,
    },
    select: { id: true, deletionRevision: true, sessionSyncDataEpoch: true },
  })
  if (!machine) rejectSessionSync('ownership_transferred', {
    authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
  })
  return machine
}

export async function syncSessionDeletions(input: {
  machineId: string
  ownerId: string
  params: SessionDeletionsSyncParams
}): Promise<SessionDeletionsSyncResponse> {
  if (input.params.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION) {
    rejectSessionSync('upgrade_required', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
  }
  if (input.params.dataEpoch !== SESSION_SYNC_DATA_EPOCH) rejectSessionSync('epoch_mismatch', {
    authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
  })
  validateInstallationId(input.params.daemonInstallationId)
  validateRevision(input.params.afterRevision, 'afterRevision')
  const machine = await requireInstallation({ ...input, daemonInstallationId: input.params.daemonInstallationId })
  if (input.params.afterRevision > machine.deletionRevision) {
    throw new Error('future_deletion_revision')
  }
  const rows = await prisma.sessionDeletion.findMany({
    where: {
      machineId: input.machineId,
      daemonInstallationId: input.params.daemonInstallationId,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      // Pin this page to the Machine revision captured above. A concurrent
      // deletion may commit after requireInstallation(); without the upper
      // bound, rows can extend past latestRevision and produce a response the
      // daemon must reject as a revision gap.
      deletionRevision: {
        gt: input.params.afterRevision,
        lte: machine.deletionRevision,
      },
    },
    orderBy: { deletionRevision: 'asc' },
    select: {
      sessionId: true,
      deletionRevision: true,
      deletedAt: true,
      nativeCleanupPolicy: true,
      workDir: true,
    },
  })
  const baselineRevision = rows[0]?.deletionRevision
    ? rows[0].deletionRevision - 1
    : machine.deletionRevision
  if (rows.length === 0) {
    return {
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: input.params.daemonInstallationId,
      baselineRevision, latestRevision: machine.deletionRevision, deletions: [],
    }
  }
  const sources = await prisma.nativeSourceDeletion.findMany({
    where: {
      machineId: input.machineId,
      daemonInstallationId: input.params.daemonInstallationId,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      deletionRevision: { in: rows.map((row) => row.deletionRevision) },
    },
    select: {
      sessionId: true,
      deletionRevision: true,
      agentType: true,
      sourceSessionKey: true,
    },
  })
  return {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: input.params.daemonInstallationId,
    baselineRevision,
    latestRevision: machine.deletionRevision,
    deletions: rows.map((row) => ({
      sessionId: row.sessionId,
      deletionRevision: row.deletionRevision,
      deletedAt: row.deletedAt.toISOString(),
      ...(row.workDir ? { workDir: row.workDir } : {}),
      nativeCleanupPolicy: row.nativeCleanupPolicy === 'auto' ? 'auto' : 'none',
      sources: sources
        .filter((source) => source.sessionId === row.sessionId
          && source.deletionRevision === row.deletionRevision)
        .flatMap((source) => isAvailableAgentType(source.agentType)
          ? [{ agentType: source.agentType, sourceSessionKey: source.sourceSessionKey }]
          : []),
    })),
  }
}

export async function acknowledgeSessionDeletions(input: {
  machineId: string
  ownerId: string
  params: SessionDeletionsAckParams
}): Promise<SessionDeletionsAckResponse> {
  if (input.params.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION) rejectSessionSync('upgrade_required', {
    authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
  })
  if (input.params.dataEpoch !== SESSION_SYNC_DATA_EPOCH) rejectSessionSync('epoch_mismatch', {
    authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
  })
  validateInstallationId(input.params.daemonInstallationId)
  validateRevision(input.params.deletionRevision, 'deletionRevision')
  const machine = await requireInstallation({ ...input, daemonInstallationId: input.params.daemonInstallationId })
  if (input.params.deletionRevision > machine.deletionRevision) throw new Error('future_deletion_revision')
  const acknowledgedAt = new Date()
  await prisma.$transaction([
    prisma.sessionDeletion.updateMany({
      where: {
        machineId: input.machineId,
        daemonInstallationId: input.params.daemonInstallationId,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        deletionRevision: { lte: input.params.deletionRevision },
        daemonAckedAt: null,
      },
      data: { daemonAckedAt: acknowledgedAt },
    }),
    prisma.nativeSourceDeletion.updateMany({
      where: {
        machineId: input.machineId,
        daemonInstallationId: input.params.daemonInstallationId,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        deletionRevision: { lte: input.params.deletionRevision },
        acknowledgedAt: null,
      },
      data: { acknowledgedAt },
    }),
  ])
  return {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: input.params.daemonInstallationId,
    deletionRevision: input.params.deletionRevision,
    acknowledged: true,
  }
}
