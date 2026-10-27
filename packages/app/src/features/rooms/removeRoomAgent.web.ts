// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/remove-room-agent.test.ts
import { roomAccountClient } from './roomAccountClient.web'
import { assertRoomAgentRemovalContext, type RemoveRoomAgent } from './removeRoomAgent.types'

export const removeRoomAgent: RemoveRoomAgent = async (input, isCurrent) => {
  assertRoomAgentRemovalContext(isCurrent)
  await roomAccountClient.removeMember(input.roomId, input.membershipId)
  assertRoomAgentRemovalContext(isCurrent)
}
