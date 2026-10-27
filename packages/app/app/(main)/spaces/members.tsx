// @arch docs/features/network-rooms/ui.md#六移动端
// @test ../../../src/__tests__/room-management-panel.test.ts
import { useLocalSearchParams } from 'expo-router'
import { RoomSettingsScreen } from '../../../src/features/rooms/RoomSettingsScreen'
export default function RoomMembersRoute() {
  const { roomId, manage } = useLocalSearchParams<{ roomId: string; manage?: string }>()
  return <RoomSettingsScreen roomId={roomId} page="members" manageMembers={manage === '1'} />
}
