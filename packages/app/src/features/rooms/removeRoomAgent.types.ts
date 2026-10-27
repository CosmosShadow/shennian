// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
export type RemoveRoomAgentInput = {
  accountId: string
  roomId: string
  membershipId: string
  agentId?: string | null
  sessionId?: string | null
}
export type RemoveRoomAgent = (input: RemoveRoomAgentInput, isCurrent: () => boolean) => Promise<void>

export function assertRoomAgentRemovalContext(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error('Room agent removal context changed.')
}
