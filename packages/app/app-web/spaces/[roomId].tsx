// @arch docs/features/network-rooms/scoped-browser-access.md
// @test ../../src/__tests__/scoped-room-api.test.ts

import { useLocalSearchParams } from 'expo-router'
import { RoomAccessGate } from '../../src/features/rooms/RoomAccessGate'
import { ScopedRoomConversationScreen } from '../../src/features/rooms/ScopedRoomConversationScreen'

export default function LightweightRoomRoute() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>()
  return (
    <ScopedRoomConversationScreen
      roomId={roomId}
      unavailableFallback={<RoomAccessGate roomId={roomId} />}
    />
  )
}
