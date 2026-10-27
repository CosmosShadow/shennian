// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-notification-integration.test.ts

import type { EventFrame, NianSession, RoomMessageCreatedEvent } from '@shennian/wire'
import type { DesktopNotificationRequest } from './types'

export function isDesktopNotificationNavigationRoute(route: string): boolean {
  return /^(?:\/(?:agents|machine|chat)\/[A-Za-z0-9._~-]{1,256}|\/room-workspace\?roomId=[A-Za-z0-9._~-]{1,256})$/.test(
    route,
  )
}

function notificationCopy(
  kind: DesktopNotificationRequest['kind'],
  language: string,
): Pick<DesktopNotificationRequest, 'title' | 'body'> {
  const english = language.toLowerCase().startsWith('en')
  if (kind === 'room.message') {
    return english
      ? { title: 'New group message', body: 'A group has a new message. Click to view it.' }
      : { title: '群聊有新消息', body: '群聊中有一条新消息，点击查看。' }
  }
  if (kind === 'session.completed') {
    return english
      ? { title: 'Task completed', body: 'An Agent task finished. Click to view it.' }
      : { title: '任务已完成', body: 'Agent 已完成任务，点击查看。' }
  }
  return english
    ? {
        title: 'Task needs attention',
        body: 'An Agent task needs your attention. Click to view it.',
      }
    : { title: '任务需要处理', body: 'Agent 任务需要你处理，点击查看。' }
}

export function buildDesktopSessionNotification(
  previous: NianSession | undefined,
  next: NianSession,
  language = 'zh',
): DesktopNotificationRequest | null {
  if (!previous) return null
  const previousCount = previous.attentionCount ?? 0
  const nextCount = next.attentionCount ?? 0
  if (
    nextCount <= previousCount ||
    (next.lastAttentionId != null && next.lastAttentionId === previous.lastAttentionId)
  ) {
    return null
  }

  const kind = next.status === 'completed' ? 'session.completed' : 'agent.attention'
  return {
    kind,
    ...notificationCopy(kind, language),
    target: { kind: 'session', id: next.id },
  }
}

export function buildDesktopRoomNotification(
  frame: EventFrame,
  accountId: string | null | undefined,
  language = 'zh',
): DesktopNotificationRequest | null {
  if (
    frame.event !== 'room.message.created' ||
    !frame.payload ||
    typeof frame.payload !== 'object'
  ) {
    return null
  }
  const event = frame.payload as Partial<RoomMessageCreatedEvent>
  if (
    event.event !== 'room.message.created' ||
    !event.message ||
    typeof event.roomId !== 'string' ||
    !event.roomId ||
    event.message.kind === 'system' ||
    (accountId && event.message.author.ownerUserId === accountId)
  ) {
    return null
  }
  return {
    kind: 'room.message',
    ...notificationCopy('room.message', language),
    target: { kind: 'room', id: event.roomId },
  }
}
