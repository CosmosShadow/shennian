// @covers packages/app/src/features/rooms/components/RoomGroupAvatar.tsx
// @covers packages/app/src/features/rooms/roomAvatar.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ View: 'View', StyleSheet: { create: <T>(styles: T) => styles } }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { avatarGroupBg: '#E2E4E5' } }) }))
vi.mock('../features/rooms/components/RoomIdentityAvatar', () => ({ RoomIdentityAvatar: 'RoomIdentityAvatar' }))

import { RoomGroupAvatar } from '../features/rooms/components/RoomGroupAvatar'
import { avatarBorderRadius } from '../components/avatarShape'
import { getRoomAvatarMetrics, getRoomAvatarRows, selectRoomAvatarMembers } from '../features/rooms/roomAvatar'

type Member = Parameters<typeof selectRoomAvatarMembers>[0][number]
function member(id: string, joinedAt?: string, extra: Partial<Member> = {}): Member {
  return { id, principalType: 'human', displayAlias: id, avatar: null, joinedAt, ...extra }
}

describe('room group avatar', () => {
  it.each([false, true])('clips only the shared inset contour (compact=%s)', (compact) => {
    const size = compact ? 34 : 44
    for (const count of [0, 1, 2, 3, 4]) {
      const members = Array.from({ length: count }, (_, i) => member(String(i)))
      const tree = RoomGroupAvatar({ members: members as Parameters<typeof RoomGroupAvatar>[0]['members'], compact })
      const outer = Object.assign({}, ...tree.props.style)
      const mask = tree.props.children
      const inner = Object.assign({}, ...mask.props.style)
      const grouped = count > 1
      const padding = grouped ? 2 : 0
      const radius = grouped ? (compact ? 3 : 4) : avatarBorderRadius(size)
      expect(outer).toMatchObject({ width: size, height: size, padding, borderRadius: radius })
      expect(inner).toMatchObject({
        width: size - padding * 2, height: size - padding * 2,
        borderRadius: radius - padding,
        overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        gap: grouped ? 1 : 0,
      })
      expect(outer.backgroundColor).toBe(grouped ? '#E2E4E5' : undefined)
      if (count === 0) {
        expect(mask.props.children.props.size).toBe(size)
        continue
      }
      const tiles = mask.props.children.flatMap((row: { props: { children: { props: { variant: 'identity' | 'group-tile'; size: number } }[] } }) => row.props.children)
      expect(tiles).toHaveLength(count)
      for (const tile of tiles) {
        expect(tile.props.variant).toBe(grouped ? 'group-tile' : 'identity')
        expect(avatarBorderRadius(tile.props.size, tile.props.variant)).toBe(grouped ? 0 : avatarBorderRadius(size))
      }
    }
  })

  it.each([34, 44])('fits a tightly spaced mosaic inside the %i pt slot', (size) => {
    for (const count of [2, 3, 4]) {
      const metrics = getRoomAvatarMetrics(size, count)
      expect(metrics).toMatchObject({ grouped: true, padding: 2, gap: 1 })
      expect(metrics.tileSize * 2 + metrics.gap + metrics.padding * 2).toBe(size)
    }
    for (const count of [0, 1]) {
      expect(getRoomAvatarMetrics(size, count))
        .toEqual({ grouped: false, padding: 0, gap: 0, tileSize: size })
    }
  })

  it('uses only humans in join order, not owner priority or agents', () => {
    const first = member('first', '2026-08-01')
    const owner = member('owner', '2026-08-03', { role: 'owner' })
    const members = [owner, member('agent', '2026-07-01', { principalType: 'agent' }), first]
    expect(selectRoomAvatarMembers(members)).toEqual([first, owner])
    expect(members[0]).toBe(owner)
  })

  it('filters before capping at four and fills vacated slots from later people', () => {
    const humans = Array.from({ length: 6 }, (_, i) => member(`human-${i}`))
    const agent = member('agent', undefined, { principalType: 'agent' })
    expect(selectRoomAvatarMembers([agent, ...humans])).toEqual(humans.slice(0, 4))
    expect(selectRoomAvatarMembers([agent, ...humans.slice(1)])).toEqual(humans.slice(1, 5))
  })

  it('preserves server order when older projections omit any timestamps', () => {
    const members = [member('b', '2026-08-03'), member('a'), member('c', '2026-08-01')]
    expect(selectRoomAvatarMembers(members)).toEqual(members)
  })

  it('breaks equal join timestamps by membership id', () => {
    expect(selectRoomAvatarMembers([member('b', '2026-08-01'), member('a', '2026-08-01')])
      .map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('does not replace missing humans with agents', () => {
    expect(selectRoomAvatarMembers([])).toEqual([])
    expect(getRoomAvatarRows([member('agent', undefined, { principalType: 'agent' })])).toEqual([])
  })

  it('keeps people without photos and uses their updated profile data', () => {
    const human = member('person')
    expect(selectRoomAvatarMembers([human])[0].avatar).toBeNull()
    const updated = { ...human, avatar: { version: '2', smallUrl: '/avatar/small', mediumUrl: '/avatar/medium', updatedAt: '2026-09-10' } }
    expect(selectRoomAvatarMembers([updated])[0].avatar?.version).toBe('2')
  })

  it.each([
    [0, []], [1, [['0']]], [2, [['0', '1']]],
    [3, [['0'], ['1', '2']]], [4, [['0', '1'], ['2', '3']]],
    [6, [['0', '1'], ['2', '3']]],
  ])('lays out %i people in centered rows with at most four tiles', (count, expected) => {
    const members = Array.from({ length: count as number }, (_, i) => member(String(i)))
    expect(getRoomAvatarRows(members).map((row) => row.map((item) => item.id))).toEqual(expected)
  })
})
