// @arch docs/design/desktop/unified-desktop-control.md#页面清单与交互矩阵
// @test ../../__tests__/desktop-room-management.test.ts
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '../../config/auth'
import { subscribeRoomEvents } from '../rooms/roomEvents'
import { desktopRoomManagementClient } from './desktopRoomManagementClient'
import { DesktopRoomManagementModel } from './desktopRoomManagementModel'

export function useDesktopRoomManagement(accountId: string, roomId: string) {
  const model = useMemo(() => new DesktopRoomManagementModel({
    accountId,
    roomId,
    currentAccount: () => useAuthStore.getState().user?.id ?? null,
    client: desktopRoomManagementClient,
  }), [accountId, roomId])
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState)
  useEffect(() => {
    const stopModel = model.start()
    const stopEvents = subscribeRoomEvents(event => {
      if (event.event === 'room.sync.request') return
      if (event.roomId === null || event.roomId === roomId) void model.reload()
    })
    return () => { stopEvents(); stopModel() }
  }, [model, roomId])
  return { model, state }
}
