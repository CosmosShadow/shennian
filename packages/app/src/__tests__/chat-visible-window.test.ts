// @covers packages/app/src/features/chat/utils/visibleWindow.ts

import { describe, expect, it } from 'vitest'
import { mergeVisibleChatMessages } from '../features/chat/utils/visibleWindow'
import type { ChatMessage } from '@shennian/shared'

function msg(id: string, ts: number): ChatMessage {
  return { id, ts, role: 'user', content: id }
}

describe('chat visible message window', () => {
  it('keeps older loaded messages when a bounded recent refresh arrives', () => {
    const current = [msg('old-1', 1), msg('old-2', 2), msg('recent-1', 3), msg('recent-2', 4)]
    const incoming = [msg('recent-1', 3), msg('recent-2', 4), msg('recent-3', 5)]

    expect(mergeVisibleChatMessages(current, incoming).map((message) => message.id)).toEqual([
      'old-1',
      'old-2',
      'recent-1',
      'recent-2',
      'recent-3',
    ])
  })

  it('replaces the visible window when the incoming messages do not overlap', () => {
    const current = [msg('old-1', 1), msg('old-2', 2)]
    const incoming = [msg('recent-1', 3), msg('recent-2', 4)]

    expect(mergeVisibleChatMessages(current, incoming)).toEqual(incoming)
  })

  it('keeps an optimistic user message when a stale history refresh arrives', () => {
    const current: ChatMessage[] = [
      msg('user-older', 1),
      { id: 'agent-older', ts: 2, role: 'agent', content: 'previous answer' },
      {
        id: 'user-pending',
        ts: 3,
        role: 'user',
        content: 'do not disappear',
        status: 'sending',
      },
    ]
    const staleHistory = current.slice(0, 2)

    expect(mergeVisibleChatMessages(current, staleHistory)).toEqual(current)
  })

  it('keeps an optimistic first message when remote history is still empty', () => {
    const pending: ChatMessage = {
      id: 'user-pending',
      ts: 1,
      role: 'user',
      content: 'first message',
      status: 'sent',
    }

    expect(mergeVisibleChatMessages([pending], [])).toEqual([pending])
  })

  it('keeps a newer confirmed user message when an older history request finishes late', () => {
    const staleHistory: ChatMessage[] = [
      msg('user-older', 1),
      { id: 'agent-older', ts: 2, role: 'agent', content: 'previous answer' },
    ]
    const confirmedUser: ChatMessage = {
      id: 'user-confirmed',
      ts: 3,
      role: 'user',
      content: 'already accepted by daemon',
    }

    expect(mergeVisibleChatMessages([...staleHistory, confirmedUser], staleHistory)).toEqual([
      ...staleHistory,
      confirmedUser,
    ])
  })

  it('restores an earlier user message from remote history when local cache starts mid-run', () => {
    const localHalfWindow: ChatMessage[] = [
      { id: 'agent-1', ts: 20, role: 'agent', content: '我来直接回复这条外部消息。' },
      { id: 'tool-1', ts: 30, role: 'agent', content: '', toolCalls: [{ name: 'shell_command' }] },
    ]
    const remoteCompleteWindow: ChatMessage[] = [
      { id: 'external-user-1', ts: 10, role: 'user', content: '外部对话: ABC\n通天塔客服: hello' },
      { id: 'agent-1', ts: 20, role: 'agent', content: '我来直接回复这条外部消息。' },
      { id: 'tool-1', ts: 30, role: 'agent', content: '', toolCalls: [{ name: 'shell_command' }] },
    ]

    expect(mergeVisibleChatMessages(localHalfWindow, remoteCompleteWindow)).toEqual(
      remoteCompleteWindow,
    )
  })
})
