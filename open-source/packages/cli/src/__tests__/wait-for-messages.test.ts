// @covers src/room/wait-for-messages.ts
import { describe, expect, it, vi } from 'vitest'
import { parseWaitTimeout, waitForMessages } from '../room/wait-for-messages.js'

describe('bounded Room reply wait', () => {
  it('returns the first new page after the exact cursor', async () => {
    const read = vi.fn().mockResolvedValueOnce({ messages: [] })
      .mockResolvedValueOnce({ messages: [{ sequence: '12', text: '回复' }] })
    vi.useFakeTimers()
    try {
      const pending = waitForMessages(read, '11', 10)
      await vi.advanceTimersByTimeAsync(2000)
      await expect(pending).resolves.toEqual({
        messages: [{ sequence: '12', text: '回复' }], timedOut: false, after: '11',
      })
      expect(read).toHaveBeenCalledTimes(2)
      expect(read).toHaveBeenNthCalledWith(2, '11')
    } finally { vi.useRealTimers() }
  })

  it('times out without inventing a reply', async () => {
    vi.useFakeTimers()
    try {
      const pending = waitForMessages(async () => ({ messages: [] }), '5', 1)
      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toEqual({ messages: [], timedOut: true, after: '5' })
    } finally { vi.useRealTimers() }
  })

  it('limits each wait to one minute', () => {
    expect(parseWaitTimeout('60')).toBe(60)
    expect(() => parseWaitTimeout('0')).toThrow('invalid_wait_timeout')
    expect(() => parseWaitTimeout('61')).toThrow('invalid_wait_timeout')
  })
})
