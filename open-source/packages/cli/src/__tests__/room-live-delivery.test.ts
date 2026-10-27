// @covers open-source/packages/cli/src/room/live-delivery.ts

import { describe, expect, it, vi } from 'vitest'
import { handleLiveRoomDelivery, parseRoomMessage } from '../room/live-delivery.js'

const message = {
  id: 'message_1',
  roomId: 'room_1',
  sequence: '7',
  kind: 'text',
  author: {
    membershipId: 'membership_1',
    principalType: 'human',
    ownerUserId: 'user_1',
    displayName: '李辰',
  },
  text: '请检查实时投递',
  attachments: [],
  createdAt: '2026-09-17T02:03:04.000Z',
} as const

describe('managed Room live delivery', () => {
  it('ACKs only after the local mirror accepts the full committed message', async () => {
    const sendRes = vi.fn()
    const deliverLive = vi.fn(async () => ({ accepted: true, registrationCount: 1 }))

    await handleLiveRoomDelivery(
      { sendRes } as never,
      { deliverLive } as never,
      { type: 'req', id: 'delivery_1', method: 'room.message.deliver', params: { message } } as never,
    )

    expect(deliverLive).toHaveBeenCalledWith(message)
    expect(deliverLive.mock.invocationCallOrder[0]).toBeLessThan(sendRes.mock.invocationCallOrder[0]!)
    expect(sendRes).toHaveBeenCalledWith({
      type: 'res',
      id: 'delivery_1',
      ok: true,
      payload: { accepted: true, registrationCount: 1 },
    })
  })

  it('rejects malformed or unavailable delivery without acknowledging success', async () => {
    expect(() => parseRoomMessage({ ...message, sequence: '-1' })).toThrow('invalid_room_delivery')
    const sendRes = vi.fn()
    await handleLiveRoomDelivery(
      { sendRes } as never,
      null,
      { type: 'req', id: 'delivery_2', method: 'room.message.deliver', params: { message } } as never,
    )
    expect(sendRes).toHaveBeenCalledWith({
      type: 'res', id: 'delivery_2', ok: false, error: 'room_delivery_unavailable',
    })
  })
})
