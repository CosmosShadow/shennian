// @covers open-source/packages/shared/src/lib/room-unread.ts

import { describe, expect, it } from 'vitest'
import { applyIncomingRoomMessageUnread, isOwnHumanRoomMessage } from '../lib/room-unread'

const message = (sequence: string, principalType: 'human' | 'agent', ownerUserId: string) => ({
  sequence,
  author: { membershipId: 'm', principalType, ownerUserId, displayName: 'x' },
})

describe('Room unread projection for live messages', () => {
  it('treats only the account\'s own human messages as its own', () => {
    expect(isOwnHumanRoomMessage(message('3', 'human', 'me'), 'me')).toBe(true)
    expect(isOwnHumanRoomMessage(message('3', 'human', 'other'), 'me')).toBe(false)
    // An Agent owned by the account still speaks to the human and must stay readable.
    expect(isOwnHumanRoomMessage(message('3', 'agent', 'me'), 'me')).toBe(false)
    expect(isOwnHumanRoomMessage(message('3', 'human', 'me'), null)).toBe(false)
  })

  it('does not raise unread for the sender\'s own message after they had read everything', () => {
    expect(applyIncomingRoomMessageUnread(
      { lastReadSequence: '9', lastSequence: '9', unreadCount: 0 },
      message('10', 'human', 'me'),
      'me',
    )).toEqual({ lastReadSequence: '10', unreadCount: 0 })
  })

  it('keeps earlier unread messages unread when the sender writes on top of them', () => {
    expect(applyIncomingRoomMessageUnread(
      { lastReadSequence: '7', lastSequence: '9', unreadCount: 1 },
      message('10', 'human', 'me'),
      'me',
    )).toEqual({ lastReadSequence: '7', unreadCount: 1 })
  })

  it('stays unread when a newer message from someone else is already known', () => {
    expect(applyIncomingRoomMessageUnread(
      { lastReadSequence: '6', lastSequence: '8', unreadCount: 1 },
      message('7', 'human', 'me'),
      'me',
    )).toEqual({ lastReadSequence: '7', unreadCount: 1 })
  })

  it('still raises unread for other people and for the account\'s own Agents', () => {
    const current = { lastReadSequence: '9', lastSequence: '9', unreadCount: 0 }
    expect(applyIncomingRoomMessageUnread(current, message('10', 'human', 'other'), 'me'))
      .toEqual({ lastReadSequence: '9', unreadCount: 1 })
    expect(applyIncomingRoomMessageUnread(current, message('10', 'agent', 'me'), 'me'))
      .toEqual({ lastReadSequence: '9', unreadCount: 1 })
  })

  it('treats a missing watermark as nothing read', () => {
    expect(applyIncomingRoomMessageUnread(
      { lastSequence: '4' },
      message('5', 'human', 'other'),
      'me',
    )).toEqual({ lastReadSequence: undefined, unreadCount: 1 })
  })
})
