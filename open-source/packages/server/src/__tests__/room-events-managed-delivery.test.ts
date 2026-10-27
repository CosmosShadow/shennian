// @covers open-source/packages/server/src/services/room-events.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  broadcastBrowser: vi.fn(),
  deliverManaged: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: { roomMembership: { findMany: mocks.findMany } },
}))
vi.mock('../relay/connections.js', () => ({
  connections: { broadcastToClientsOfUser: vi.fn() },
}))
vi.mock('../relay/pubsub.js', () => ({
  pubsub: { isActive: false, publishToUser: vi.fn() },
}))
vi.mock('../services/room-browser-events.js', () => ({
  broadcastRoomBrowserEvent: mocks.broadcastBrowser,
}))
vi.mock('../services/room-managed-delivery.js', () => ({
  deliverRoomMessageToManagedMachines: mocks.deliverManaged,
}))

import { broadcastRoomEvent } from '../services/room-events.js'

const message = {
  id: 'event_1',
  roomId: 'room_1',
  sequence: '6',
  kind: 'system' as const,
  source: 'system' as const,
  author: {
    membershipId: 'member_human',
    principalType: 'human' as const,
    ownerUserId: 'user_1',
    displayName: '李辰',
  },
  text: '李辰 changed the group chat name to “研发群”.',
  attachments: [],
  createdAt: '2026-09-22T10:00:00.000Z',
  systemEvent: { type: 'room_renamed' as const },
}

describe('Room event managed delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findMany.mockResolvedValue([])
    mocks.deliverManaged.mockResolvedValue(undefined)
  })

  it('finishes managed target discovery and dispatch before returning', async () => {
    let release!: () => void
    mocks.deliverManaged.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve }),
    )
    let completed = false
    const broadcasting = broadcastRoomEvent('room_1', {
      event: 'room.message.created',
      roomId: 'room_1',
      sequence: '6',
      message,
    }).then(() => { completed = true })

    await vi.waitFor(() => expect(mocks.deliverManaged).toHaveBeenCalledWith('room_1', message))
    expect(completed).toBe(false)
    release()
    await broadcasting
    expect(completed).toBe(true)
  })
})
