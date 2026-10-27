// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../__tests__/desktop-room-agent-controller.test.ts
import { useCallback, useMemo, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useAuthStore } from '../../config/auth'
import { subscribeRoomEvents } from '../rooms/roomEvents'
import { subscribeAgentRefresh } from '../agents/agentEvents'
import type { RoomAgentSettingsData } from '../rooms/useRoomAgentSettings'
import { createDesktopRoomAgentReader } from './desktopRoomAgentController'
import { readDesktopRoomAgent } from './desktopRoomAgentClient'

export function useDesktopRoomAgentSettings(roomId: string, agentIdentityId: string, accountId: string | null) {
  const [state, setState] = useState<{ data: RoomAgentSettingsData | null; failed: boolean }>({ data: null, failed: false })
  const reader = useMemo(() => createDesktopRoomAgentReader({
    isCurrent: () => Boolean(accountId) && useAuthStore.getState().user?.id === accountId,
    read: () => readDesktopRoomAgent({ roomId, agentIdentityId }),
    publish: (data, failed) => setState({ data, failed }),
  }), [accountId, roomId, agentIdentityId])
  useFocusEffect(useCallback(() => {
    reader.start()
    setState({ data: null, failed: !accountId })
    const auth = useAuthStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id) { reader.stop(); setState({ data: null, failed: true }) }
    })
    const room = subscribeRoomEvents(event => {
      if (event.event === 'room.replica.updated' && (!event.roomId || event.roomId === roomId)) void reader.refresh()
    })
    const agent = subscribeAgentRefresh(() => void reader.refresh())
    void reader.refresh()
    return () => { reader.stop(); auth(); room(); agent() }
  }, [reader, accountId, roomId]))
  return { ...state, refresh: reader.refresh }
}
