// @covers open-source/packages/cli/src/agents/public-delivery-client.ts

import { describe, expect, it, vi } from 'vitest'
import { HttpPublicAgentDeliveryClient } from '../agents/public-delivery-client.js'

const claim = {
  messageId: 'message-1', conversationId: 'conversation-1',
  agentIdentityId: 'agent-1', runtimeAdapter: 'codex',
  executableFingerprint: `sha256:${'a'.repeat(64)}`,
  bindingId: 'binding-1', bindingEpoch: 1, sequence: '1', text: 'hello',
  leaseToken: 'x'.repeat(43), leaseExpiresAt: '2026-09-26T00:10:00Z',
}

describe('public Agent delivery client', () => {
  it('keeps the paired machine token in the header and validates the claim', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ claim }), { status: 200 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net/', fetchImpl as typeof fetch)
    await expect(client.claim('machine-secret')).resolves.toEqual(claim)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://shennian.net/api/agent-direct-delivery/claim')
    expect(init.headers).toMatchObject({ authorization: 'Bearer machine-secret' })
    expect(init.redirect).toBe('error')
    expect(init.body).not.toContain('machine-secret')
  })

  it('rejects a malformed claim rather than routing a turn to another Agent', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      claim: { ...claim, bindingEpoch: 0 },
    }), { status: 200 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(client.claim('machine-secret')).rejects.toMatchObject({
      code: 'public_agent_delivery_invalid_response',
    })
  })

  it.each([
    { conversationId: '../owner-private' },
    { agentIdentityId: '' },
    { text: 'x'.repeat(20_001) },
    { text: '   ' },
    { runtimeAdapter: 'x'.repeat(65) },
    { executableFingerprint: 'sha256:missing' },
    { sequence: 1 },
  ])('rejects a claim outside the public delivery contract: %j', async (change) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      claim: { ...claim, ...change },
    }), { status: 200 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(client.claim('machine-secret')).rejects.toMatchObject({
      code: 'public_agent_delivery_invalid_response',
    })
  })

  it('completes only the exact claimed turn and returns an idempotent result', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      replyMessageId: 'reply-1', sequence: '2', idempotent: true,
    }), { status: 200 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(client.complete({ machineToken: 'machine-secret', claim,
      replyText: 'answer' })).resolves.toEqual({ replyMessageId: 'reply-1',
      sequence: '2', idempotent: true })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      messageId: 'message-1', conversationId: 'conversation-1',
      bindingEpoch: 1, leaseToken: claim.leaseToken, replyText: 'answer',
    })
    expect(init.body).not.toContain('machine-secret')
  })

  it('sends the optional pause flag only for this claimed conversation', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      replyMessageId: 'reply-1', sequence: '2', idempotent: false,
    }), { status: 200 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    await client.complete({ machineToken: 'machine-secret', claim,
      replyText: 'This chat is paused.', pauseConversation: true })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      conversationId: 'conversation-1', messageId: 'message-1', pauseConversation: true,
    })
  })

  it('retries a lost completion response using the identical canonical message and lease', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('connection reset after commit'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        replyMessageId: 'room-message-reply', sequence: '18', idempotent: true,
      }), { status: 200 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    const canonicalClaim = { ...claim, conversationId: 'room-canonical',
      messageId: 'room-message-visitor', sequence: '17' }
    await expect(client.complete({ machineToken: 'machine-secret', claim: canonicalClaim,
      replyText: 'answer' })).resolves.toEqual({
      replyMessageId: 'room-message-reply', sequence: '18', idempotent: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [firstUrl, firstRequest] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const [secondUrl, secondRequest] = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(secondUrl).toBe(firstUrl)
    expect(secondRequest.body).toBe(firstRequest.body)
    expect(JSON.parse(firstRequest.body as string)).toMatchObject({
      conversationId: 'room-canonical', messageId: 'room-message-visitor',
      bindingEpoch: 1, leaseToken: claim.leaseToken,
    })
  })

  it('does not retry a stale lease as if it were a lost acknowledgement', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: 'agent_direct_delivery_stale',
    }), { status: 409 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(client.complete({ machineToken: 'machine-secret', claim,
      replyText: 'answer' })).rejects.toMatchObject({ code: 'agent_direct_delivery_stale' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a running lease is revoked or the response is malformed', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: 'agent_direct_delivery_stale',
    }), { status: 409 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(client.checkLease({ machineToken: 'machine-secret', claim }))
      .rejects.toMatchObject({ code: 'agent_direct_delivery_stale' })
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ valid: false }), { status: 200 }))
    await expect(client.checkLease({ machineToken: 'machine-secret', claim }))
      .rejects.toMatchObject({ code: 'public_agent_delivery_invalid_response' })
  })

  it('rejects a binding response that switches the private Session', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      bindingId: 'binding-1', bindingEpoch: 1, nianSessionId: 'other-session',
    }), { status: 200 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(client.bindSession({ machineToken: 'machine-secret', claim,
      nianSessionId: 'session-1' })).rejects.toMatchObject({
      code: 'public_agent_delivery_invalid_response',
    })
  })

  it('accepts only the exact directory and binding returned for Session preparation', async () => {
    const workDir = '/tmp/published-agents/conversation-1'
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      nianSessionId: 'session-1', bindingId: 'binding-1', bindingEpoch: 1,
      workDir, nativeSessionId: null,
    }), { status: 200 }))
    const client = new HttpPublicAgentDeliveryClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(client.prepareSession({ machineToken: 'machine-secret', claim,
      workDir })).resolves.toEqual({ nianSessionId: 'session-1',
      bindingId: 'binding-1', bindingEpoch: 1, workDir, nativeSessionId: null })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      conversationId: 'conversation-1', bindingEpoch: 1, workDir,
    })
  })
})
