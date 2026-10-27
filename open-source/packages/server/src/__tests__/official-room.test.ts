// @covers open-source/packages/server/src/services/official-room.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  createRoomWithOwner: vi.fn(),
  getCanonicalRoomInvite: vi.fn(),
  withDistributedLease: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/room-core.js', () => ({ createRoomWithOwner: mocks.createRoomWithOwner }))
vi.mock('../services/room-membership.js', () => ({
  getCanonicalRoomInvite: mocks.getCanonicalRoomInvite,
}))
vi.mock('../services/distributed-lease.js', () => ({
  withDistributedLease: mocks.withDistributedLease,
}))

import { resolveOfficialRoom } from '../services/official-room.js'

function room(sequence: number, humanCount: number, token = `token-${sequence}`) {
  return {
    id: `room-${sequence}`,
    name: `神念官方交流群 ${sequence} 群`,
    ownerUserId: 'official-owner',
    visibility: 'private',
    joinPolicy: 'open',
    maxHumanMembers: 1_000,
    officialSequence: sequence,
    officialInviteToken: token,
    _count: { memberships: humanCount },
  }
}

describe('official Room resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withDistributedLease.mockImplementation(async ({ run }) => ({
      acquired: true,
      result: await run(),
    }))
  })

  it('returns the current Room without taking the rollover lease below 900 humans', async () => {
    mocks.prisma.room.findFirst.mockResolvedValue(room(1, 899))

    await expect(resolveOfficialRoom()).resolves.toMatchObject({
      roomId: 'room-1',
      sequence: 1,
      humanCount: 899,
    })
    expect(mocks.withDistributedLease).not.toHaveBeenCalled()
    expect(mocks.createRoomWithOwner).not.toHaveBeenCalled()
  })

  it('creates and returns exactly the next Room at 900 humans', async () => {
    mocks.prisma.room.findFirst
      .mockResolvedValueOnce(room(1, 900))
      .mockResolvedValueOnce(room(1, 900))
      .mockResolvedValueOnce(room(2, 1, ''))
    mocks.prisma.room.findUnique.mockResolvedValue(null)
    mocks.createRoomWithOwner.mockResolvedValue({ room: { id: 'room-2' } })
    mocks.getCanonicalRoomInvite.mockResolvedValue({ rawToken: 'token-2' })
    mocks.prisma.room.update.mockResolvedValue(room(2, 1))

    await expect(resolveOfficialRoom()).resolves.toMatchObject({
      roomId: 'room-2',
      name: '神念官方交流群 2 群',
      inviteToken: 'token-2',
      sequence: 2,
    })
    expect(mocks.createRoomWithOwner).toHaveBeenCalledWith({
      userId: 'official-owner',
      name: '神念官方交流群 2 群',
      visibility: 'private',
      joinPolicy: 'open',
      officialSequence: 2,
    })
  })

  it('reuses and completes a next Room left without its invitation', async () => {
    const incomplete = room(2, 1, '')
    mocks.prisma.room.findFirst
      .mockResolvedValueOnce(room(1, 900))
      .mockResolvedValueOnce(room(1, 900))
    mocks.prisma.room.findUnique.mockResolvedValue(incomplete)
    mocks.getCanonicalRoomInvite.mockResolvedValue({ rawToken: 'recovered-token' })
    mocks.prisma.room.update.mockResolvedValue(room(2, 1, 'recovered-token'))

    await expect(resolveOfficialRoom()).resolves.toMatchObject({
      roomId: 'room-2',
      inviteToken: 'recovered-token',
    })
    expect(mocks.createRoomWithOwner).not.toHaveBeenCalled()
  })

  it('returns the latest visible target when another process owns the rollover lease', async () => {
    mocks.prisma.room.findFirst
      .mockResolvedValueOnce(room(1, 900))
      .mockResolvedValueOnce(room(2, 1))
    mocks.withDistributedLease.mockResolvedValue({ acquired: false })

    await expect(resolveOfficialRoom()).resolves.toMatchObject({ roomId: 'room-2', sequence: 2 })
  })
})
