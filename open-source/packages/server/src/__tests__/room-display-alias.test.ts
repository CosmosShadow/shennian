// @covers open-source/packages/server/src/services/room-display-alias.ts

import { describe, expect, it, vi } from 'vitest'
import { allocateRoomDisplayAlias } from '../services/room-display-alias.js'

describe('Room display aliases', () => {
  it('keeps the requested name when it is unique', async () => {
    const tx = transactionWithAliases(['Alice'])
    await expect(allocateRoomDisplayAlias(tx, 'room_1', 'Bob')).resolves.toBe('Bob')
  })

  it('adds a stable human-readable ordinal for duplicate names', async () => {
    const tx = transactionWithAliases(['辰哥', '辰哥 2'])
    await expect(allocateRoomDisplayAlias(tx, 'room_1', '辰哥')).resolves.toBe('辰哥 3')
  })

  it('treats case-only differences as the same name', async () => {
    const tx = transactionWithAliases(['Support'])
    await expect(allocateRoomDisplayAlias(tx, 'room_1', 'support')).resolves.toBe('support 2')
  })

  it('excludes the renamed membership when preserving its collision suffix', async () => {
    const findMany = vi.fn(async () => [{ displayAlias: '神念客服' }])
    const tx = { roomMembership: { findMany } } as never

    await expect(
      allocateRoomDisplayAlias(tx, 'room_1', '神念客服', {
        excludeMembershipId: 'membership_2',
      }),
    ).resolves.toBe('神念客服 2')
    expect(findMany).toHaveBeenCalledWith({
      where: { roomId: 'room_1', id: { not: 'membership_2' } },
      select: { displayAlias: true },
    })
  })
})

function transactionWithAliases(aliases: string[]) {
  return {
    roomMembership: {
      findMany: vi.fn(async () => aliases.map((displayAlias) => ({ displayAlias }))),
    },
  } as never
}
