// @covers open-source/packages/server/src/services/machine-removal.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    machine: { findFirst: vi.fn(), update: vi.fn() },
    roomMembership: { updateMany: vi.fn() },
    roomBinding: { findMany: vi.fn(), updateMany: vi.fn() },
    machineGrant: { deleteMany: vi.fn() },
    qrSession: { deleteMany: vi.fn() },
  }
  return {
    txMock: tx,
    prismaMock: {
      $transaction: vi.fn(async (fn: (transaction: typeof tx) => unknown) => fn(tx)),
    },
  }
})

const { redisMock, machineSocket, clientSocket, connectionsMock, pubsubMock, broadcastMock } = vi.hoisted(() => ({
  redisMock: { del: vi.fn() },
  machineSocket: { close: vi.fn() },
  clientSocket: { close: vi.fn() },
  connectionsMock: {
    getMachine: vi.fn(),
    getClients: vi.fn(),
    removeMachine: vi.fn(),
    broadcastToClientsOfUser: vi.fn(),
    revokeAllMachineAccess: vi.fn(),
  },
  pubsubMock: { isActive: false, publishToUser: vi.fn(), publishConnectionControl: vi.fn() },
  broadcastMock: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../lib/redis.js', () => ({ redis: redisMock }))
vi.mock('../relay/connections.js', () => ({ connections: connectionsMock }))
vi.mock('../relay/pubsub.js', () => ({ pubsub: pubsubMock }))
vi.mock('../services/room-events.js', () => ({ broadcastRoomEvent: broadcastMock }))

import { removeOwnedMachine } from '../services/machine-removal.js'

describe('removeOwnedMachine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.del.mockResolvedValue(1)
    prismaMock.$transaction.mockImplementation(
      async (fn: (transaction: typeof txMock) => unknown) => fn(txMock),
    )
    txMock.machine.findFirst.mockResolvedValue({
      id: 'machine-1', paired: true, online: true, machineToken: 'token', pairToken: null,
    })
    txMock.roomBinding.findMany.mockResolvedValue([
      { id: 'binding-1', roomId: 'room-1', agentMembershipId: 'member-1' },
      { id: 'binding-2', roomId: 'room-2', agentMembershipId: 'member-2' },
    ])
    connectionsMock.getMachine.mockReturnValue(machineSocket)
    connectionsMock.getClients.mockReturnValue(new Set([clientSocket]))
  })

  it('atomically revokes credentials and ends dependent memberships while preserving identities and history', async () => {
    const result = await removeOwnedMachine('machine-1', 'owner-1')

    expect(txMock.machine.findFirst).toHaveBeenCalledWith({
      where: { id: 'machine-1', userId: 'owner-1' },
      select: {
        id: true, paired: true, online: true, machineToken: true, pairToken: true,
      },
    })
    expect(txMock.roomBinding.findMany).toHaveBeenCalledWith({
      where: { machineId: 'machine-1', userId: 'owner-1', OR: [
        { status: { in: ['pending_approval', 'active', 'paused'] } },
        { status: 'detached', agentMembership: { status: 'active' } },
      ] },
      select: { id: true, roomId: true, agentMembershipId: true },
    })
    expect(txMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['binding-1', 'binding-2'] } },
      data: {
        status: 'detached',
        detachedReason: 'machine_removed',
        recoveryIntentId: null,
        recoveryLeaseUntil: null,
        recoveryErrorCode: null,
        capabilityEpoch: { increment: 1 },
      },
    })
    expect(txMock.machine.update).toHaveBeenCalledWith({
      where: { id: 'machine-1' },
      data: { paired: false, online: false, machineToken: null, pairToken: null },
    })
    expect(txMock.roomMembership.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['member-1', 'member-2'] }, ownerUserId: 'owner-1', principalType: 'agent', status: 'active' },
      data: { status: 'left', removedAt: expect.any(Date) },
    })
    expect((txMock as Record<string, unknown>).agentIdentity).toBeUndefined()
    expect((txMock as Record<string, unknown>).roomMessage).toBeUndefined()
    expect(result).toEqual({
      affectedBindingIds: ['binding-1', 'binding-2'],
      affectedRoomIds: ['room-1', 'room-2'],
      idempotent: false,
    })
  })

  it('closes stale relay paths and broadcasts compact refresh events after revocation', async () => {
    await removeOwnedMachine('machine-1', 'owner-1')

    expect(machineSocket.close).toHaveBeenCalledWith(4403, 'machine_removed')
    expect(clientSocket.close).toHaveBeenCalledWith(4403, 'machine_removed')
    expect(connectionsMock.removeMachine).toHaveBeenCalledWith('machine-1')
    expect(redisMock.del).toHaveBeenCalledWith('machine:machine-1:region')
    expect(connectionsMock.broadcastToClientsOfUser).toHaveBeenCalledWith(
      'owner-1',
      expect.stringContaining('machine.removed'),
    )
    expect(broadcastMock).toHaveBeenCalledWith('room-1', {
      event: 'room.binding.updated', roomId: 'room-1', entityId: 'binding-1',
    })
    expect(broadcastMock).toHaveBeenCalledWith('room-2', {
      event: 'room.binding.updated', roomId: 'room-2', entityId: 'binding-2',
    })
  })

  it('is idempotent when the machine is no longer owned by the caller', async () => {
    txMock.machine.findFirst.mockResolvedValue(null)

    await expect(removeOwnedMachine('machine-1', 'owner-1')).resolves.toBeNull()
    expect(txMock.roomBinding.updateMany).not.toHaveBeenCalled()
    expect(connectionsMock.removeMachine).not.toHaveBeenCalled()
  })

  it('does not rebroadcast a repeated removal of the same stable machine', async () => {
    txMock.machine.findFirst.mockResolvedValue({
      id: 'machine-1', paired: false, online: false, machineToken: null, pairToken: null,
    })

    await expect(removeOwnedMachine('machine-1', 'owner-1')).resolves.toEqual({
      affectedBindingIds: [],
      affectedRoomIds: [],
      idempotent: true,
    })
    expect(txMock.roomBinding.findMany).not.toHaveBeenCalled()
    expect(txMock.machine.update).not.toHaveBeenCalled()
    expect(connectionsMock.broadcastToClientsOfUser).not.toHaveBeenCalled()
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('converges after a serializable conflict from concurrent removal', async () => {
    prismaMock.$transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (fn: (transaction: typeof txMock) => unknown) => fn(txMock))

    await expect(removeOwnedMachine('machine-1', 'owner-1')).resolves.toMatchObject({
      affectedBindingIds: ['binding-1', 'binding-2'],
      idempotent: false,
    })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2)
  })

  it('detaches every Agent across Rooms while de-duplicating Room refresh targets', async () => {
    txMock.roomBinding.findMany.mockResolvedValue([
      { id: 'binding-1', roomId: 'room-1', agentMembershipId: 'member-1' },
      { id: 'binding-2', roomId: 'room-1' },
      { id: 'binding-3', roomId: 'room-2' },
    ])

    await expect(removeOwnedMachine('machine-1', 'owner-1')).resolves.toMatchObject({
      affectedBindingIds: ['binding-1', 'binding-2', 'binding-3'],
      affectedRoomIds: ['room-1', 'room-2'],
    })
    expect(txMock.roomBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['binding-1', 'binding-2', 'binding-3'] } },
      data: expect.not.objectContaining({ activationMode: expect.anything() }),
    }))
  })

  it('still tears down the old socket when refresh delivery fails after commit', async () => {
    connectionsMock.broadcastToClientsOfUser.mockImplementationOnce(() => {
      throw new Error('relay unavailable')
    })

    await expect(removeOwnedMachine('machine-1', 'owner-1')).resolves.toMatchObject({
      idempotent: false,
    })
    expect(machineSocket.close).toHaveBeenCalledWith(4403, 'machine_removed')
    expect(connectionsMock.removeMachine).toHaveBeenCalledWith('machine-1')
  })
})
