// @covers packages/app/src/features/published-agents/failureCopyKey.ts
// @covers packages/app/src/features/published-agents/directConversationClient.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publishedAgentFailureCopyKey } from '../features/published-agents/failureCopyKey.js'

const { authApi } = vi.hoisted(() => ({ authApi: vi.fn() }))
vi.mock('../config/api', () => ({ authApi }))

import {
  getMyPublishedConversationAttachment,
  listMyPublishedConversations,
  readMyPublishedConversation,
  sendMyPublishedConversation,
} from '../features/published-agents/directConversationClient'

describe('publishedAgentFailureCopyKey', () => {
  it('maps every wire failure code the backend can produce to its copy key', () => {
    expect(publishedAgentFailureCopyKey('timeout')).toBe('timeout')
    expect(publishedAgentFailureCopyKey('empty_reply')).toBe('emptyReply')
    expect(publishedAgentFailureCopyKey('runtime_unavailable')).toBe('runtimeUnavailable')
    expect(publishedAgentFailureCopyKey('provider_limit')).toBe('providerLimit')
    expect(publishedAgentFailureCopyKey('retry_exhausted')).toBe('retryExhausted')
    expect(publishedAgentFailureCopyKey('unauthorized_tool_attempt')).toBe('unauthorizedToolAttempt')
  })

  it('falls back to null for an unknown or missing code, letting the caller pick its own generic text', () => {
    expect(publishedAgentFailureCopyKey('execution_failed')).toBeNull()
    expect(publishedAgentFailureCopyKey(null)).toBeNull()
    expect(publishedAgentFailureCopyKey(undefined)).toBeNull()
    expect(publishedAgentFailureCopyKey('')).toBeNull()
  })
})

describe('published Agent account conversations', () => {
  beforeEach(() => authApi.mockReset())

  it('uses authenticated requests for list, history, and send', () => {
    listMyPublishedConversations()
    readMyPublishedConversation('conversation-1', { before: 'latest' })
    sendMyPublishedConversation('a'.repeat(32), 'hello', 'message-1')

    expect(authApi).toHaveBeenNthCalledWith(1, '/agent-direct-conversations')
    expect(authApi).toHaveBeenNthCalledWith(2, '/agent-direct-conversations/conversation-1?before=latest')
    expect(authApi).toHaveBeenNthCalledWith(3, `/published-agents/${'a'.repeat(32)}/messages`, {
      method: 'POST', body: JSON.stringify({ text: 'hello', clientMessageId: 'message-1', attachmentIds: [] }),
    })
  })

  it('scopes attachment downloads to the exact conversation', () => {
    getMyPublishedConversationAttachment('conversation-1', `datt_${'a'.repeat(36)}`)
    expect(authApi).toHaveBeenCalledWith(
      `/agent-direct-conversations/conversation-1/attachments/datt_${'a'.repeat(36)}/download`,
    )
    expect(() => getMyPublishedConversationAttachment('../other', `datt_${'a'.repeat(36)}`)).toThrow()
  })
})
