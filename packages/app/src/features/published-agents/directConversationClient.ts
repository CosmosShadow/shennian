// @arch docs/features/published-agent-direct-conversations.md

import { authApi } from '../../config/api'

export type MyPublishedConversation = {
  id: string
  agentIdentityId: string
  displayName: string
  description: string
  status: string
  publicationStatus: string
  machineOnline?: boolean
  publicId?: string
  lastActivityAt: string
  role?: 'visitor' | 'owner'
  visitorName?: string
  unreadCount?: number
}

export type PublishedConversationMessage = {
  id: string
  sequence: string
  authorRole: 'visitor' | 'agent'
  text: string
  status: string
  failureCode?: string | null
  createdAt: string
  attachments?: Array<{ attachmentId: string; name: string; mediaKind: string;
    mimeType: string; byteSize: string; available: boolean }>
}

export function getMyPublishedConversationAttachment(conversationId: string, attachmentId: string) {
  if (!ID.test(conversationId) || !/^datt_[a-f0-9-]{36}$/.test(attachmentId)) {
    throw new Error('invalid_attachment_id')
  }
  return authApi<{ downloadUrl: string }>(
    `/agent-direct-conversations/${encodeURIComponent(conversationId)}`
    + `/attachments/${encodeURIComponent(attachmentId)}/download`,
  )
}

export type MyPublishedConversationDetail = {
  id: string
  status: string
  role: 'visitor' | 'owner'
  displayName: string
  description: string
  publicationStatus: string
  machineOnline?: boolean
  publicId?: string
  ownerLastViewedAt?: string | null
  visitorName?: string
  avatar?: string | null
  canAttach?: boolean
  canReplyAsAgent?: boolean
}

export function resumeMyPublishedConversation(conversationId: string) {
  if (!ID.test(conversationId)) throw new Error('invalid_conversation_id')
  return authApi<{ conversationId: string; status: 'active' }>(
    `/agent-direct-conversations/${encodeURIComponent(conversationId)}/resume`,
    { method: 'POST', body: '{}' },
  )
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

export function listMyPublishedConversations(cursor?: string) {
  if (cursor && !ID.test(cursor)) throw new Error('invalid_conversation_cursor')
  return authApi<{ conversations: MyPublishedConversation[]; nextCursor: string | null }>(
    `/agent-direct-conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  )
}

export function listOwnedPublishedConversations(cursor?: string) {
  if (cursor && !ID.test(cursor)) throw new Error('invalid_conversation_cursor')
  return authApi<{ conversations: MyPublishedConversation[]; nextCursor: string | null }>(
    `/agent-direct-conversations/owned${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  )
}

export function sendOwnerPublishedConversation(conversationId: string, text: string, clientMessageId: string, attachmentIds: string[] = []) {
  if (!ID.test(conversationId)) throw new Error('invalid_conversation_id')
  return authApi<{ conversationId: string; messageId: string; sequence: string; status: string; idempotent: boolean }>(
    `/agent-direct-conversations/${encodeURIComponent(conversationId)}/owner-messages`,
    { method: 'POST', body: JSON.stringify({ text, clientMessageId, attachmentIds }) },
  )
}

export function readMyPublishedConversation(conversationId: string,
  page: { before: 'latest' | string } | { after: string }, perspective?: 'owner') {
  if (!ID.test(conversationId)) throw new Error('invalid_conversation_id')
  const query = 'before' in page
    ? `before=${encodeURIComponent(page.before)}`
    : `after=${encodeURIComponent(page.after)}`
  return authApi<{ conversation: MyPublishedConversationDetail;
    messages: PublishedConversationMessage[]; nextBefore?: string | null;
    nextAfter?: string | null }>(
    `/agent-direct-conversations/${encodeURIComponent(conversationId)}?${query}${perspective === 'owner' ? '&perspective=owner' : ''}`,
  )
}

export function sendMyPublishedConversation(publicId: string, text: string,
  clientMessageId: string, attachmentIds: string[] = []) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(publicId)) throw new Error('invalid_public_id')
  return authApi<{ conversationId: string; messageId: string; sequence: string;
    status: string; idempotent: boolean }>(`/published-agents/${publicId}/messages`, {
    method: 'POST', body: JSON.stringify({ text, clientMessageId, attachmentIds }),
  })
}
