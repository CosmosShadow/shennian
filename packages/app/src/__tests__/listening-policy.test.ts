// @covers src/features/personal-modules/listeningContext.ts
import { describe, expect, it } from 'vitest'
import { boundedListeningContext } from '../features/personal-modules/listeningContext'
import type { ChatMessage } from '@shennian/shared'
describe('opt-in bounded conversation reference', () => {
  it('keeps only recent visible delivered text with a bounded budget', () => {
    const now = 2000000
    const message = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
      id: 'm',
      role: 'user',
      ts: now - 10,
      content: 'x'.repeat(800),
      ...patch,
    })
    const input = [
      message({ ts: 0 }),
      message({ divider: 'new' }),
      message({ thinking: 'private', toolCalls: [{} as never] }),
      message({ deliveryState: 'sending' }),
      ...Array.from({ length: 8 }, (_, n) => message({ id: String(n) })),
    ]
    const result = boundedListeningContext(input, now)
    expect(result.length).toBe(4)
    expect(result.map((m) => m.text).join('').length).toBe(2400)
    expect(result.every((m) => !('thinking' in m) && !('toolCalls' in m))).toBe(true)
    expect(
      boundedListeningContext([message({ ts: now + 1 }), message({ error: {} as never })], now),
    ).toEqual([])
  })
})
