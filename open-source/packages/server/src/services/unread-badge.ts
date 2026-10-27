// @arch open-source/docs/server-runtime.md
// @test src/__tests__/task-completion-push.test.ts
// @test src/__tests__/unread-badge.test.ts

import {
  SESSION_SYNC_DATA_EPOCH,
  extractPayloadText,
  isInternalSession,
  isToolPayload,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { getAccessibleMachineMap } from './session-visible-machines.js'

const MAX_PREVIEW_LENGTH = 100

function stripMarkdownForNotification(text: string): string {
  return text
    .replace(/```(?:[\w-]+\n)?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<\/?[^>]+>/g, '')
}

export function buildVisibleMessagePreview(payload: string): string {
  if (!payload || isToolPayload(payload)) return ''
  const text = stripMarkdownForNotification(extractPayloadText(payload))
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}…` : text
}

export async function countUnreadVisibleMessages(userId: string): Promise<number> {
  const machineMap = await getAccessibleMachineMap(userId)
  const [sessions, roomMemberships] = await Promise.all([
    prisma.nianSession.findMany({
      where: {
        userId,
        deletedAt: null,
        machineId: { in: [...machineMap.keys()] },
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
      },
      select: {
        id: true,
        userId: true,
        agentIdentityId: true,
        agentType: true,
        sessionMode: true,
        nativeSessionVisibility: true,
        agentSessionId: true,
        bodyRevision: true,
        visibleMessageCount: true,
        lastVisibleMessageId: true,
        attentionCount: true,
        lastAttentionId: true,
        roomBinding: { select: { status: true } },
        userStates: {
          where: { userId },
          take: 1,
          select: {
            lastReadAt: true,
            lastReadBodyRevision: true,
            lastReadVisibleMessageCount: true,
            lastReadVisibleMessageId: true,
            lastReadAttentionCount: true,
            lastReadAttentionId: true,
            manualUnread: true,
          },
        },
      },
    }),
    prisma.roomMembership.findMany({
      where: { userId, principalType: 'human', status: 'active' },
      select: {
        readState: { select: { lastReadSequence: true } },
        room: { select: { nextSequence: true } },
      },
    }),
  ])

  let total = roomMemberships.reduce((sum, membership) => {
    const lastReadSequence = membership.readState?.lastReadSequence ?? 0n
    const unread = membership.room.nextSequence - lastReadSequence
    return sum + (unread > 0n ? 1 : 0)
  }, 0)

  const managerAgentSessionIds = new Set(
    sessions
      .filter((session) =>
        isInternalSession(session) && session.agentSessionId,
      )
      .map((session) => session.agentSessionId as string),
  )
  for (const session of sessions) {
    if (isInternalSession(session)) continue
    // Room-bound Agent replies are mirrored into the Room message stream. The
    // membership sequence already counts them, so their internal Session must
    // never contribute a second badge unit.
    if (session.roomBinding?.status === 'active' || session.roomBinding?.status === 'paused') {
      continue
    }
    if (
      session.agentType !== 'manager' &&
      session.sessionMode !== 'manager' &&
      session.agentSessionId &&
      managerAgentSessionIds.has(session.agentSessionId)
    )
      continue
    if (session.agentIdentityId) continue
    const userState = session.userStates[0]
    if (!userState) continue

    const unreadAttentionCount = Math.max(
      0,
      session.attentionCount - userState.lastReadAttentionCount,
    )
    const replacedAttentionTail =
      session.attentionCount > 0 &&
      session.lastAttentionId !== userState.lastReadAttentionId

    if (unreadAttentionCount === 0 && !replacedAttentionTail && userState.manualUnread) {
      total += 1
      continue
    }
    total += unreadAttentionCount > 0 ? unreadAttentionCount : replacedAttentionTail ? 1 : 0
  }

  return total
}
