// @arch docs/features/contact-and-reviews.md

import type { RoomInvitationClient } from '../rooms/roomInvitationClient.types'
import { resolveOfficialRoomTarget } from './links'
import { joinOfficialRoom } from './joinOfficialRoom'

export async function joinCurrentOfficialRoom(client: RoomInvitationClient) {
  const room = await resolveOfficialRoomTarget()
  if (!room) throw new Error('contact_not_configured')
  const result = await joinOfficialRoom(client, room.roomId, room.inviteToken)
  return { ...result, roomId: room.roomId, inviteToken: room.inviteToken }
}
