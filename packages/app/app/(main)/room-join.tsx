// @arch docs/features/network-rooms/ui.md
// @test ../../src/__tests__/room-scan-back.test.ts

import { useLocalSearchParams } from 'expo-router'
import { NativeRoomInviteScreen } from '../../src/features/rooms/NativeRoomInviteScreen'

export default function RoomJoinRoute() {
  const { roomId, invite } = useLocalSearchParams<{ roomId: string; invite: string }>()
  return <NativeRoomInviteScreen roomId={roomId} inviteToken={invite} />
}
