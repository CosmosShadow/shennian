// @arch docs/features/network-rooms/ui.md#54-消息
// @test src/__tests__/room-system-messages.test.ts

import type { RoomMessageView } from '@shennian/wire'

type Translate = (key: string, options?: Record<string, unknown>) => string

const MEMBERSHIP_SYSTEM_MESSAGES = [
  {
    patterns: [
      /^([\s\S]+?) changed the group chat name to “([\s\S]*)”\.$/,
    ],
    translationKey: 'spaces_system_room_renamed',
  },
  {
    patterns: [
      /^(.*?)\s+joined the Room and will automatically follow group messages\.\s*$/,
      /^(.*?)\s*已加入群聊[，,]\s*将自动跟进群消息[。.]\s*$/,
    ],
    translationKey: 'spaces_system_agent_joined_auto',
  },
  {
    patterns: [
      /^(.*?)\s+joined the Room and will respond only when mentioned\.\s*$/,
      /^(.*?)\s*已加入群聊[，,]\s*仅在被\s*@\s*时响应[。.]\s*$/,
    ],
    translationKey: 'spaces_system_agent_joined_mention',
  },
  {
    patterns: [
      /^(.*?)\s+joined the Room with work paused\.\s*$/,
      /^(.*?)\s*已加入群聊[，,]\s*当前已暂停工作[。.]\s*$/,
    ],
    translationKey: 'spaces_system_agent_joined_paused',
  },
  {
    patterns: [
      /^(.*?)\s+changed work mode to automatically follow group messages\.\s*$/,
      /^(.*?)\s*已改为自动跟进群消息[。.]\s*$/,
    ],
    translationKey: 'spaces_system_agent_mode_auto',
  },
  {
    patterns: [
      /^(.*?)\s+changed work mode to respond only when mentioned\.\s*$/,
      /^(.*?)\s*已改为仅在被\s*@\s*时响应[。.]\s*$/,
    ],
    translationKey: 'spaces_system_agent_mode_mention',
  },
  {
    patterns: [/^(.*?)\s+changed work mode to paused\.\s*$/, /^(.*?)\s*已改为暂停工作[。.]\s*$/],
    translationKey: 'spaces_system_agent_mode_paused',
  },
  {
    patterns: [/^(.*?)\s+paused work\. Reason:\s+(.+)$/, /^(.*?)\s*暂停了工作[：:]\s*(.+)$/],
    translationKey: 'spaces_system_agent_paused',
  },
  {
    patterns: [/^(.*?)'s machine is offline and cannot respond to this message\.\s*$/],
    translationKey: 'spaces_system_agent_unavailable_offline',
  },
  {
    patterns: [/^(.*?)\s+is paused and will not respond to this message\.\s*$/],
    translationKey: 'spaces_system_agent_unavailable_paused',
  },
  {
    patterns: [/^(.*?)\s+is recovering and cannot respond to this message yet\.\s*$/],
    translationKey: 'spaces_system_agent_unavailable_recovering',
  },
  {
    patterns: [/^(.*?)\s+is temporarily unable to respond to this message\.\s*$/],
    translationKey: 'spaces_system_agent_unavailable',
  },
  {
    patterns: [
      /^(.*?)\s+was removed from (?:the Room|the group chat)\.\s*$/,
      /^(.*?)\s*已被移出群聊[。.]\s*$/,
    ],
    translationKey: 'spaces_system_member_removed',
  },
  {
    patterns: [/^(.*?)\s+joined (?:the Room|the group chat)\.\s*$/, /^(.*?)\s*已加入群聊[。.]\s*$/],
    translationKey: 'spaces_system_member_joined',
  },
  {
    patterns: [/^(.*?)\s+left (?:the Room|the group chat)\.\s*$/, /^(.*?)\s*已退出群聊[。.]\s*$/],
    translationKey: 'spaces_system_member_left',
  },
] as const

const HIDDEN_SYSTEM_MESSAGE_PATTERN = /^.*?\s+updated the space settings\.\s*$/

const MEMBERSHIP_JOIN_LEAVE_PATTERN =
  /^(?:.*?\s+joined (?:the Room|the group chat)\.\s*|.*?\s*已加入群聊[。.]\s*|.*?\s+left (?:the Room|the group chat)\.\s*|.*?\s*已退出群聊[。.]\s*)$/

/**
 * A 2-member Room reads as a plain 1:1 conversation, not a group; its own
 * join/leave notices would otherwise misleadingly look like group chat churn.
 */
export function isHiddenRoomSystemMessage(message: RoomMessageView, memberCount?: number): boolean {
  if (message.kind !== 'system') return false
  const text = message.text?.trim() ?? ''
  if (HIDDEN_SYSTEM_MESSAGE_PATTERN.test(text)) return true
  return (memberCount ?? Infinity) <= 2 && MEMBERSHIP_JOIN_LEAVE_PATTERN.test(text)
}

/** An AI-scoped conversation is presented as one-to-one even when its backing Room has more members. */
export function isHiddenScopedAgentSystemMessage(message: RoomMessageView): boolean {
  if (message.kind !== 'system') return false
  const value = message.text?.trim() ?? ''
  return isHiddenRoomSystemMessage(message, 2)
    || /已加入群聊|已退出群聊|已被移出群聊|joined the Room|joined the group chat|left the Room|left the group chat|removed from the Room/.test(value)
}

export function formatRoomSystemMessage(message: RoomMessageView, t: Translate): string {
  const text = message.text?.trim() ?? ''
  if (message.kind !== 'system' || !text) return text

  for (const definition of MEMBERSHIP_SYSTEM_MESSAGES) {
    for (const pattern of definition.patterns) {
      const match = text.match(pattern)
      const name = match?.[1]?.trim()
      if (name) return t(definition.translationKey, {
        name,
        reason: match?.[2]?.trim(),
        roomName: match?.[2],
      })
    }
  }

  return text
}
