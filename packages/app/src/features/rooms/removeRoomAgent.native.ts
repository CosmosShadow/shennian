// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/remove-room-agent.test.ts
import { useSessionsStore } from '@shennian/shared'
import { db } from '../../storage/db.native'
import { publishAgentRefreshEvent } from '../agents/agentEvents'
import { roomAccountClient } from './roomAccountClient.native'
import { publishRoomRelayEvent, publishRoomReplicaRevision } from './roomEvents'
import { assertRoomAgentRemovalContext, type RemoveRoomAgent } from './removeRoomAgent.types'

export const removeRoomAgent: RemoveRoomAgent = async (input, isCurrent) => {
  assertRoomAgentRemovalContext(isCurrent)
  await roomAccountClient.removeMember(input.roomId, input.membershipId)
  assertRoomAgentRemovalContext(isCurrent)
  // Native owns its cache. The server acknowledgement deletes this assignment only.
  try {
    if (input.agentId) {
      const cached = await db.getAgent(input.accountId, input.agentId)
      assertRoomAgentRemovalContext(isCurrent)
      if (cached && input.sessionId) {
        await db.upsertAgent(input.accountId, {
          ...cached,
          sessions: cached.sessions.filter((session) => session.id !== input.sessionId),
        })
      }
    }
    assertRoomAgentRemovalContext(isCurrent)
    if (input.sessionId) {
      await db.deleteSession(input.sessionId)
      assertRoomAgentRemovalContext(isCurrent)
      useSessionsStore.getState().removeSession(input.sessionId)
    }
  } catch {
    // Native account sync repairs cache errors; a changed view still cancels UI completion below.
  }
  assertRoomAgentRemovalContext(isCurrent)
  const frame = { type: 'event' as const, event: 'room.membership.updated', payload: {
    event: 'room.membership.updated', roomId: input.roomId, entityId: input.membershipId,
  } }
  publishRoomRelayEvent(frame)
  publishAgentRefreshEvent(frame)
  publishRoomReplicaRevision(input.roomId, ['members'])
}
