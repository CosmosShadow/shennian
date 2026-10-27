// @covers packages/app/src/features/rooms/roomSystemMessages.ts

import type { RoomMessageView } from '@shennian/wire'
import { describe, expect, it } from 'vitest'
import {
  formatRoomSystemMessage,
  isHiddenRoomSystemMessage,
  isHiddenScopedAgentSystemMessage,
} from '../features/rooms/roomSystemMessages'

function message(text: string, kind: RoomMessageView['kind'] = 'system'): RoomMessageView {
  return {
    id: 'message_1',
    roomId: 'room_1',
    sequence: '1',
    kind,
    author: {
      membershipId: 'member_1',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayName: '群主',
    },
    text,
    attachments: [],
    createdAt: '2026-08-28T00:00:00.000Z',
  }
}

const translations: Record<string, string> = {
  spaces_system_member_joined: '{{name}} 已加入群聊。',
  spaces_system_agent_joined_auto: '{{name}} 已加入群聊，将自动跟进群消息。',
  spaces_system_agent_joined_mention: '{{name}} 已加入群聊，仅在被 @ 时响应。',
  spaces_system_agent_joined_paused: '{{name}} 已加入群聊，当前已暂停工作。',
  spaces_system_agent_mode_auto: '{{name}} 已改为自动跟进群消息。',
  spaces_system_agent_mode_mention: '{{name}} 已改为仅在被 @ 时响应。',
  spaces_system_agent_mode_paused: '{{name}} 已改为暂停工作。',
  spaces_system_member_left: '{{name}} 已退出群聊。',
  spaces_system_member_removed: '{{name}} 已被移出群聊。',
  spaces_system_room_renamed: '{{name}} 将群聊名称改为“{{roomName}}”。',
  spaces_system_agent_paused: '{{name}} 已暂停工作：{{reason}}',
  spaces_system_agent_unavailable_offline: '{{name}} 所在机器不在线，暂时无法回复这条消息。',
  spaces_system_agent_unavailable_paused: '{{name}} 已暂停工作，不会回复这条消息。',
  spaces_system_agent_unavailable_recovering: '{{name}} 正在恢复中，暂时无法回复这条消息。',
  spaces_system_agent_unavailable: '{{name}} 暂时无法回复这条消息。',
}

const t = (key: string, options?: Record<string, unknown>) =>
  translations[key]
    .replace('{{name}}', String(options?.name ?? ''))
    .replace('{{reason}}', String(options?.reason ?? ''))
    .replace('{{roomName}}', String(options?.roomName ?? ''))

const englishTranslations: Record<string, string> = {
  spaces_system_member_joined: '{{name}} joined the group chat.',
  spaces_system_agent_joined_auto:
    '{{name}} joined the group chat and will automatically follow group messages.',
  spaces_system_agent_joined_mention:
    '{{name}} joined the group chat and will respond only when mentioned.',
  spaces_system_agent_joined_paused: '{{name}} joined the group chat with work paused.',
  spaces_system_agent_mode_auto: '{{name}} now automatically follows group messages.',
  spaces_system_agent_mode_mention: '{{name}} now responds only when mentioned.',
  spaces_system_agent_mode_paused: '{{name}} is now paused.',
  spaces_system_member_left: '{{name}} left the group chat.',
  spaces_system_member_removed: '{{name}} was removed from the group chat.',
  spaces_system_room_renamed: '{{name}} changed the group chat name to “{{roomName}}”.',
}

const tEnglish = (key: string, options?: Record<string, unknown>) =>
  englishTranslations[key]
    .replace('{{name}}', String(options?.name ?? ''))
    .replace('{{roomName}}', String(options?.roomName ?? ''))

describe('formatRoomSystemMessage', () => {
  it.each([
    ["Opencode's machine is offline and cannot respond to this message.", 'Opencode 所在机器不在线，暂时无法回复这条消息。'],
    ['Pi is paused and will not respond to this message.', 'Pi 已暂停工作，不会回复这条消息。'],
    ['Pi is recovering and cannot respond to this message yet.', 'Pi 正在恢复中，暂时无法回复这条消息。'],
    ['Pi is temporarily unable to respond to this message.', 'Pi 暂时无法回复这条消息。'],
  ])('translates the unreachable-agent notice %s', (text, expected) => {
    expect(formatRoomSystemMessage(message(text), t)).toBe(expected)
  })

  it('hides legacy Room settings notices but not ordinary messages', () => {
    expect(isHiddenRoomSystemMessage(message('李辰 updated the space settings.'))).toBe(true)
    expect(isHiddenRoomSystemMessage(message('李辰 updated the space settings.', 'text'))).toBe(
      false,
    )
    expect(isHiddenRoomSystemMessage(message('群聊名称已更新。'))).toBe(false)
  })

  it.each([
    ['Codex joined the Room.', 'Codex 已加入群聊。'],
    ['Claude Code 验收 left the Room.', 'Claude Code 验收 已退出群聊。'],
    ['Claude Code 验收 was removed from the Room.', 'Claude Code 验收 已被移出群聊。'],
  ])('localizes a persisted membership event: %s', (source, expected) => {
    expect(formatRoomSystemMessage(message(source), t)).toBe(expected)
  })

  it('localizes an Agent pause reason from the persisted system message', () => {
    expect(
      formatRoomSystemMessage(message('研发助手 paused work. Reason: 检测到越权诱导'), t),
    ).toBe('研发助手 已暂停工作：检测到越权诱导')
  })

  it('shows who renamed the Room and its new name in both languages', () => {
    const source = '李辰 changed the group chat name to “研发 “协作” 群”.'
    expect(formatRoomSystemMessage(message(source), t)).toBe('李辰 将群聊名称改为“研发 “协作” 群”。')
    expect(formatRoomSystemMessage(message(source), tEnglish)).toBe(source)
    expect(formatRoomSystemMessage(message(source, 'text'), t)).toBe(source)
  })

  it.each([
    [
      '产品助手 joined the Room and will automatically follow group messages.',
      '产品助手 已加入群聊，将自动跟进群消息。',
    ],
    [
      '开发助手 joined the Room and will respond only when mentioned.',
      '开发助手 已加入群聊，仅在被 @ 时响应。',
    ],
    [
      '产品助手 changed work mode to respond only when mentioned.',
      '产品助手 已改为仅在被 @ 时响应。',
    ],
    [
      '产品助手 changed work mode to automatically follow group messages.',
      '产品助手 已改为自动跟进群消息。',
    ],
  ])('shows an Agent join or mode change as a localized system message', (source, expected) => {
    expect(formatRoomSystemMessage(message(source), t)).toBe(expected)
  })

  it.each([
    ['Codex 已加入群聊。', 'Codex joined the group chat.'],
    ['Codex已加入群聊.', 'Codex joined the group chat.'],
    ['Claude Code 验收 已退出群聊。', 'Claude Code 验收 left the group chat.'],
    ['Claude Code 验收 已被移出群聊。', 'Claude Code 验收 was removed from the group chat.'],
  ])('localizes a persisted Chinese membership event in English: %s', (source, expected) => {
    expect(formatRoomSystemMessage(message(source), tEnglish)).toBe(expected)
  })

  it('preserves unknown system messages and normal member messages', () => {
    expect(formatRoomSystemMessage(message('群聊名称已更新。'), t)).toBe('群聊名称已更新。')
    expect(formatRoomSystemMessage(message('Codex was removed from the Room.', 'text'), t)).toBe(
      'Codex was removed from the Room.',
    )
  })

  it('does not show group-join notices inside an AI-scoped one-to-one view', () => {
    expect(isHiddenScopedAgentSystemMessage(message('Docker Pi 已加入群聊，将自动跟进群消息。'))).toBe(true)
    expect(isHiddenScopedAgentSystemMessage(message('Docker Pi joined the Room and will automatically follow group messages.'))).toBe(true)
    expect(isHiddenScopedAgentSystemMessage(message('回复已排队。'))).toBe(false)
  })
})
