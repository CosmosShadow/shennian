// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-agent-mode.test.ts
import type { RoomActivationMode } from '@shennian/wire'
import type { RoomMemberView } from './types'

export function canChangeRoomAgentMode(
  agent: RoomMemberView | null,
  userId?: string | null,
): boolean {
  return Boolean(
    userId &&
    agent?.principalType === 'agent' &&
    agent.ownerUserId === userId &&
    (agent.ownBinding?.status === 'active' || agent.ownBinding?.status === 'paused'),
  )
}

/** A work-mode change does not establish machine availability. */
export function applyRoomAgentMode(
  agent: RoomMemberView,
  result: { status: 'active' | 'paused'; activationMode: RoomActivationMode },
): RoomMemberView {
  return {
    ...agent,
    ...(agent.agentParticipation
      ? {
          agentParticipation: {
            ...agent.agentParticipation,
            activationMode: result.activationMode,
          },
        }
      : {}),
    ownBinding: agent.ownBinding ? { ...agent.ownBinding, ...result } : agent.ownBinding,
  }
}
