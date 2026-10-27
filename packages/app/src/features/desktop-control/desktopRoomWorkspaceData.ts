// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-workspace-data.test.ts
import type { RoomDetailView, RoomMemberView } from '../rooms/types'
import type { WorkspaceLoadState } from '../rooms/useRoomWorkspaceData.types'
type State = {
  room: RoomDetailView | null
  members: RoomMemberView[]
  membersLoaded: boolean
  loadState: WorkspaceLoadState
}
export class DesktopRoomWorkspaceData {
  private generation = 0
  private listeners = new Set<() => void>()
  private state: State
  constructor(private readonly options: {
    roomId: string
    isCurrent(): boolean
    read(): Promise<{ room: RoomDetailView; members: RoomMemberView[] }>
    initialSnapshot?: { room: RoomDetailView; members: RoomMemberView[] }
  }) {
    this.state = options.initialSnapshot
      ? { ...options.initialSnapshot, membersLoaded: true, loadState: 'ready' }
      : { room: null, members: [], membersLoaded: false, loadState: 'loading' }
  }
  getState = (): State => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  cancelLoad = (): void => { this.generation += 1 }
  private publish(state: State): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
  setMembers = (value: RoomMemberView[] | ((members: RoomMemberView[]) => RoomMemberView[])): void => {
    if (!this.options.isCurrent()) return
    // Session-restart UI acknowledgement is ephemeral, never a SQLite mutation.
    this.generation += 1
    this.publish({ ...this.state, members: typeof value === 'function' ? value(this.state.members) : value })
  }
  load = async (_options: { preserveContent?: boolean } = {}): Promise<void> => {
    if (!this.options.isCurrent()) return
    const ticket = ++this.generation
    try {
      const snapshot = await this.options.read()
      if (!this.options.isCurrent() || ticket !== this.generation) return
      if (snapshot.room.id !== this.options.roomId) throw Object.assign(new Error('Mismatched room'), { code: 'INVALID_OUTPUT' })
      this.publish({ ...snapshot, membersLoaded: true, loadState: 'ready' })
    } catch (error) {
      if (!this.options.isCurrent() || ticket !== this.generation) return
      const code = (error as { code?: string })?.code
      if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'AUTH_REQUIRED') {
        this.publish({ room: null, members: [], membersLoaded: false,
          loadState: code === 'NOT_FOUND' ? 'failed' : 'unavailable' })
      } else if (!this.state.room) {
        this.publish({ ...this.state, loadState: 'failed' })
      }
    }
  }
}
