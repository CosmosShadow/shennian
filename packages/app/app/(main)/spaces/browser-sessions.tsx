// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test ../../../src/__tests__/room-management-panel.test.ts

import { Redirect, useLocalSearchParams } from 'expo-router'

export default function RoomBrowserSessionsRoute() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>()
  return <Redirect href={{ pathname: '/(main)/spaces/details', params: { roomId } }} />
}
