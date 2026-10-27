// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

import { Redirect, useLocalSearchParams } from 'expo-router'

// Preserve existing bookmarks without maintaining a second sharing destination.
export default function RoomOpenOnComputerRoute() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>()
  return <Redirect href={{ pathname: '/(main)/spaces/invite', params: { roomId } }} />
}
