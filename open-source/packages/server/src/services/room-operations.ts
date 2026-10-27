// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-operations.test.ts

import { prisma } from '../lib/prisma.js'
import { getRoomAttachmentMaintenanceStatus } from '../jobs/room-attachment-maintenance.js'
import { roomMessageRetentionCutoff } from './room-message-retention.js'
import { getRoomMessageRetentionStatus } from '../jobs/room-message-retention.js'
import { getSecurityAuditCleanupStatus } from '../jobs/security-audit-cleanup.js'

const DAY_MS = 24 * 60 * 60 * 1000

export async function getRoomOperationsSnapshot(now = new Date()) {
  const dayAgo = new Date(now.getTime() - DAY_MS)
  const [
    activeRooms,
    archivedRooms,
    deletedRooms,
    activeHumans,
    activeAgents,
    activeBindings,
    pausedBindings,
    pendingBindings,
    detachedBindings,
    recentMessages,
    latestMessage,
    expiredMessageBacklog,
    securityAuditCount,
    oldestSecurityAudit,
    newestSecurityAudit,
    expiredSecurityAuditBacklog,
    pendingJoinRequests,
    oldJoinRequests,
    orphanCandidates,
    expiredReadyAttachments,
    pendingDeletionJobs,
    retryingDeletionJobs,
    exhaustedDeletionJobs,
  ] = await Promise.all([
    prisma.room.count({ where: { status: 'active', deletedAt: null } }),
    prisma.room.count({ where: { status: 'archived', deletedAt: null } }),
    prisma.room.count({ where: { deletedAt: { not: null } } }),
    prisma.roomMembership.count({ where: { status: 'active', principalType: 'human' } }),
    prisma.roomMembership.count({ where: { status: 'active', principalType: 'agent' } }),
    prisma.roomBinding.count({ where: { status: 'active' } }),
    prisma.roomBinding.count({ where: { status: 'paused' } }),
    prisma.roomBinding.count({ where: { status: 'pending_approval' } }),
    prisma.roomBinding.count({ where: { status: 'detached' } }),
    prisma.roomMessage.count({ where: { createdAt: { gte: dayAgo }, deletedAt: null } }),
    prisma.roomMessage.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.roomMessage.count({
      where: { createdAt: { lt: roomMessageRetentionCutoff(now) }, deletedAt: null },
    }),
    prisma.securityAuditEvent.count(),
    prisma.securityAuditEvent.findFirst({
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    }),
    prisma.securityAuditEvent.findFirst({
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    }),
    prisma.securityAuditEvent.count({ where: { expiresAt: { lte: now } } }),
    prisma.roomJoinRequest.count({ where: { status: 'pending' } }),
    prisma.roomJoinRequest.count({ where: { status: 'pending', createdAt: { lte: dayAgo } } }),
    prisma.roomAttachment.count({
      where: {
        messageId: null,
        status: { in: ['pending', 'uploaded', 'ready', 'rejected'] },
        createdAt: { lte: dayAgo },
      },
    }),
    prisma.roomAttachment.count({ where: { status: 'ready', expiresAt: { lte: now } } }),
    prisma.roomAttachmentDeletionJob.count({ where: { status: 'pending' } }),
    prisma.roomAttachmentDeletionJob.count({ where: { status: 'failed', attempts: { lt: 10 } } }),
    prisma.roomAttachmentDeletionJob.count({ where: { status: 'failed', attempts: { gte: 10 } } }),
  ])

  const maintenance = getRoomAttachmentMaintenanceStatus()
  const messageRetention = getRoomMessageRetentionStatus()
  const securityAuditCleanup = getSecurityAuditCleanupStatus()
  const alerts = [
    ...(oldJoinRequests > 0 ? ['old_pending_join_requests'] : []),
    ...(orphanCandidates > 0 ? ['orphan_attachment_candidates'] : []),
    ...(expiredReadyAttachments > 0 ? ['expired_attachments_waiting_tombstone'] : []),
    ...(expiredMessageBacklog > 0 ? ['expired_messages_waiting_tombstone'] : []),
    ...(expiredSecurityAuditBacklog > 0 ? ['expired_security_audit_waiting_delete'] : []),
    ...(retryingDeletionJobs > 0 ? ['attachment_deletions_retrying'] : []),
    ...(exhaustedDeletionJobs > 0 ? ['attachment_deletions_exhausted'] : []),
    ...(maintenance.state === 'failed' ? ['attachment_maintenance_failed'] : []),
    ...(messageRetention.state === 'failed' ? ['message_retention_failed'] : []),
    ...(securityAuditCleanup.state === 'failed' ? ['security_audit_cleanup_failed'] : []),
  ]

  return {
    status: alerts.length === 0 ? ('ok' as const) : ('attention' as const),
    generatedAt: now.toISOString(),
    rooms: { active: activeRooms, archived: archivedRooms, deleted: deletedRooms },
    participants: { activeHumans, activeAgents },
    bindings: {
      active: activeBindings,
      paused: pausedBindings,
      pendingApproval: pendingBindings,
      detached: detachedBindings,
    },
    messages: {
      last24Hours: recentMessages,
      latestAt: latestMessage?.createdAt.toISOString() ?? null,
      expiredBacklog: expiredMessageBacklog,
    },
    securityAudit: {
      count: securityAuditCount,
      oldestAt: oldestSecurityAudit?.occurredAt.toISOString() ?? null,
      newestAt: newestSecurityAudit?.occurredAt.toISOString() ?? null,
      expiredBacklog: expiredSecurityAuditBacklog,
    },
    joinRequests: { pending: pendingJoinRequests, olderThan24Hours: oldJoinRequests },
    attachments: {
      orphanCandidates,
      expiredReady: expiredReadyAttachments,
      deletionPending: pendingDeletionJobs,
      deletionRetrying: retryingDeletionJobs,
      deletionExhausted: exhaustedDeletionJobs,
    },
    maintenance,
    messageRetention,
    securityAuditCleanup,
    alerts,
  }
}
