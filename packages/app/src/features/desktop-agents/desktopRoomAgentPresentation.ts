// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../__tests__/desktop-room-agent-participation.test.ts
import type { RoomAgentSettingsData } from '../rooms/useRoomAgentSettings'

export function desktopParticipationManageable(data: RoomAgentSettingsData | null, failed: boolean, accountId: string | null): boolean {
  return Boolean(accountId && data && !failed && data.member.ownerUserId === accountId &&
    (data.session.canManage ?? data.session.userId === accountId) && data.room.status === 'active' &&
    (data.binding.status === 'active' || data.binding.status === 'paused'))
}

export function desktopParticipationRuntime(data: RoomAgentSettingsData) {
  const model = data.session.modelSource === 'agent' ? data.session.agentDefaultModelId : data.session.modelId
  const different = data.session.agentType !== data.agent.runtimeAdapter || data.session.workDir !== data.agent.workDir ||
    data.session.machineId !== data.agent.machineId || (data.session.sessionMode ?? 'standard') !== data.agent.sessionMode ||
    Boolean(model && model !== data.agent.modelId)
  return { model, different }
}
