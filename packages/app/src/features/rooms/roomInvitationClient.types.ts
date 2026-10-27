// @arch docs/features/contact-and-reviews.md
export type RoomInvitation = {
  room: { id: string; name: string; description: string; joinPolicy: 'open' | 'approval' | 'closed' }
}
export type RoomInvitationExchange = {
  entryState: 'joined' | 'pending_approval' | 'can_join'
  roomId?: string
  joinHandle?: string
  invite?: RoomInvitation
}
export type RoomInvitationResult = {
  outcome: 'joined' | 'pending_approval'
  roomId: string
  joinRequestId?: string
}
export type RoomInvitationClient = {
  exchange(input: { roomId?: string; token: string }): Promise<RoomInvitationExchange>
  join(input: { joinHandle: string; message?: string }): Promise<RoomInvitationResult>
}
