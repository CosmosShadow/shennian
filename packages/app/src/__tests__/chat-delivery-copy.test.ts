// @covers packages/app/src/components/chat/webview/chatMessageRendering.js
// @covers open-source/packages/shared/src/i18n/zh.ts
// @covers open-source/packages/shared/src/i18n/en.ts
// @arch docs/architecture/app/chat-draft-storage.md

import { describe, expect, it, vi } from 'vitest'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
import en from '../../../../open-source/packages/shared/src/i18n/en'
import { createHarness } from './chat-webview-harness'

describe('chat delivery feedback copy', () => {
  for (const [language, copy] of [
    ['zh', zh],
    ['en', en],
  ] as const) {
    it(`${language}: presents pending and unknown delivery as sending, then clears success`, () => {
      const { dispatch, getHtml } = createHarness({
        i18n: {
          msgSending: copy.msg_sending,
          msgStillSending: copy.msg_still_sending,
          msgUncertain: copy.msg_uncertain,
          msgSendFailed: copy.msg_send_failed,
        },
      })
      dispatch({
        type: 'init',
        theme: { isDark: false, colors: {} },
        messages: [{ id: 'delivery', role: 'user', ts: 1, content: 'Hello', status: 'sending' }],
        runPhase: 'idle',
        initialScroll: { kind: 'bottom' },
      })
      expect(copy.msg_sending).toBe(language === 'zh' ? '发送中…' : 'Sending…')
      expect(copy.msg_still_sending).toBe(copy.msg_sending)
      expect(copy.msg_uncertain).toBe(copy.msg_sending)
      expect(getHtml()).toContain(copy.msg_sending)

      dispatch({ type: 'updateStatus', msgId: 'delivery', status: 'uncertain' })
      expect(getHtml()).toContain(copy.msg_sending)
      expect(getHtml()).toContain('sending-status')
      expect(getHtml()).not.toContain('暂未确认送达')
      expect(getHtml()).not.toContain('Delivery not yet confirmed')
      expect(getHtml()).not.toContain('发送状态未确认')
      expect(getHtml()).not.toContain('uncertain-resend')

      for (const status of ['sent', 'delivered']) {
        dispatch({ type: 'updateStatus', msgId: 'delivery', status })
        expect(getHtml()).toContain('Hello')
        expect(getHtml()).not.toContain('msg-status')
      }

      dispatch({ type: 'updateStatus', msgId: 'delivery', status: 'error' })
      expect(getHtml()).toContain(copy.msg_send_failed)
      expect(getHtml()).not.toContain('error-resend')
    })
  }

  it('uses the same Chinese wording before translations are supplied', () => {
    const { dispatch, getHtml } = createHarness()
    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        { id: 'sending', role: 'user', ts: 1, content: 'Hello', status: 'sending' },
        { id: 'unknown', role: 'user', ts: 2, content: 'World', status: 'uncertain' },
      ],
      runPhase: 'idle',
    })
    expect(getHtml()).toContain(zh.msg_sending)
    expect(zh.msg_uncertain).toBe(zh.msg_sending)
    expect(getHtml().match(/发送中…/g)).toHaveLength(4)
    expect(getHtml()).not.toContain('暂未确认送达')
    expect(getHtml()).not.toContain('仍在发送')
    expect(getHtml()).not.toContain('发送状态未确认')
  })
})

// @covers packages/app/src/features/published-agents/conversationPresentation.ts
import { visibleMessages, waitingForReply, type Message } from '../features/published-agents/conversationPresentation'
const message = (id: string, status = 'pending', authorRole: Message['authorRole'] = 'visitor', text = 'hello'): Message =>
  ({ id, status, authorRole, text, sequence: '1', createdAt: '2026-10-09T00:00:00Z' })
describe('published conversation presentation', () => {
  it('keeps a local echo through empty polls and replaces it with its server acknowledgement', () => {
    const local = message('local', 'sending')
    expect(visibleMessages([], local)).toEqual([local])
    const accepted = { ...local, id: 'server', status: 'pending' }
    expect(visibleMessages([], accepted)).toEqual([accepted])
    const server = message('server', 'running')
    expect(visibleMessages([server], accepted)).toEqual([server])
  })
  it('shows one reply indicator while sending or waiting, and stops for content or failure', () => {
    for (const status of ['sending', 'pending', 'running']) expect(waitingForReply([message('v', status)])).toBe(true)
    expect(waitingForReply([message('v'), message('a', 'running', 'agent', 'answer')])).toBe(false)
    expect(waitingForReply([message('v', 'failed')])).toBe(false)
    expect(waitingForReply([message('v', 'cancelled')])).toBe(false)
    expect(waitingForReply([])).toBe(false)
  })
})


// @covers packages/app/src/features/published-agents/conversationPresentation.ts
import { canSendPublishedMessage, isOwnPublishedMessage } from '../features/published-agents/conversationPresentation'
import type { MyPublishedConversationDetail } from '../features/published-agents/directConversationClient'
const conversation: MyPublishedConversationDetail = { id: 'chat-1', role: 'owner', status: 'active',
  displayName: 'Support AI', description: '', publicationStatus: 'active', canReplyAsAgent: true }
describe('one-to-one role presentation', () => {
  it('puts the visitor on the left and agent on the right for publishers', () => {
    expect(isOwnPublishedMessage('owner', 'visitor')).toBe(false)
    expect(isOwnPublishedMessage('owner', 'agent')).toBe(true)
    expect(isOwnPublishedMessage('visitor', 'visitor')).toBe(true)
    expect(isOwnPublishedMessage('visitor', 'agent')).toBe(false)
  })
  it('requires explicit server support before showing a publisher composer', () => {
    expect(canSendPublishedMessage(conversation)).toBe(true)
    expect(canSendPublishedMessage({ ...conversation, canReplyAsAgent: undefined })).toBe(false)
    expect(canSendPublishedMessage({ ...conversation, status: 'paused' })).toBe(false)
    expect(canSendPublishedMessage({ ...conversation, publicationStatus: 'revoked' })).toBe(false)
    expect(canSendPublishedMessage(null)).toBe(false)
  })
  it('keeps visitor sends gated by their public link', () => {
    expect(canSendPublishedMessage({ ...conversation, role: 'visitor' })).toBe(false)
    expect(canSendPublishedMessage({ ...conversation, role: 'visitor', publicId: 'a'.repeat(32) })).toBe(true)
  })
})


// @covers packages/app/src/features/published-agents/conversationListItems.ts
import { mergePublishedConversationList } from '../features/published-agents/conversationListItems'
import type { RoomListItem } from '../features/rooms/roomListCache'
import type { MyPublishedConversation } from '../features/published-agents/directConversationClient'
const room = (id: string, date: string, pinnedAt: string | null = null) => ({ id, name: id, updatedAt: date, pinnedAt }) as RoomListItem
const chat = (id: string, date: string, role: 'owner' | 'visitor' = 'owner') => ({ id, displayName: 'Support AI',
  visitorName: 'Alice', lastActivityAt: date, role }) as MyPublishedConversation
it('merges visitor conversations into the normal activity order, keeping pins', () => {
  const entries = mergePublishedConversationList([room('group', '2026-10-09'), room('pinned', '2026-10-01', '2026-10-01')],
    [chat('visitor', '2026-10-10')])
  expect(entries.map((entry) => entry.row.id)).toEqual(['pinned', 'visitor', 'group'])
})
it('deduplicates canonical Room projections while retaining publisher perspective', () => {
  expect(mergePublishedConversationList([room('chat', '2026-10-10')], [chat('chat', '2026-10-10')])[0].kind).toBe('published')
  expect(mergePublishedConversationList([room('chat', '2026-10-10')], [chat('chat', '2026-10-10', 'visitor')])[0].kind).toBe('room')
})
it('matches both visitor and AI names without mutating source inventory', () => {
  const rooms = [room('group', '2026-10-10')]
  const chats = [chat('chat', '2026-10-10')]
  expect(mergePublishedConversationList(rooms, chats, 'alice')).toHaveLength(1)
  expect(mergePublishedConversationList(rooms, chats, 'support')).toHaveLength(1)
  expect(mergePublishedConversationList(rooms, chats, 'missing')).toEqual([])
  expect(chats).toHaveLength(1); expect(rooms).toHaveLength(1)
})
it('hides a publisher self-test in both legacy and canonical lists, without hiding other chats', () => {
  const entries = mergePublishedConversationList([room('self', '2026-10-10'), room('group', '2026-10-10')],
    [chat('self', '2026-10-10'), chat('other', '2026-10-10', 'visitor')], '', ['self'])
  expect(entries.map((entry) => entry.row.id)).toEqual(['group', 'other'])
})

// @covers packages/app/src/components/chat/SimpleMessageMarkdown.tsx
import { createRequire } from 'node:module'
const MarkdownIt = createRequire(import.meta.url)('markdown-it') as
  (options: Record<string, unknown>) => { render: (value: string) => string }
it('renders basic simple-conversation Markdown and auto-links bare URLs', () => {
    const html = MarkdownIt({ typographer: true, linkify: true, breaks: true }).render(
      '分享：https://shennian.net/p/example 。**重点** [说明](https://example.com) `代码`',
    )
    expect(html).toContain('<a href="https://shennian.net/p/example">')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<a href="https://example.com">说明</a>')
    expect(html).toContain('<code>代码</code>')
})
