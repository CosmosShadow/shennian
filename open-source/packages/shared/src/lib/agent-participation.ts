// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/agent-participation.test.ts

import type {
  AgentRuntimeAvailability,
  RoomActivationMode,
} from '@shennian/wire'
import type { AgentWorkspace } from '@shennian/wire'

export type CompactAgentParticipation = 'auto' | 'mention' | 'paused' | 'offline'

/**
 * The single user-facing projection for a managed Agent in one Room.
 * Missing additive fields remain invisible on old cached/server payloads instead
 * of guessing another member's private runtime state.
 */
export function deriveCompactAgentParticipation(input: {
  principalType: 'human' | 'agent'
  activationMode?: RoomActivationMode | null
  availability?: AgentRuntimeAvailability | null
  bindingStatus?: string | null
}): CompactAgentParticipation | null {
  if (input.principalType !== 'agent') return null
  if (input.activationMode === 'paused') return 'paused'
  if (input.activationMode === 'auto_follow') return 'auto'
  if (input.activationMode === 'mention_only') return 'mention'
  if (input.bindingStatus === 'paused') return 'paused'
  return null
}

export function isAgentRuntimeOffline(
  availability: AgentRuntimeAvailability | null | undefined,
): boolean {
  return availability === 'unavailable' || availability === 'recovering'
}

/** Apply an immediate cache barrier while the authoritative Agent API refresh is in flight. */
export function projectAgentWorkspaceRuntimeUnavailable(
  agent: AgentWorkspace,
  machineId: string,
): AgentWorkspace {
  if (agent.machineId !== machineId && !agent.sessions.some((session) => session.machineId === machineId)) return agent
  return {
    ...agent,
    ...(agent.machineId === machineId ? {
      availability: 'unavailable' as const,
      repairAction: null,
    } : {}),
    // An explicit machine removal ends its group memberships, not the identity.
    sessions: agent.sessions.filter((session) => session.machineId !== machineId),
  }
}
