// @covers src/features/chat/utils/failedSendDraft.ts
// @covers src/features/chat/utils/sendFailure.ts
// @covers src/features/chat/hooks/useChatSendController.ts

import { useChatStore, type ChatMessage } from '@shennian/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { composeAttachmentMessageContent } from '../features/chat/utils/attachments'
import { toDraftUploadTasks } from '../features/chat/utils/sendDraft'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}))

import { chatSendFailureKey } from '../features/chat/utils/sendFailure'
import { restoreFailedSendDraft } from '../features/chat/utils/failedSendDraft'
import { clearAllChatDrafts, getChatDraft, saveChatDraft } from '../features/chat/utils/draftStorage'
import {
  clearAllChatOutboundMessages,
  getChatOutboundMessages,
  saveChatOutboundMessage,
} from '../features/chat/utils/outboundStorage'

const accountId = 'account-send-recovery'
const sessionId = 'session-send-recovery'
const attachment = {
  path: '/project/.uploads/image.png', name: 'image.png', mimeType: 'image/png',
  kind: 'image' as const, byteSize: 5, sha256: 'a'.repeat(64),
}
const original = { text: '  请检查图片\n保留换行  ', attachments: toDraftUploadTasks([attachment]) }
const message = (): ChatMessage => ({
  id: 'failed-send', role: 'user', ts: Date.now(), status: 'sending',
  content: composeAttachmentMessageContent(original.text, [attachment]),
  attachments: [attachment],
})

beforeEach(async () => {
  await clearAllChatDrafts()
  await clearAllChatOutboundMessages()
  useChatStore.getState().clear()
  useChatStore.getState().setSessionId(sessionId)
})

function beginSend() {
  const pending = message()
  useChatStore.getState().addMessage(pending)
  useChatStore.getState().startPendingRun()
  saveChatOutboundMessage(accountId, sessionId, pending)
  return pending
}

describe('rejected sends return only to the draft', () => {
  it('restores exact text and uploaded attachments, removes the bubble/outbox and pending run', () => {
    const pending = beginSend()
    const draft = restoreFailedSendDraft(accountId, sessionId, pending, original, {
      text: '', attachments: [],
    })
    expect(draft).toEqual(original)
    expect(getChatDraft(accountId, sessionId)).toEqual({ text: original.text, attachments: [attachment] })
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().isTyping).toBe(false)
    expect(getChatOutboundMessages(accountId, sessionId)).toEqual([])
    // A history reload/re-entry has no failed outbox item to reinsert.
    useChatStore.getState().clear()
    expect(getChatDraft(accountId, sessionId)?.text).toBe(original.text)
    expect(getChatOutboundMessages(accountId, sessionId)).toEqual([])
  })

  it('keeps text typed during the send and preserves new in-progress uploads', () => {
    const pending = beginSend()
    const uploading = { ...original.attachments[0], id: 'new-upload', path: '/new.png', progress: 0.3 }
    const draft = restoreFailedSendDraft(accountId, sessionId, pending, original, {
      text: '下一条消息', attachments: [uploading],
    })
    expect(draft.text).toBe(`${original.text}\n\n下一条消息`)
    expect(draft.attachments).toEqual([...original.attachments, uploading])
    expect(getChatDraft(accountId, sessionId)?.attachments).toEqual([attachment])
  })

  it('does not duplicate an already restored draft or its attachments', () => {
    const pending = beginSend()
    saveChatDraft(accountId, sessionId, { text: original.text, attachments: [attachment] })
    expect(restoreFailedSendDraft(accountId, sessionId, pending, original)).toEqual(original)
  })

  it('saves a late rejection to its original session without touching the active conversation', () => {
    const pending = beginSend()
    saveChatDraft(accountId, sessionId, { text: '另一个草稿', attachments: [] })
    useChatStore.getState().clear()
    useChatStore.getState().setSessionId('new-session')
    const other = { ...message(), id: 'other-message', content: 'new session' }
    useChatStore.getState().addMessage(other)
    useChatStore.getState().startPendingRun()
    restoreFailedSendDraft(accountId, sessionId, pending, original)
    expect(useChatStore.getState().messages).toEqual([other])
    expect(useChatStore.getState().isTyping).toBe(true)
    expect(getChatDraft(accountId, sessionId)?.text).toBe(`${original.text}\n\n另一个草稿`)
    expect(getChatDraft(accountId, 'new-session')).toBeNull()
    expect(getChatDraft('other-account', sessionId)).toBeNull()
    expect(getChatOutboundMessages(accountId, sessionId)).toEqual([])
  })

  it('can recover a legacy failed bubble or rejected resend without duplicating attachment markup', () => {
    const pending = beginSend()
    const draft = restoreFailedSendDraft(accountId, sessionId, pending)
    expect(draft.text).toBe(original.text.trim())
    expect(draft.attachments).toEqual(original.attachments)
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('does not duplicate a legacy message whose persisted draft retained surrounding whitespace', () => {
    const pending = beginSend()
    saveChatDraft(accountId, sessionId, { text: original.text, attachments: [attachment] })
    expect(restoreFailedSendDraft(accountId, sessionId, pending)).toEqual(original)
  })

  it('restores attachment-only sends without inserting Markdown paths into the input', () => {
    const pending = beginSend()
    pending.content = composeAttachmentMessageContent('', [attachment])
    expect(restoreFailedSendDraft(accountId, sessionId, pending)).toEqual({
      text: '', attachments: original.attachments,
    })
    expect(getChatDraft(accountId, sessionId)).toEqual({ text: '', attachments: [attachment] })
  })

  it('keeps unrelated messages and authoritative Agent activity intact', () => {
    const pending = beginSend()
    const confirmed = { ...message(), id: 'confirmed-message', status: 'sent' as const }
    useChatStore.getState().addMessage(confirmed)
    useChatStore.setState({ currentRunId: 'real-run', isTyping: true, runPhase: 'streaming_text' })
    restoreFailedSendDraft(accountId, sessionId, pending, original)
    expect(useChatStore.getState().messages).toEqual([confirmed])
    expect(useChatStore.getState().currentRunId).toBe('real-run')
    expect(useChatStore.getState().isTyping).toBe(true)
  })
})

describe('rejected send explanation', () => {
  it.each(['managed_agent_direct_requires_cli_upgrade', 'steward_requires_cli_upgrade'])(
    'explains an upgrade gate (%s)', (reason) => {
      expect(chatSendFailureKey(new Error(reason))).toBe('chat_send_requires_cli_upgrade')
    },
  )
  it('explains the missing managed context without exposing internal data', () => {
    expect(chatSendFailureKey(new Error('managed_agent_context_unavailable'))).toBe('chat_send_agent_context_unavailable')
    expect(chatSendFailureKey(new Error('/private/path token=secret'))).toBe('chat_send_rejected_draft_restored')
    expect(chatSendFailureKey(null)).toBe('chat_send_rejected_draft_restored')
  })
})
