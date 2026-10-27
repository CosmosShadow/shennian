// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/agent-participation-navigation.test.ts
import type { RoomMemberView } from './types'

/** A group without an explicit selection must not pick an arbitrary owned Agent. */
export function selectRoomParticipationAgent(
  members: RoomMemberView[],
  accountId: string | null | undefined,
  preferredIdentityId?: string | null,
): RoomMemberView | null {
  const owned = members.filter(
    (member) =>
      member.principalType === 'agent' &&
      Boolean(accountId) &&
      member.ownerUserId === accountId &&
      member.agentIdentityId,
  )
  if (preferredIdentityId)
    return owned.find((member) => member.agentIdentityId === preferredIdentityId) ?? null
  return owned.length === 1 ? owned[0] : null
}

/** Keep an Agent-index workspace scoped to the identity after its Session is replaced. */
export function resolveScopedAgentIdentity(
  agents: Array<{ sessionId: string; agentIdentityId: string }>,
  sessionId?: string,
  identityId?: string,
): string | null {
  return (
    identityId || agents.find((agent) => agent.sessionId === sessionId)?.agentIdentityId || null
  )
}
