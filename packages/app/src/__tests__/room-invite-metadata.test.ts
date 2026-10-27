// @covers packages/app/src/features/rooms/roomInviteMetadata.ts

import { describe, expect, it } from 'vitest'
import { formatRoomInviteGeneratedAt } from '../features/rooms/roomInviteMetadata'

describe('Room invitation metadata', () => {
  it('formats a valid creation time in the requested locale', () => {
    const value = formatRoomInviteGeneratedAt('2026-09-04T10:58:00.000Z', 'en-US')

    expect(value).toContain('2026')
    expect(value).toMatch(/Sep|09/)
    expect(value).toContain('4')
  })

  it('omits missing or invalid timestamps for rolling deployment compatibility', () => {
    expect(formatRoomInviteGeneratedAt(undefined, 'zh-CN')).toBe('')
    expect(formatRoomInviteGeneratedAt('not-a-date', 'zh-CN')).toBe('')
  })
})
