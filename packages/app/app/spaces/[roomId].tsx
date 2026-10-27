// @arch docs/features/network-rooms/mobile-control-and-single-room-web.md
// @test ../../src/__tests__/scoped-room-api.test.ts

import { Platform } from 'react-native'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { ScopedRoomConversationScreen } from '../../src/features/rooms/ScopedRoomConversationScreen'
import { RoomAccessGate } from '../../src/features/rooms/RoomAccessGate'
import { NativeRoomInviteScreen } from '../../src/features/rooms/NativeRoomInviteScreen'

export default function RoomRoute() {
  const { roomId, invite, agentSessionId, scopedAgentSessionId } = useLocalSearchParams<{
    roomId: string
    invite?: string
    agentSessionId?: string
    scopedAgentSessionId?: string
  }>()

  if (Platform.OS === 'web') {
    return (
      <ScopedRoomConversationScreen
        roomId={roomId}
        unavailableFallback={<RoomAccessGate roomId={roomId} />}
      />
    )
  }

  if (invite) return <NativeRoomInviteScreen roomId={roomId} inviteToken={invite} />

  return (
    <Redirect
      href={{
        pathname: '/(main)/room-workspace',
        params: { roomId, agentSessionId, scopedAgentSessionId },
      }}
    />
  )
}
