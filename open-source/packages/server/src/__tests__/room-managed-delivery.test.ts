// @covers open-source/packages/server/src/services/room-managed-delivery.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, send } = vi.hoisted(() => ({
  findMany: vi.fn(),
  send: vi.fn(async () => ({ type: 'res', id: 'delivery', ok: true })),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: { roomBinding: { findMany } },
}))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: send }))

import { deliverRoomMessageToManagedMachines } from '../services/room-managed-delivery.js'

const message = {
  id: 'message_1',
  roomId: 'room_1',
  sequence: '8',
  kind: 'text',
  author: { membershipId: 'membership_1', principalType: 'human', ownerUserId: 'user_1', displayName: '李辰' },
  text: '实时消息',
  attachments: [],
  createdAt: '2026-09-17T02:03:04.000Z',
} as const

describe('server managed Room delivery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pushes the full committed message once per capable paired machine', async () => {
    findMany.mockResolvedValue([
      { machineId: 'machine_1', machine: { sessionSyncCapabilities: ['room_message_delivery_v1'] } },
      { machineId: 'machine_1', machine: { sessionSyncCapabilities: ['room_message_delivery_v1'] } },
      { machineId: 'machine_old', machine: { sessionSyncCapabilities: [] } },
    ])

    await deliverRoomMessageToManagedMachines('room_1', message)

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        roomId: 'room_1',
        status: 'active',
        activationMode: { not: 'paused' },
        activationCapability: 'managed',
        machine: { paired: true },
      },
    }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('machine_1', {
      type: 'req', method: 'room.message.deliver', params: { message },
    }, 10_000)
  })

  it('keeps one failed machine from blocking delivery to its siblings', async () => {
    findMany.mockResolvedValue([
      { machineId: 'machine_1', machine: { sessionSyncCapabilities: ['room_message_delivery_v1'] } },
      { machineId: 'machine_2', machine: { sessionSyncCapabilities: ['room_message_delivery_v1'] } },
    ])
    send.mockRejectedValueOnce(new Error('offline'))

    await expect(deliverRoomMessageToManagedMachines('room_1', message)).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('returns after socket dispatch without waiting for the daemon ACK timeout', async () => {
    findMany.mockResolvedValue([
      { machineId: 'machine_1', machine: { sessionSyncCapabilities: ['room_message_delivery_v1'] } },
    ])
    send.mockImplementationOnce(() => new Promise(() => {}))

    await expect(deliverRoomMessageToManagedMachines('room_1', message)).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledOnce()
  })
})
