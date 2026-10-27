// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-conversation-model.test.ts
import type { RoomMessageView } from '@shennian/wire'
import type { DesktopRoomConversationPort } from '../desktop-rooms/desktopRoomDataPort'
import type { RoomDetailView, RoomMemberView } from '../rooms/types'
import type { RoomLoadStateValue } from '../rooms/components/RoomLoadState'
import type { RoomSendInput } from '../rooms/useRoomConversationModel.types'
import { incrementRoomSequence, compareRoomSequence, mergeRoomMessages } from '../rooms/roomConversationUtils'
import { waitForDesktopHistoryLoadingPaint } from '../desktop-chat/desktopHistoryLoading'

type State = {
  room: RoomDetailView | null; membershipId: string | null; members: RoomMemberView[]
  messages: RoomMessageView[]; hasOlder: boolean; loadingOlder: boolean
  olderLoadFailed: boolean; state: RoomLoadStateValue
}
type Options = {
  roomId: string
  isCurrent(): boolean
  client: DesktopRoomConversationPort
  subscribeRevision(listener: () => void): () => void
  requestSync(): Promise<void>
  onNewMessages(): void
  onForbidden(): void
}
const empty = (): State => ({ room: null, membershipId: null, members: [], messages: [],
  hasOlder: false, loadingOlder: false, olderLoadFailed: false, state: 'loading' })
export const DESKTOP_ROOM_MESSAGE_PAGE_SIZE = 300

/** Observes main-owned committed replicas; only user commands cross the account bridge. */
export class DesktopRoomConversationModel {
  private value = empty()
  private listeners = new Set<() => void>()
  private stopped = true
  private generation = 0
  private unsubscribe?: () => void
  private queue: Promise<void> = Promise.resolve()
  private refreshQueued = false
  private active = false
  private lastRead = '0'
  private acknowledged = new Map<string, RoomMessageView>()
  constructor(private readonly options: Options) {}
  getState = (): State => this.value
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  isCurrent = (): boolean => !this.stopped && this.options.isCurrent()
  start = (): (() => void) => {
    this.stopped = false
    const generation = ++this.generation
    this.queue = Promise.resolve()
    this.refreshQueued = false
    this.unsubscribe = this.options.subscribeRevision(() => { void this.refresh() })
    void this.refresh()
    return () => {
      if (generation !== this.generation) return
      this.stopped = true
      this.generation++
      this.unsubscribe?.()
    }
  }
  private valid(generation: number): boolean { return this.isCurrent() && generation === this.generation }
  private update(patch: Partial<State>): void {
    if (!this.isCurrent()) return
    this.value = { ...this.value, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  private enqueue(work: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.generation
    const next = this.queue.then(async () => { if (this.valid(generation)) await work(generation) })
    this.queue = next.catch(() => {})
    return next
  }
  refresh = (): Promise<void> => {
    if (this.refreshQueued) return this.queue
    this.refreshQueued = true
    return this.enqueue(async (generation) => {
      // New revisions during this read schedule another read after the in-flight one.
      this.refreshQueued = false
      try {
        const { room, membershipId } = await this.options.client.getRoom(this.options.roomId)
        if (!this.valid(generation)) return
        if (room.id !== this.options.roomId) throw new Error('Room replica identity is invalid.')
        const members = await this.options.client.listMembers(this.options.roomId)
        if (!this.valid(generation)) return
        const oldest = this.value.messages[0]?.sequence
        let before = incrementRoomSequence(room.lastSequence)
        let messages: RoomMessageView[] = []
        let hasOlder = false
        // Re-read the visible range authoritatively, including deletions and retention pruning.
        while (this.valid(generation)) {
          const page = await this.options.client.listMessages(room.id, { before, limit: DESKTOP_ROOM_MESSAGE_PAGE_SIZE })
          if (!this.valid(generation)) return
          if (page.messages.some((message) => message.roomId !== room.id)) throw new Error('Room message identity is invalid.')
          messages = mergeRoomMessages(page.messages, messages)
          hasOlder = page.hasMore
          const first = page.messages[0]?.sequence
          if (!first || !page.hasMore || !oldest || compareRoomSequence(first, oldest) <= 0) break
          if (compareRoomSequence(first, before) >= 0) throw new Error('Room replica cursor did not advance.')
          before = first
        }
        for (const message of messages) this.acknowledged.delete(message.id)
        for (const [id, message] of this.acknowledged) {
          if (compareRoomSequence(message.sequence, room.historyFromSequence ?? '0') < 0) this.acknowledged.delete(id)
        }
        messages = mergeRoomMessages(messages, [...this.acknowledged.values()])
        const priorLast = this.value.messages[this.value.messages.length - 1]?.sequence ?? '0'
        this.update({ room, membershipId, members, messages, hasOlder, state: 'ready' })
        if (compareRoomSequence(messages[messages.length - 1]?.sequence ?? '0', priorLast) > 0) this.options.onNewMessages()
      } catch (error) {
        if (!this.valid(generation)) return
        this.fail(error)
      }
    }).finally(() => { if (!this.isCurrent()) this.refreshQueued = false })
  }
  private fail(error: unknown): void {
    if (hasCode(error, 'FORBIDDEN') || hasCode(error, 'NOT_FOUND')
      || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'AUTH_REQUIRED')) {
      this.lastRead = '0'
      this.acknowledged.clear()
      this.update({ ...empty(), state: hasCode(error, 'NOT_FOUND') ? 'failed' : 'forbidden' })
      if (hasCode(error, 'FORBIDDEN')) this.options.onForbidden()
    } else if (this.value.state !== 'ready') this.update({ state: 'failed' })
  }
  retry = async (): Promise<void> => {
    if (!this.isCurrent()) return
    try { await this.options.requestSync() } catch { /* local data remains readable offline */ }
    await this.refresh()
  }
  loadOlderMessages = (): Promise<void> => {
    if (!this.isCurrent() || this.value.loadingOlder || !this.value.hasOlder) return Promise.resolve()
    this.update({ loadingOlder: true, olderLoadFailed: false })
    return this.enqueue(async (generation) => {
      try {
        await waitForDesktopHistoryLoadingPaint()
        if (!this.valid(generation)) return
        const before = this.value.messages[0]?.sequence
        if (!before) return
        const page = await this.options.client.listMessages(this.options.roomId, { before, limit: DESKTOP_ROOM_MESSAGE_PAGE_SIZE })
        if (!this.valid(generation)) return
        if (page.messages.some((message) => message.roomId !== this.options.roomId)) throw new Error('Room message identity is invalid.')
        this.update({ messages: mergeRoomMessages(this.value.messages, page.messages), hasOlder: page.hasMore })
      } catch (error) {
        if (!this.valid(generation)) return
        this.fail(error)
        if (this.value.state === 'ready') this.update({ olderLoadFailed: true })
      } finally { if (this.valid(generation)) this.update({ loadingOlder: false }) }
    })
  }
  sendMessage = async (input: RoomSendInput): Promise<RoomMessageView> => {
    const generation = this.generation
    if (!this.valid(generation) || this.value.state !== 'ready' || !this.value.membershipId) {
      throw new Error('Room conversation is unavailable.')
    }
    try {
      const message = await this.options.client.sendMessage(this.options.roomId, input)
      if (!this.valid(generation) || this.value.state !== 'ready') throw new Error('Room conversation changed.')
      if (message.roomId !== this.options.roomId) throw new Error('Room acknowledgement identity is invalid.')
      // Acknowledged message is short-lived UI state, never a durable renderer mutation.
      this.acknowledged.set(message.id, message)
      this.update({ messages: mergeRoomMessages(this.value.messages, [message]) })
      return message
    } catch (error) {
      if (this.valid(generation)) this.fail(error)
      throw error
    }
  }
  setRoom = (next: RoomDetailView | null | ((value: RoomDetailView | null) => RoomDetailView | null)): void => {
    this.update({ room: typeof next === 'function' ? next(this.value.room) : next })
  }
  setMembers = (next: RoomMemberView[] | ((value: RoomMemberView[]) => RoomMemberView[])): void => {
    this.update({ members: typeof next === 'function' ? next(this.value.members) : next })
  }
  setPresented = (active: boolean, sequence: string | undefined): void => {
    this.active = active
    this.markRead(sequence)
  }
  private markRead(sequence: string | undefined): void {
    if (!this.isCurrent() || !this.active || this.value.state !== 'ready'
      || !this.value.membershipId || !sequence || compareRoomSequence(sequence, this.lastRead) <= 0) return
    if (!this.value.messages.some((message) => message.sequence === sequence)) return
    if (!this.value.room || compareRoomSequence(sequence, this.value.room.lastSequence) !== 0) return
    const generation = this.generation
    this.lastRead = sequence
    void this.options.client.updateReadState(this.options.roomId, sequence).catch((error) => {
      if (!this.valid(generation)) return
      if (this.lastRead === sequence) this.lastRead = '0'
      this.fail(error)
    })
  }
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}
