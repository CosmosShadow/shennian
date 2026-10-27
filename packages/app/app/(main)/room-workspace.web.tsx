// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @test ../../src/__tests__/desktop-room-workspace.test.ts

import { useLocalSearchParams } from 'expo-router'
import { DesktopRoomWorkspaceScreen } from '../../src/features/desktop-rooms/DesktopRoomWorkspaceScreen'

export default function DesktopRoomWorkspaceRoute() {
  const { roomId, agentSessionId, scopedAgentSessionId, scopedAgentIdentityId } =
    useLocalSearchParams<{
      roomId: string
      agentSessionId?: string
      scopedAgentIdentityId?: string
      scopedAgentSessionId?: string
    }>()

  return (
    <DesktopRoomWorkspaceScreen
      roomId={roomId}
      initialAgentSessionId={agentSessionId}
      scopedAgentSessionId={scopedAgentSessionId}
      scopedAgentIdentityId={scopedAgentIdentityId}
    />
  )
}
