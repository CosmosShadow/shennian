// @covers open-source/packages/server/src/services/room-read-state.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { transaction, updateMany, create, readState } = vi.hoisted(() => {
  const readState = { value: null as bigint | null }
  const upsert = vi.fn(async (args: { create: { lastReadSequence: bigint } }) => {
    if (readState.value === null) readState.value = args.create.lastReadSequence
    return { lastReadSequence: readState.value }
  })
  const updateMany = vi.fn(async (args: {
    where: { lastReadSequence: bigint | { lt: bigint } }
    data: { lastReadSequence: bigint }
  }) => {
    const condition = args.where.lastReadSequence
    const matches = typeof condition === 'bigint'
      ? readState.value === condition
      : readState.value !== null && readState.value < condition.lt
    if (matches) {
      readState.value = args.data.lastReadSequence
      return { count: 1 }
    }
    return { count: 0 }
  })
  const create = vi.fn(async (args: { data: { lastReadSequence: bigint } }) => {
    readState.value = args.data.lastReadSequence
    return { lastReadSequence: readState.value }
  })
  const findUnique = vi.fn(async () => readState.value === null
    ? null
    : { lastReadSequence: readState.value })
  const tx = { roomReadState: { upsert, updateMany, findUnique, create } }
  return {
    readState,
    upsert,
    updateMany,
    create,
    findUnique,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  }
})

vi.mock('../lib/prisma.js', () => ({ prisma: { $transaction: transaction } }))

import { advanceReadStateForOwnMessage, advanceRoomReadState } from '../services/room-read-state.js'

describe('Room read watermark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readState.value = null
  })

  it('shares one account watermark and never lets a stale device move it backward', async () => {
    await expect(advanceRoomReadState({
      roomId: 'room-1', membershipId: 'member-1', lastReadSequence: 156n,
    })).resolves.toEqual({ lastReadSequence: 156n, advanced: true })

    await expect(advanceRoomReadState({
      roomId: 'room-1', membershipId: 'member-1', lastReadSequence: 106n,
    })).resolves.toEqual({ lastReadSequence: 156n, advanced: false })

    expect(readState.value).toBe(156n)
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { membershipId: 'member-1', lastReadSequence: { lt: 106n } },
      data: { lastReadSequence: 106n },
    })
  })

  it('reports no advancement when the same watermark is submitted again', async () => {
    await advanceRoomReadState({ roomId: 'room-1', membershipId: 'member-1', lastReadSequence: 156n })

    await expect(advanceRoomReadState({
      roomId: 'room-1', membershipId: 'member-1', lastReadSequence: 156n,
    })).resolves.toEqual({ lastReadSequence: 156n, advanced: false })

    await expect(advanceRoomReadState({
      roomId: 'room-1', membershipId: 'member-1', lastReadSequence: 157n,
    })).resolves.toEqual({ lastReadSequence: 157n, advanced: true })
  })

  describe('own message', () => {
    const ownMessage = (sequence: bigint) => advanceReadStateForOwnMessage(
      { roomReadState: { updateMany, findUnique: vi.fn(async () => readState.value === null ? null : { lastReadSequence: readState.value }), create } } as never,
      { roomId: 'room-1', membershipId: 'member-1', sequence },
    )

    it('moves the watermark onto the sender message when everything before it was read', async () => {
      readState.value = 9n
      await expect(ownMessage(10n)).resolves.toBe(true)
      expect(readState.value).toBe(10n)
    })

    it('leaves earlier unread messages unread instead of swallowing them', async () => {
      readState.value = 7n
      await expect(ownMessage(10n)).resolves.toBe(false)
      expect(readState.value).toBe(7n)
    })

    it('does not rewind a watermark that a device already moved past the message', async () => {
      readState.value = 12n
      await expect(ownMessage(10n)).resolves.toBe(false)
      expect(readState.value).toBe(12n)
    })

    it('creates the watermark for the very first message of a Room', async () => {
      await expect(ownMessage(1n)).resolves.toBe(true)
      expect(readState.value).toBe(1n)
      expect(create).toHaveBeenCalledWith({
        data: { roomId: 'room-1', membershipId: 'member-1', lastReadSequence: 1n },
      })
    })

    it('does not create a watermark for a later message when none exists yet', async () => {
      await expect(ownMessage(5n)).resolves.toBe(false)
      expect(create).not.toHaveBeenCalled()
    })
  })
})
