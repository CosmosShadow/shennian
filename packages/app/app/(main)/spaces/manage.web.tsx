// @arch docs/design/desktop/unified-desktop-control.md#页面清单与交互矩阵
// @test ../../../src/__tests__/desktop-room-management.test.ts
import { useLocalSearchParams } from 'expo-router'
import { DesktopRoomManagementScreen } from '../../../src/features/desktop-rooms/DesktopRoomManagementScreen'

export default function DesktopRoomManageRoute() {
  const { roomId = '' } = useLocalSearchParams<{ roomId: string }>()
  return <DesktopRoomManagementScreen roomId={roomId} page="manage" />
}
