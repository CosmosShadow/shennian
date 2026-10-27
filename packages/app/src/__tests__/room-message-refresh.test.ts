// @covers packages/app/src/features/rooms/roomMessageRefresh.ts
// @covers packages/app/src/features/rooms/roomConversationUtils.ts

import { describe, expect, it, vi } from 'vitest'
import type { RoomMessageView } from '@shennian/wire'
import { loadRoomMessageRefresh } from '../features/rooms/roomMessageRefresh'
import { mergeRoomMessages, shouldReportRoomRead } from '../features/rooms/roomConversationUtils'

const message = (sequence: number) => ({ id: `m${sequence}`, sequence: String(sequence) }) as RoomMessageView

describe('Room initial message refresh', () => {
  it('loads a latest window only when there are no cached messages', async () => {
    const page = { messages: [message(90)], hasMore: true }
    const read = vi.fn().mockResolvedValue(page)
    expect(await loadRoomMessageRefresh(read, 'room', '91')).toEqual(page)
    expect(read).toHaveBeenCalledExactlyOnceWith('room', { before: '91', limit: 50 })
  })

  it('catches up every missing page after the cached tail, without replacing history', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ messages: [message(51), message(52)], hasMore: true })
      .mockResolvedValueOnce({ messages: [message(53)], hasMore: false })
    const result = await loadRoomMessageRefresh(read, 'room', '54', '50')
    expect(read.mock.calls.map((call) => call[1])).toEqual([
      { after: '50', limit: 50 }, { after: '52', limit: 50 },
    ])
    // History loaded and a live event received while the request was pending survive.
    const current = [message(1), message(50), message(54)]
    expect(mergeRoomMessages(current, result.messages).map((m) => m.sequence))
      .toEqual(['1', '50', '51', '52', '53', '54'])
    expect(current.map((m) => m.sequence)).toEqual(['1', '50', '54'])
  })

  it('does not reload a cached window when the server has no new messages', async () => {
    const read = vi.fn().mockResolvedValue({ messages: [], hasMore: false })
    const result = await loadRoomMessageRefresh(read, 'room', '51', '50')
    expect(result.messages).toEqual([])
    expect(read).toHaveBeenCalledExactlyOnceWith('room', { after: '50', limit: 50 })
  })

  it('terminates an empty/non-advancing page instead of looping forever', async () => {
    for (const messages of [[], [message(50)]]) {
      const read = vi.fn().mockResolvedValue({ messages, hasMore: true })
      await loadRoomMessageRefresh(read, 'room', '51', '50')
      expect(read).toHaveBeenCalledTimes(1)
    }
  })

  it('propagates refresh errors so cached UI can remain available', async () => {
    const read = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(loadRoomMessageRefresh(read, 'room', '51', '50')).rejects.toThrow('offline')
  })
})

describe('Room read report dedupe', () => {
  it('reports a sequence once per account and room, and again only when it advances', () => {
    const none = { scope: '', sequence: '0' }
    expect(shouldReportRoomRead(none, 'a:room', '10')).toBe(true)
    expect(shouldReportRoomRead({ scope: 'a:room', sequence: '10' }, 'a:room', '10')).toBe(false)
    expect(shouldReportRoomRead({ scope: 'a:room', sequence: '10' }, 'a:room', '9')).toBe(false)
    expect(shouldReportRoomRead({ scope: 'a:room', sequence: '10' }, 'a:room', '11')).toBe(true)
    expect(shouldReportRoomRead({ scope: 'a:room', sequence: '10' }, 'b:room', '10')).toBe(true)
  })
})
