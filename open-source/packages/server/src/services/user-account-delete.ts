import { clearInteractiveAccountData } from './interactive-web/account-data.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/user-account-delete.test.ts

import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { publishUserLogout } from '../relay/connection-control.js'
import { cleanupUserAvatarObjects } from './user-avatar.js'
import { cleanupAgentAvatarObjects } from './agent-avatar.js'
import { Prisma } from '../generated/prisma/client.js'

const DELETED_ACCOUNT_USER_ID = 'system-deleted-account'
const DELETION_OPERATION = /^[A-Za-z0-9_-]{32,128}$/
const DELETION_RECEIPT_MS = 24 * 60 * 60 * 1000

function deletionOperationHash(operationId: string): string {
  if (!DELETION_OPERATION.test(operationId)) throw new Error('invalid_account_deletion_operation')
  return crypto.createHash('sha256').update(operationId, 'utf8').digest('hex')
}

export async function isAccountDeletionComplete(operationId: string): Promise<boolean> {
  let operationHash: string
  try {
    operationHash = deletionOperationHash(operationId)
  } catch {
    return false
  }
  const operation = await prisma.accountDeletionOperation.findFirst({
    where: { operationHash, status: 'completed', expiresAt: { gt: new Date() } },
    select: { operationHash: true },
  })
  return operation != null
}

/**
 * Permanently delete the user and owned data (sessions, machines, devices).
 * Grantee-only users lose their sessions and grant rows; machines they do not own are untouched.
 */
export async function deleteUserAccount(userId: string, operationId: string): Promise<void> {
  if (userId === DELETED_ACCOUNT_USER_ID) return
  const operationHash = deletionOperationHash(operationId)
  const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!existingUser) return
  const ownedMachines = await prisma.machine.findMany({
    where: { userId },
    select: { id: true },
  })
  const ownedIds = ownedMachines.map((m) => m.id)

  const sessionWhere =
    ownedIds.length > 0 ? { OR: [{ userId }, { machineId: { in: ownedIds } }] } : { userId }

  const sessions = await prisma.nianSession.findMany({
    where: sessionWhere,
    select: { id: true },
  })
  const sessionIds = sessions.map((s) => s.id)
  const ownedAgents = await prisma.agentIdentity.findMany({
    where: { ownerType: 'user', ownerUserId: userId },
    select: { id: true },
  })
  const ownedAgentIds = ownedAgents.map((agent) => agent.id)

  await prisma.$transaction(async (tx) => {
    const now = new Date()
    const workRooms = await tx.room.findMany({ where: {
      conversationKind: 'work',
      OR: [{ ownerUserId: userId }, { createdByUserId: userId }],
    }, select: { id: true } })
    await tx.user.upsert({
      where: { id: DELETED_ACCOUNT_USER_ID },
      create: { id: DELETED_ACCOUNT_USER_ID, name: '已注销用户' },
      update: {},
    })

    await clearInteractiveAccountData(tx, userId, DELETED_ACCOUNT_USER_ID)

    await tx.room.updateMany({
      where: { OR: [{ ownerUserId: userId }, { createdByUserId: userId }] },
      data: {
        ownerUserId: DELETED_ACCOUNT_USER_ID,
        createdByUserId: DELETED_ACCOUNT_USER_ID,
        status: 'archived',
        joinPolicy: 'closed',
        archivedAt: now,
        inviteVersion: { increment: 1 },
      },
    })
    await tx.roomMessage.updateMany({
      where: { ownerUserIdSnapshot: userId },
      data: {
        authorDisplayNameSnapshot: '已注销用户',
        ownerDisplayNameSnapshot: null,
        authorAvatarSnapshot: Prisma.JsonNull,
        mentionSnapshots: Prisma.JsonNull,
      },
    })
    await tx.roomMembership.updateMany({
      where: { OR: [{ userId }, { ownerUserId: userId }] },
      data: {
        ownerUserId: DELETED_ACCOUNT_USER_ID,
        displayAlias: '已注销用户',
        status: 'removed',
        removedAt: now,
      },
    })
    await tx.roomBrowserApproval.updateMany({
      where: { approvedUserId: userId },
      data: { approvedUserId: null, approvedMembershipId: null, status: 'expired' },
    })
    const logOr: Array<{
      userId?: string
      sessionId?: { in: string[] }
      machineId?: { in: string[] }
    }> = [{ userId }]
    if (sessionIds.length > 0) {
      logOr.push({ sessionId: { in: sessionIds } })
    }
    if (ownedIds.length > 0) {
      logOr.push({ machineId: { in: ownedIds } })
    }
    await tx.requestLog.deleteMany({ where: { OR: logOr } })

    await tx.sessionUserState.deleteMany({ where: { userId } })
    // Direct conversations belong to both participants. Delete either side's
    // conversations before the User/AgentPublication foreign keys are removed;
    // message and private binding rows cascade from each conversation.
    await tx.agentPublicationBrowserSession.deleteMany({ where: { userId } })
    const directRooms = await tx.agentDirectConversation.findMany({
      where: { OR: [{ ownerUserId: userId }, { visitorUserId: userId }],
        roomId: { not: null } },
      select: { roomId: true },
    })
    await tx.agentDirectConversation.deleteMany({
      where: { OR: [{ ownerUserId: userId }, { visitorUserId: userId }] },
    })
    const directRoomIds = directRooms.flatMap(({ roomId }) => roomId ? [roomId] : [])
    if (directRoomIds.length > 0) {
      await tx.roomMessage.deleteMany({ where: { roomId: { in: directRoomIds } } })
      await tx.room.deleteMany({ where: { id: { in: directRoomIds },
        conversationKind: 'published_ai' } })
    }
    if (workRooms.length > 0) {
      const workRoomIds = workRooms.map((room) => room.id)
      await tx.roomMessage.deleteMany({ where: { roomId: { in: workRoomIds } } })
      await tx.room.deleteMany({ where: { id: { in: workRoomIds },
        conversationKind: 'work' } })
    }
    await tx.agentPublication.deleteMany({ where: { ownerUserId: userId } })
    if (sessionIds.length > 0) {
      await tx.nianSession.deleteMany({ where: { id: { in: sessionIds } } })
    }

    const grantOr: Array<{ machineId?: { in: string[] }; granterId?: string; granteeId?: string }> =
      [{ granterId: userId }, { granteeId: userId }]
    if (ownedIds.length > 0) {
      grantOr.push({ machineId: { in: ownedIds } })
    }
    await tx.machineGrant.deleteMany({ where: { OR: grantOr } })

    await tx.machine.deleteMany({ where: { userId } })
    await tx.devicePushRegistration.deleteMany({ where: { userId } })
    await tx.device.deleteMany({ where: { userId } })
    await tx.qrSession.deleteMany({ where: { userId } })
    await tx.accountDeletionOperation.upsert({
      where: { operationHash },
      create: {
        operationHash,
        status: 'completed',
        completedAt: now,
        expiresAt: new Date(now.getTime() + DELETION_RECEIPT_MS),
      },
      update: {
        status: 'completed',
        completedAt: now,
        expiresAt: new Date(now.getTime() + DELETION_RECEIPT_MS),
      },
    })
    await tx.user.deleteMany({ where: { id: userId } })
  })

  publishUserLogout(userId)

  // The database deletion is authoritative; object cleanup is best-effort and can be retried by orphan maintenance.
  await cleanupUserAvatarObjects(userId).catch(() => {})
  await cleanupAgentAvatarObjects(ownedAgentIds).catch(() => {})
}
