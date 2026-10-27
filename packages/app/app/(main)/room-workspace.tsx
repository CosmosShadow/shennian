// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../src/__tests__/room-workspace.test.ts

import { useLocalSearchParams } from 'expo-router'
import { RoomWorkspaceScreen } from '../../src/features/rooms/RoomWorkspaceScreen'

export default function NativeRoomWorkspaceRoute() {
  const { roomId, agentSessionId, scopedAgentSessionId, scopedAgentIdentityId } = useLocalSearchParams<{
    roomId: string
    agentSessionId?: string
    scopedAgentIdentityId?: string
    scopedAgentSessionId?: string
  }>()

  return (
    <RoomWorkspaceScreen
      roomId={roomId}
      initialAgentSessionId={agentSessionId}
      scopedAgentSessionId={scopedAgentSessionId}
      scopedAgentIdentityId={scopedAgentIdentityId}
    />
  )
}
