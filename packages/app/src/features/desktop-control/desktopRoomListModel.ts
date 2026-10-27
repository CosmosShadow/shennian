// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-list-model.test.ts
import type { RoomListItem, RoomListSnapshot } from '../rooms/roomListCache'

type State = RoomListSnapshot & { loading: boolean; failed: boolean }
type Options = {
  initial: RoomListSnapshot | null
  isCurrent(): boolean
  read(): Promise<RoomListSnapshot>
  subscribe(listener: (snapshot: RoomListSnapshot) => void): () => void
  requestSync(): Promise<unknown>
  updatePreference(roomId: string, pinned: boolean): Promise<unknown>
  deleteRoomRecord(roomId: string): Promise<void>
}

/** Desktop view state only. Main owns Room persistence and synchronization. */
export class DesktopRoomListModel {
  private state: State
  private listeners = new Set<() => void>()
  private generation = 0
  private lifetime = 0
  private active = false
  private usable: boolean
  private unsubscribe: (() => void) | null = null
  constructor(private readonly options: Options) {
    this.usable = options.initial !== null
    this.state = { ...(options.initial ?? { rooms: [], pendingRequests: [] }),
      loading: !this.usable, failed: false }
  }
  getState = (): State => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  start(): () => void {
    this.lifetime += 1
    this.active = true
    this.unsubscribe = this.options.subscribe((snapshot) => {
      if (!this.current()) return
      this.generation += 1
      this.accept(snapshot)
    })
    void this.refresh()
    return () => this.stop()
  }
  private stop(): void {
    this.lifetime += 1
    this.active = false
    this.generation += 1
    this.unsubscribe?.()
    this.unsubscribe = null
  }
  private current(): boolean { return this.active && this.options.isCurrent() }
  private publish(state: State): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
  private accept(snapshot: RoomListSnapshot): void {
    this.usable = true
    this.publish({ ...snapshot, loading: false, failed: false })
  }
  private async refresh(): Promise<void> {
    if (!this.current()) return
    const ticket = ++this.generation
    try {
      const snapshot = await this.options.read()
      if (this.current() && ticket === this.generation) this.accept(snapshot)
    } catch {
      if (this.current() && ticket === this.generation) {
        this.publish({ ...this.state, loading: false, failed: !this.usable })
      }
    }
  }
  retry = async (_silent = false): Promise<void> => {
    if (!this.current()) return
    const lifetime = this.lifetime
    try {
      await this.options.requestSync()
    } catch {
      if (this.current() && lifetime === this.lifetime) this.publish({ ...this.state, loading: false, failed: !this.usable })
      return
    }
    if (lifetime === this.lifetime) await this.refresh()
  }
  togglePin = async (room: RoomListItem): Promise<void> => {
    if (!this.current()) return
    const lifetime = this.lifetime
    await this.options.updatePreference(room.id, !room.pinnedAt)
    // No renderer mutation of the persisted inventory. The committed revision wins.
    if (this.current() && lifetime === this.lifetime) await this.retry(true)
  }
  removeRoom = async (room: RoomListItem): Promise<void> => {
    if (!this.current()) return
    const lifetime = this.lifetime
    await this.options.deleteRoomRecord(room.id)
    if (this.current() && lifetime === this.lifetime) await this.retry(true)
  }
}
