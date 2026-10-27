// @covers open-source/packages/cli/src/agents/public-agent-client.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('../config/index.js', () => ({
  loadConfig: () => ({
    machineToken: 'test-machine-token',
    serverUrl: 'https://shennian.net',
  }),
}))

import {
  parsePublishedAgentUrl,
  publishedAgentUrl,
  PublicAgentClient,
} from '../agents/public-agent-client.js'

const sharedUrl = `https://shennian.net/p/${'a'.repeat(32)}`

describe('published Agent CLI client', () => {
  it('accepts only an exact shared URL on the configured Shennian origin', () => {
    expect(publishedAgentUrl('a'.repeat(32), 'https://shennian.net')).toBe(sharedUrl)
    expect(parsePublishedAgentUrl(sharedUrl, 'https://shennian.net'))
      .toBe('a'.repeat(32))
    for (const value of [
      `https://evil.example/p/${'a'.repeat(32)}`,
      `https://shennian.net.evil.example/p/${'a'.repeat(32)}`,
      `https://shennian.net/p/${'a'.repeat(32)}?redirect=evil`,
      `https://shennian.net/a/${'a'.repeat(32)}`,
      'https://shennian.net/p/bad',
    ]) {
      expect(() => parsePublishedAgentUrl(value, 'https://shennian.net'))
        .toThrowError('Use a Shennian published Agent URL.')
    }
  })

  it('returns the exact share URL only for an activated owner publication', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        publication: { status: 'draft', generation: 1 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        publication: { status: 'active', publicId: 'a'.repeat(32), generation: 1 },
      }), { status: 200 }))
    const client = new PublicAgentClient(fetchMock as typeof fetch)
    expect((await client.getPublication('agent-1')).publication).not.toHaveProperty('shareUrl')
    expect((await client.getPublication('agent-1')).publication).toMatchObject({ shareUrl: sharedUrl })
  })

  it('sends the paired identity only to its configured Server API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      conversationId: 'conversation-1', messageId: 'message-1',
      sequence: '1', status: 'pending', idempotent: false,
    }), { status: 202, headers: { 'content-type': 'application/json' } }))
    const client = new PublicAgentClient(fetchMock as typeof fetch)
    const result = await client.sendPublishedAgent(sharedUrl, {
      text: '你好', clientMessageId: 'request-1',
    })
    expect(result).toMatchObject({ status: 'pending', conversationId: 'conversation-1' })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://shennian.net/api/published-agents/${'a'.repeat(32)}/messages`,
      expect.objectContaining({
        method: 'POST', redirect: 'error',
        headers: expect.objectContaining({ authorization: 'Bearer test-machine-token' }),
      }),
    )
  })

  it('never sends a paired token to an external URL', async () => {
    const fetchMock = vi.fn()
    const client = new PublicAgentClient(fetchMock as typeof fetch)
    expect(() => client.openPublishedAgent(`https://evil.example/p/${'a'.repeat(32)}`))
      .toThrowError('Use a Shennian published Agent URL.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens only the exact public Agent on the paired service', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ publication: {
      displayName: 'Public agent', status: 'active',
    } }), { status: 200 }))
    const client = new PublicAgentClient(fetchMock as typeof fetch)
    await expect(client.openPublishedAgent(sharedUrl)).resolves.toMatchObject({
      publication: { displayName: 'Public agent' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://shennian.net/api/published-agents/${'a'.repeat(32)}`,
      expect.objectContaining({ method: 'GET', redirect: 'error',
        headers: expect.objectContaining({ authorization: 'Bearer test-machine-token' }) }),
    )
  })

  it('uses the paired identity to list its own history without a share URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      conversations: [], nextCursor: null,
    }), { status: 200 }))
    const client = new PublicAgentClient(fetchMock as typeof fetch)
    await client.listMyDirectConversations('conversation-1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://shennian.net/api/agent-direct-conversations?cursor=conversation-1',
      expect.objectContaining({
        method: 'GET', redirect: 'error',
        headers: expect.objectContaining({ authorization: 'Bearer test-machine-token' }),
      }),
    )
  })

  it('reads latest history first and keeps older/newer cursors separate', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      conversation: null, messages: [], nextBefore: null,
    }), { status: 200 })))
    const client = new PublicAgentClient(fetchMock as typeof fetch)
    await client.readPublishedAgent(sharedUrl)
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://shennian.net/api/published-agents/${'a'.repeat(32)}/conversation?before=latest`)
    await client.readPublishedAgent(sharedUrl, { before: '101' })
    expect(fetchMock.mock.calls[1]![0]).toBe(
      `https://shennian.net/api/published-agents/${'a'.repeat(32)}/conversation?before=101`)
    await client.readPublishedAgent(sharedUrl, { after: '200' })
    expect(fetchMock.mock.calls[2]![0]).toBe(
      `https://shennian.net/api/published-agents/${'a'.repeat(32)}/conversation?after=200`)
    await client.readDirectConversation('conversation-1')
    expect(fetchMock.mock.calls[3]![0]).toBe(
      'https://shennian.net/api/agent-direct-conversations/conversation-1?before=latest')
    expect(() => client.readPublishedAgent(sharedUrl, { after: '200', before: '101' }))
      .toThrowError('Use --after or --before, not both.')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
