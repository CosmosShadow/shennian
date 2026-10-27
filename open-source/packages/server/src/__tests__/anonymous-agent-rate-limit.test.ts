// @covers open-source/packages/server/src/services/anonymous-agent-rate-limit.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const evalMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/redis.js', () => ({ redis: { eval: evalMock } }))

import { consumeAnonymousAgentRateLimit } from '../services/anonymous-agent-rate-limit.js'

describe('anonymous Agent rate limit', () => {
  beforeEach(() => { vi.clearAllMocks(); evalMock.mockResolvedValue(1) })

  it('does not put the raw IP in a Redis key and separates publications', async () => {
    expect(await consumeAnonymousAgentRateLimit({ publicId: 'pub-a', ip: '1.2.3.4', action: 'start' })).toBe(true)
    const first = evalMock.mock.calls[0][2] as string
    expect(first).not.toContain('1.2.3.4')
    await consumeAnonymousAgentRateLimit({ publicId: 'pub-b', ip: '1.2.3.4', action: 'start' })
    expect(evalMock.mock.calls[1][2]).not.toBe(first)
  })

  it('enforces low creation and send rates and fails closed on Redis errors', async () => {
    evalMock.mockResolvedValueOnce(6).mockResolvedValueOnce(13)
    expect(await consumeAnonymousAgentRateLimit({ publicId: 'pub-a', ip: '1.2.3.4', action: 'start' })).toBe(false)
    expect(await consumeAnonymousAgentRateLimit({ publicId: 'pub-a', ip: '1.2.3.4',
      userId: 'guest-1', action: 'send' })).toBe(false)
    evalMock.mockRejectedValueOnce(new Error('redis unavailable'))
    await expect(consumeAnonymousAgentRateLimit({ publicId: 'pub-a', ip: '1.2.3.4',
      action: 'start' })).rejects.toThrow('redis unavailable')
  })

  it('counts sends against separate IP and visitor limits atomically', async () => {
    await consumeAnonymousAgentRateLimit({ publicId: 'pub-a', ip: '1.2.3.4',
      userId: 'guest-1', action: 'send' })
    const first = evalMock.mock.calls[0]
    expect(first[1]).toBe(2)
    expect(first[2]).not.toBe(first[3])
    await consumeAnonymousAgentRateLimit({ publicId: 'pub-a', ip: '1.2.3.4',
      userId: 'guest-2', action: 'send' })
    expect(evalMock.mock.calls[1][2]).toBe(first[2])
    expect(evalMock.mock.calls[1][3]).not.toBe(first[3])
  })
})
