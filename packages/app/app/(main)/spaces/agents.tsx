// @arch docs/features/network-rooms/ui.md#六移动端
// @test ../../../src/__tests__/room-management-panel.test.ts
import { Redirect, useLocalSearchParams } from 'expo-router'

export default function RoomAgentsRoute() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>()
  return <Redirect href={{ pathname: '/(main)/spaces/details', params: { roomId } }} />
}
