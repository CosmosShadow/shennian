// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test ../../../src/__tests__/room-management-panel.test.ts

import { useLocalSearchParams } from 'expo-router'
import { RoomSettingsScreen } from '../../../src/features/rooms/RoomSettingsScreen'

export default function RoomInviteRoute() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>()
  return <RoomSettingsScreen roomId={roomId} page="invite" />
}
