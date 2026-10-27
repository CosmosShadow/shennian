// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-projection.test.ts
import { useEffect } from 'react'
import { useAuthStore } from '../../config/auth'
import { getRoomListSnapshot, setRoomListSnapshot } from '../rooms/roomListCache'
import { removeRoomDraft } from '../rooms/roomDraftStorage'
import { subscribeRoomEvents } from '../rooms/roomEvents'
import { desktopRoomDataPort } from '../desktop-rooms/desktopRoomDataPort'
import { startDesktopRoomProjection } from './desktopRoomProjection'

export function useDesktopRoomProjection(accountId: string | null): void {
  const authenticatedAccountId = useAuthStore((state) => state.user?.id ?? null)
  useEffect(() => {
    if (!accountId || accountId !== authenticatedAccountId) return
    const stop = startDesktopRoomProjection({
      isCurrent: () => useAuthStore.getState().user?.id === accountId,
      readSnapshot: () => desktopRoomDataPort.readList(accountId),
      publish: (snapshot) => {
        const retained = new Set(snapshot.rooms.map((room) => room.id))
        for (const room of getRoomListSnapshot(accountId)?.rooms ?? []) {
          if (!retained.has(room.id)) removeRoomDraft(accountId, room.id)
        }
        setRoomListSnapshot(accountId, snapshot)
      },
      subscribe: subscribeRoomEvents,
      onError: () => {
        // Do not log account contents, bridge payloads or credential-bearing errors.
        console.warn('[Desktop] Room local projection read failed; awaiting the next main revision.')
      },
    })
    return () => {
      stop()
    }
  }, [accountId, authenticatedAccountId])
}
