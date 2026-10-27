// @arch docs/features/network-rooms/ui.md#六群聊列表
// @test src/__tests__/room-group-avatar.test.ts

import type { RoomMemberView } from './types'

type AvatarMember = Pick<RoomMemberView, 'id' | 'principalType' | 'displayAlias' | 'avatar'> &
  Partial<Pick<RoomMemberView, 'role' | 'joinedAt'>>

/** Only people occupy tiles; older projections may still contain agents. */
export function selectRoomAvatarMembers(members: AvatarMember[]): AvatarMember[] {
  const humans = members.filter((member) => member.principalType === 'human')
  // Without timestamps, preserve the server's stable join order.
  if (humans.every((member) => member.joinedAt)) {
    humans.sort((left, right) =>
      left.joinedAt!.localeCompare(right.joinedAt!) || left.id.localeCompare(right.id),
    )
  }
  return humans.slice(0, 4)
}

export function getRoomAvatarRows(members: AvatarMember[]): AvatarMember[][] {
  const selected = selectRoomAvatarMembers(members)
  if (selected.length <= 2) return selected.length ? [selected] : []
  const firstRowCount = selected.length === 3 ? 1 : 2
  return [selected.slice(0, firstRowCount), selected.slice(firstRowCount)]
}

/** A thin shared gutter and inset keep the mosaic together within its fixed slot. */
export function getRoomAvatarMetrics(size: number, memberCount: number) {
  const grouped = memberCount > 1
  const padding = grouped ? 2 : 0
  const gap = grouped ? 1 : 0
  return { grouped, padding, gap, tileSize: grouped ? (size - padding * 2 - gap) / 2 : size }
}
