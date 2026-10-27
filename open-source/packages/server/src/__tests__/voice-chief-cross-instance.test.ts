// @covers open-source/packages/server/src/services/voice-chief-runtime.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pubsubMock } = vi.hoisted(() => ({
  pubsubMock: {
    isActive: true,
    subscribeVoiceChiefConversation: vi.fn(),
    publishVoiceChiefConversation: vi.fn(),
  },
}))

vi.mock('../relay/pubsub.js', () => ({ pubsub: pubsubMock }))

import {
  routeVoiceChiefAgentEvent,
  subscribeVoiceChiefConversation,
} from '../services/voice-chief-runtime.js'

describe('voice chief cross-instance bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pubsubMock.isActive = true
    pubsubMock.subscribeVoiceChiefConversation.mockReturnValue(vi.fn())
  })

  it('publishes every daemon agent frame to the session-specific channel', () => {
    const payload = { state: 'delta', sessionId: 'conversation-1', runId: 'run-1', text: '完成' }

    routeVoiceChiefAgentEvent(payload)

    expect(pubsubMock.publishVoiceChiefConversation).toHaveBeenCalledWith(
      'conversation-1',
      JSON.stringify(payload),
    )
  })

  it('reassembles frames received on the Voice socket holder and emits once', () => {
    const subscriber = vi.fn()
    const unsubscribe = subscribeVoiceChiefConversation('conversation-2', subscriber)
    const transportHandler = pubsubMock.subscribeVoiceChiefConversation.mock.calls[0]?.[1]
    expect(transportHandler).toBeTypeOf('function')

    transportHandler(
      JSON.stringify({
        state: 'start',
        sessionId: 'conversation-2',
        runId: 'run-2',
      }),
    )
    transportHandler(
      JSON.stringify({
        state: 'delta',
        sessionId: 'conversation-2',
        runId: 'run-2',
        text: '跨实例',
      }),
    )
    transportHandler(
      JSON.stringify({
        state: 'final',
        sessionId: 'conversation-2',
        runId: 'run-2',
      }),
    )

    expect(subscriber).toHaveBeenCalledOnce()
    expect(subscriber).toHaveBeenCalledWith({
      conversationId: 'conversation-2',
      runId: 'run-2',
      text: '跨实例',
      state: 'final',
    })
    unsubscribe()
  })

  it('shares one transport subscription across local listeners without duplicate delivery', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeVoiceChiefConversation('conversation-3', first)
    const unsubscribeSecond = subscribeVoiceChiefConversation('conversation-3', second)
    const transportHandler = pubsubMock.subscribeVoiceChiefConversation.mock.calls[0]?.[1]

    expect(pubsubMock.subscribeVoiceChiefConversation).toHaveBeenCalledOnce()
    transportHandler(
      JSON.stringify({
        state: 'start',
        sessionId: 'conversation-3',
        runId: 'run-3',
      }),
    )
    transportHandler(
      JSON.stringify({
        state: 'delta',
        sessionId: 'conversation-3',
        runId: 'run-3',
        text: '一次',
      }),
    )
    transportHandler(
      JSON.stringify({
        state: 'final',
        sessionId: 'conversation-3',
        runId: 'run-3',
      }),
    )

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    unsubscribeFirst()
    unsubscribeSecond()
  })
})
