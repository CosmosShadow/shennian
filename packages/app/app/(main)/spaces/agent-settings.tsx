// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../../src/__tests__/room-agent-settings.test.ts
import { useLocalSearchParams } from 'expo-router'
import { RoomAgentSettingsScreen } from '../../../src/features/rooms/RoomAgentSettingsScreen'
export default function RoomAgentSettingsRoute() {
  const { roomId = '', agentIdentityId = '' } = useLocalSearchParams<{ roomId: string; agentIdentityId: string }>()
  return <RoomAgentSettingsScreen roomId={roomId} agentIdentityId={agentIdentityId} page="overview" />
}
