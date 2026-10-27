// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-projection.test.ts
import type { RoomListSnapshot } from '../rooms/roomListCache'
import type { RoomClientEvent } from '../rooms/roomEvents'

/** Reads committed main-process data only; never starts a replica or writes SQLite. */
export function startDesktopRoomProjection(options: {
  readSnapshot(): Promise<RoomListSnapshot>
  publish(snapshot: RoomListSnapshot): void
  subscribe(listener: (event: RoomClientEvent) => void): () => void
  isCurrent(): boolean
  onError(error: unknown): void
}): () => void {
  let stopped = false
  let reading = false
  let revision = 0
  let dirty = false
  const refresh = () => {
    if (stopped || !options.isCurrent()) return
    revision += 1
    dirty = true
    if (!reading) void drain()
  }
  async function drain() {
    reading = true
    try {
      while (dirty && !stopped && options.isCurrent()) {
        dirty = false
        const ticket = revision
        try {
          const snapshot = await options.readSnapshot()
          if (!stopped && options.isCurrent() && ticket === revision) options.publish(snapshot)
        } catch (error) {
          if (!stopped && options.isCurrent() && ticket === revision) options.onError(error)
        }
      }
    } finally {
      reading = false
    }
  }
  // Subscribe before the initial read so a commit racing bootstrap cannot be lost.
  const unsubscribe = options.subscribe((event) => {
    if (event.event === 'room.replica.updated' || event.event === 'room.sync.request') refresh()
  })
  refresh()
  return () => {
    stopped = true
    dirty = false
    unsubscribe()
  }
}
