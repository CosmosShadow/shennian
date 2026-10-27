// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../__tests__/desktop-room-agent-controller.test.ts
import type { RoomActivationMode } from '@shennian/wire'
import type { RoomAgentSettingsData } from '../rooms/useRoomAgentSettings'
import { requireDesktopAccountSyncBridge } from '../desktop-control/desktopAccountRuntime'

export type DesktopRoomAgentTarget = { roomId: string; agentIdentityId: string }
export type DesktopRoomAgentModeInput = DesktopRoomAgentTarget & {
  memberId: string; sessionId: string; original: RoomActivationMode; desired: RoomActivationMode
}

/** The renderer holds no HTTP choreography or alternative relation data source. */
export async function readDesktopRoomAgent(target: DesktopRoomAgentTarget): Promise<RoomAgentSettingsData> {
  return command('room.agent.get', target)
}
export async function setDesktopRoomAgentMode(input: DesktopRoomAgentModeInput): Promise<RoomAgentSettingsData> {
  return command('room.agent.setMode', input)
}
async function command(operation: 'room.agent.get' | 'room.agent.setMode', input: DesktopRoomAgentTarget) {
  const result = await requireDesktopAccountSyncBridge().command({ requestId: crypto.randomUUID(), operation, args: [input] })
  if (!result.ok) throw new Error(result.error.message)
  const value = result.value as RoomAgentSettingsData | null
  if (!value || value.room?.id !== input.roomId || value.agent?.id !== input.agentIdentityId ||
    value.member?.agentIdentityId !== input.agentIdentityId || !value.session?.id ||
    value.session.agentIdentityId !== input.agentIdentityId || value.member.ownBinding?.nianSessionId !== value.session.id ||
    value.binding?.room?.id !== input.roomId) throw new Error('room_agent_binding_unavailable')
  return value
}
