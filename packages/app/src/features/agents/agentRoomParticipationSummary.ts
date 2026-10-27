// @arch docs/features/agent-workspaces.md#四群聊
// @test src/__tests__/agent-workspaces-navigation.test.ts

import type { AgentWorkspaceSession } from '@shennian/wire'

type RoomSession = Pick<AgentWorkspaceSession, 'room'>

export type AgentRoomParticipationSummary = {
  active: number
  total: number
}

export function formatAgentRoomParticipationCompact(
  summary: AgentRoomParticipationSummary,
): string {
  return summary.active === summary.total
    ? String(summary.total)
    : `${summary.active}/${summary.total}`
}

/**
 * Counts current group relationships by their configured work mode. Runtime availability is a
 * separate status and must not silently change the user's participation setting.
 */
export function getAgentRoomParticipationSummary(
  sessions: readonly RoomSession[],
): AgentRoomParticipationSummary {
  return sessions.reduce<AgentRoomParticipationSummary>(
    (summary, session) => {
      const room = session.room
      if (!room || !['active', 'paused', 'detached'].includes(room.status)) return summary

      summary.total += 1
    if (room.activationMode === 'auto_follow' || room.activationMode === 'mention_only') {
        summary.active += 1
      }
      return summary
    },
    { active: 0, total: 0 },
  )
}
