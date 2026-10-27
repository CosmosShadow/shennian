// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-message-push.test.ts

import { randomBytes } from 'crypto'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { writeLog } from './log.js'
import { sendPushNotification } from './push.js'
import { buildVisibleMessagePreview, countUnreadVisibleMessages } from './unread-badge.js'

const ROOM_MESSAGE_PUSH_PREFIX = 'push:room-message:'
const AGENT_SAFETY_PAUSE_PUSH_PREFIX = 'push:agent-safety-pause:'
const ROOM_MESSAGE_PUSH_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_PUSH_DELAY_MS = 1500

export function roomMessageMentionsRecipient(
  mentionSnapshots: unknown,
  humanMembershipId: string,
  managedAgentMembershipIds: readonly string[],
): boolean {
  if (!Array.isArray(mentionSnapshots)) return false
  const recipientMembershipIds = new Set([humanMembershipId, ...managedAgentMembershipIds])
  return mentionSnapshots.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const membershipId = (value as { membershipId?: unknown }).membershipId
    return typeof membershipId === 'string' && recipientMembershipIds.has(membershipId)
  })
}

async function reserveRoomMessagePush(messageId: string): Promise<boolean> {
  try {
    const result = await redis.set(
      `${ROOM_MESSAGE_PUSH_PREFIX}${messageId}`,
      '1',
      'EX',
      ROOM_MESSAGE_PUSH_TTL_SECONDS,
      'NX',
    )
    return result === 'OK'
  } catch {
    // Redis must not turn a successfully stored Room message into a silent one.
    return true
  }
}

/** A self-pause is authored by the Owner's Agent, so normal Room pushes exclude
 * the Owner. Notify that Owner separately, without copying the untrusted reason
 * or Room content into a lock-screen notification. */
export async function scheduleAgentSafetyPausePush(input: {
  roomId: string
  messageId: string
  ownerUserId: string
}): Promise<void> {
  try {
    const reserved = await redis.set(
      `${AGENT_SAFETY_PAUSE_PUSH_PREFIX}${input.messageId}`,
      '1', 'EX', ROOM_MESSAGE_PUSH_TTL_SECONDS, 'NX',
    )
    if (reserved !== 'OK') return
  } catch {
    // Push is best-effort; a Redis outage must not affect the committed pause.
  }
  try {
    await sendPushNotification(
      input.ownerUserId,
      '智能体已暂停工作',
      '你的智能体在群聊中暂停工作。点击查看原因并决定是否恢复。',
      {
        roomId: input.roomId,
        messageId: input.messageId,
        kind: 'agent_safety_pause',
      },
      { audience: 'mobile' },
    )
  } catch (error) {
    console.warn('[room-push] failed to notify Agent Owner of safety pause', {
      roomId: input.roomId,
      messageId: input.messageId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function scheduleRoomMessagePush(input: {
  roomId: string
  messageId: string
  delayMs?: number
}): Promise<void> {
  if (!(await reserveRoomMessagePush(input.messageId))) return

  setTimeout(() => {
    void sendRoomMessagePush(input.roomId, input.messageId).catch((error) => {
      console.warn('[room-push] failed to schedule notification', {
        roomId: input.roomId,
        messageId: input.messageId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, input.delayMs ?? DEFAULT_PUSH_DELAY_MS)
}

async function sendRoomMessagePush(roomId: string, messageId: string): Promise<void> {
  const [room, message] = await Promise.all([
    prisma.room.findUnique({
      where: { id: roomId },
      select: {
        name: true,
        status: true,
        memberships: {
          where: {
            principalType: 'human',
            status: 'active',
            userId: { not: null },
          },
          select: {
            id: true,
            userId: true,
            muteRegularNotifications: true,
            muteMentionNotifications: true,
            agentChildren: {
              where: { status: 'active' },
              select: { id: true },
            },
            readState: { select: { lastReadSequence: true } },
          },
        },
      },
    }),
    prisma.roomMessage.findUnique({
      where: { id: messageId },
      select: {
        roomId: true,
        sequence: true,
        authorMembershipId: true,
        ownerUserIdSnapshot: true,
        authorDisplayNameSnapshot: true,
        mentionSnapshots: true,
        text: true,
        deletedAt: true,
        _count: { select: { attachments: true } },
      },
    }),
  ])
  if (!room || room.status !== 'active' || !message || message.deletedAt || message.roomId !== roomId) {
    return
  }

  const recipientIds = new Set<string>()
  for (const membership of room.memberships) {
    if (!membership.userId || membership.userId === message.ownerUserIdSnapshot) continue
    if ((membership.readState?.lastReadSequence ?? 0n) >= message.sequence) continue
    const isMention = roomMessageMentionsRecipient(
      message.mentionSnapshots,
      membership.id,
      membership.agentChildren.map((agent) => agent.id),
    )
    if (
      (isMention && membership.muteMentionNotifications) ||
      (!isMention && membership.muteRegularNotifications)
    ) continue
    recipientIds.add(membership.userId)
  }
  if (recipientIds.size === 0) return

  const preview = buildVisibleMessagePreview(message.text ?? '')
  const fallback = message._count.attachments > 0 ? '发送了附件' : '有一条新消息'
  const body = `${message.authorDisplayNameSnapshot}: ${preview || fallback}`

  await Promise.all(
    Array.from(recipientIds, async (userId) => {
      const badge = await countUnreadVisibleMessages(userId).catch(() => 0)
      const traceId = randomBytes(8).toString('hex')
      void writeLog({
        traceId,
        userId,
        source: 'server',
        type: 'internal',
        level: 'info',
        path: 'push.room-message',
        metadata: {
          roomId,
          messageId,
          sequence: message.sequence.toString(),
          badge,
        },
      })
      await sendPushNotification(
        userId,
        room.name.trim() || '群聊',
        body,
        { roomId, messageId },
        { audience: 'mobile', traceId, badge },
      )
    }),
  )
}
