// @covers packages/app/src/features/rooms/roomMessageTimeline.ts

import { describe, expect, it } from 'vitest'
import { shouldShowRoomTimeSeparator } from '../features/rooms/roomMessageTimeline'

describe('Room message timeline', () => {
  it('shows a time before the first valid message', () => {
    expect(shouldShowRoomTimeSeparator('2026-08-29T02:34:00.000Z')).toBe(true)
    expect(shouldShowRoomTimeSeparator('invalid')).toBe(false)
  })

  it('groups nearby messages and separates messages more than five minutes apart', () => {
    expect(
      shouldShowRoomTimeSeparator('2026-08-29T02:39:00.000Z', '2026-08-29T02:34:00.000Z'),
    ).toBe(false)
    expect(
      shouldShowRoomTimeSeparator('2026-08-29T02:39:00.001Z', '2026-08-29T02:34:00.000Z'),
    ).toBe(true)
  })

  it('shows a time when messages cross a local calendar day', () => {
    const previous = new Date(2026, 7, 28, 23, 59).toISOString()
    const current = new Date(2026, 7, 29, 0, 1).toISOString()
    expect(shouldShowRoomTimeSeparator(current, previous)).toBe(true)
  })

  it('recovers by showing a separator after an invalid previous timestamp', () => {
    expect(shouldShowRoomTimeSeparator('2026-08-29T02:34:00.000Z', 'invalid')).toBe(true)
  })
})
