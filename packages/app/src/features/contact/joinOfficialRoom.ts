// @arch docs/features/contact-and-reviews.md
// @test src/__tests__/contact-room.test.ts

import type { RoomInvitationClient } from '../rooms/roomInvitationClient.types'

// Called only by the explicit "Join Shennian official group" action.
export async function joinOfficialRoom(client: RoomInvitationClient, roomId: string, token: string) {
  const exchange = await client.exchange({ roomId, token })
  if (exchange.roomId !== undefined && exchange.roomId !== roomId) throw new Error('invalid_room')
  if (exchange.entryState === 'joined') return { outcome: 'joined' as const, roomId }
  if (exchange.entryState === 'pending_approval')
    return { outcome: 'pending_approval' as const, roomId }
  if (!exchange.joinHandle || exchange.invite?.room.id !== roomId) throw new Error('invalid_invite')
  // Preserve the regular approval/closed flow if the owner changes the policy.
  if (exchange.invite.room.joinPolicy !== 'open') return { outcome: 'invite' as const, roomId }
  const result = await client.join({ joinHandle: exchange.joinHandle })
  if (result.roomId !== roomId) throw new Error('invalid_room')
  return result
}
