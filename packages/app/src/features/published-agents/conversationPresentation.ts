// @arch docs/features/published-agent-direct-conversations.md
// @test src/__tests__/chat-delivery-copy.test.ts
import type { MyPublishedConversationDetail, PublishedConversationMessage } from './directConversationClient'

export type Message = {
  id: string
  sequence: string
  authorRole: 'visitor' | 'agent' | 'system'
  text: string | null
  status: string
  failureCode?: string | null
  createdAt: string
  attachments?: Array<{ attachmentId: string; name: string; mediaKind: string;
    mimeType: string; byteSize: string; available: boolean }>
}
// Keep the local echo until polling has returned the acknowledged server message.
export function visibleMessages(messages: Message[], local: Message | null): Message[] {
  return local && !messages.some((message) => message.id === local.id)
    ? [...messages, local] : messages
}

export function waitingForReply(messages: Message[]): boolean {
  let latest: Message | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].authorRole !== 'system') {
      latest = messages[index]
      break
    }
  }
  return !!latest && ['pending', 'running', 'sending'].includes(latest.status)
    && (latest.authorRole === 'visitor' || !latest.text?.trim())
}

export function isOwnPublishedMessage(role: 'owner' | 'visitor', authorRole: PublishedConversationMessage['authorRole']) {
  return authorRole === (role === 'owner' ? 'agent' : 'visitor')
}

export function canSendPublishedMessage(conversation: MyPublishedConversationDetail | null): boolean {
  if (!conversation || conversation.status !== 'active' || conversation.publicationStatus !== 'active') return false
  return conversation.role === 'owner' ? conversation.canReplyAsAgent === true : Boolean(conversation.publicId)
}
