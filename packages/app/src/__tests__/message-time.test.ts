// @covers packages/app/src/components/chat/messageTime.ts

import { describe, expect, it } from 'vitest'
import { formatMessageTime } from '../components/chat/messageTime'

describe('message time formatting', () => {
  const now = new Date(2026, 7, 29, 19, 3).getTime()

  it('shows only the clock time for today', () => {
    expect(formatMessageTime(new Date(2026, 7, 29, 9, 37).getTime(), { now })).toBe('09:37')
  })

  it('labels yesterday and preserves the clock time', () => {
    expect(
      formatMessageTime(new Date(2026, 7, 28, 21, 40).getTime(), {
        now,
        yesterdayLabel: 'Yesterday',
      }),
    ).toBe('Yesterday 21:40')
  })

  it('shows month and day for older messages in the same year', () => {
    expect(formatMessageTime(new Date(2026, 6, 2, 17, 2).getTime(), { now })).toBe('07/02 17:02')
  })

  it('shows the full date for messages from another year', () => {
    expect(formatMessageTime(new Date(2025, 6, 2, 12, 2).getTime(), { now })).toBe(
      '2025/07/02 12:02',
    )
  })
})
