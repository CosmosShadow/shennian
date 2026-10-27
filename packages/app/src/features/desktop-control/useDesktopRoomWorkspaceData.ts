// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-workspace-data.test.ts
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '../../config/auth'
import type { RoomWorkspaceData, RoomWorkspaceDataOptions } from '../rooms/useRoomWorkspaceData.types'
import { desktopRoomDataPort } from '../desktop-rooms/desktopRoomDataPort'
import { DesktopRoomWorkspaceData } from './desktopRoomWorkspaceData'

type CachedWorkspace = Pick<RoomWorkspaceData, 'room' | 'members'> & {
  room: NonNullable<RoomWorkspaceData['room']>
}

const MAX_CACHED_WORKSPACES = 12
const workspaceCache = new Map<string, CachedWorkspace>()

function rememberWorkspace(key: string, snapshot: CachedWorkspace): void {
  workspaceCache.delete(key)
  workspaceCache.set(key, snapshot)
  while (workspaceCache.size > MAX_CACHED_WORKSPACES) {
    const oldest = workspaceCache.keys().next().value
    if (typeof oldest !== 'string') break
    workspaceCache.delete(oldest)
  }
}

export function useDesktopRoomWorkspaceData({ roomId, currentUserId }: RoomWorkspaceDataOptions): RoomWorkspaceData {
  const controller = useMemo(() => {
    const cacheKey = `${currentUserId ?? ''}:${roomId}`
    return new DesktopRoomWorkspaceData({
      roomId,
      initialSnapshot: workspaceCache.get(cacheKey),
      isCurrent: () => Boolean(currentUserId) && useAuthStore.getState().user?.id === currentUserId,
      async read() {
        if (!currentUserId) throw new Error('Desktop Room account is unavailable.')
        try {
          const snapshot = await desktopRoomDataPort.readWorkspace(currentUserId, roomId)
          const value = { room: snapshot.room, members: snapshot.members }
          rememberWorkspace(cacheKey, value)
          return value
        } catch (error) {
          const code = (error as { code?: string })?.code
          if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'AUTH_REQUIRED') {
            workspaceCache.delete(cacheKey)
          }
          throw error
        }
      },
    })
  }, [roomId, currentUserId])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  useEffect(() => controller.cancelLoad, [controller])
  return { ...state, hasCurrentRoom: state.room?.id === roomId,
    load: controller.load, cancelLoad: controller.cancelLoad, setMembers: controller.setMembers }
}
