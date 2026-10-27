// @covers docs/features/contact-and-reviews.md
import { describe, expect, it, vi } from 'vitest'
import { joinOfficialRoom } from '../features/contact/joinOfficialRoom'

describe('official support room entry', () => {
  it('opens existing membership without joining again', async () => {
    const request = vi.fn().mockResolvedValue({ entryState: 'joined', roomId: 'room' })
    expect(await joinOfficialRoom({ exchange: request, join: request }, 'room', 'invite')).toEqual({
      outcome: 'joined',
      roomId: 'room',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('exchanges invitation before joining an open room', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        entryState: 'can_join',
        joinHandle: 'handle',
        invite: { room: { id: 'room', joinPolicy: 'open' } },
      })
      .mockResolvedValueOnce({ outcome: 'joined', roomId: 'room' })
    expect(await joinOfficialRoom({ exchange: request, join: request }, 'room', 'invite')).toEqual({
      outcome: 'joined',
      roomId: 'room',
    })
    expect(request.mock.calls[1]).toEqual([
      { joinHandle: 'handle' },
    ])
  })
  it.each(['approval', 'closed'])(
    'preserves %s policy without auto-joining',
    async (joinPolicy) => {
      const request = vi
        .fn()
        .mockResolvedValue({
          entryState: 'can_join',
          joinHandle: 'handle',
          invite: { room: { id: 'room', joinPolicy } },
        })
      expect((await joinOfficialRoom({ exchange: request, join: request }, 'room', 'invite')).outcome).toBe('invite')
      expect(request).toHaveBeenCalledTimes(1)
    },
  )
  it('does not resubmit a pending request', async () => {
    const request = vi.fn().mockResolvedValue({ entryState: 'pending_approval' })
    expect((await joinOfficialRoom({ exchange: request, join: request }, 'room', 'invite')).outcome).toBe('pending_approval')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('does not join a different room', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        entryState: 'can_join',
        joinHandle: 'handle',
        invite: { room: { id: 'other', joinPolicy: 'open' } },
      })
    await expect(joinOfficialRoom({ exchange: request, join: request }, 'room', 'invite')).rejects.toThrow('invalid_invite')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('surfaces full rooms and network failures for retry', async () => {
    const request = vi.fn().mockRejectedValue(new Error('room_full'))
    await expect(joinOfficialRoom({ exchange: request, join: request }, 'room', 'invite')).rejects.toThrow('room_full')
  })
})
