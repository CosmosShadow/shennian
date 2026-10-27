// @arch docs/features/contact-and-reviews.md
import { authApi } from '../../config/api'
import type { RoomInvitationClient } from './roomInvitationClient.types'
export const roomInvitationClient: RoomInvitationClient = {
  exchange(input) {
    return authApi('/room-invites/native/exchange', { method: 'POST', body: JSON.stringify(input) })
  },
  join(input) {
    return authApi('/room-invites/native/join', { method: 'POST', body: JSON.stringify(input) })
  },
}
