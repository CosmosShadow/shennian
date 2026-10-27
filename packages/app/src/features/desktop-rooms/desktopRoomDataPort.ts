// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-data-port.test.ts

import type { RoomMessageView } from '@shennian/wire'
import type { RoomListItem, RoomListSnapshot } from '../rooms/roomListCache'
import type { RoomDetailView, RoomMemberView } from '../rooms/types'
import type { RoomSendInput } from '../rooms/useRoomConversationModel.types'

type ProjectionOperation =
  | 'getRoomSummaries'
  | 'getRoomJoinRequests'
  | 'getRoomMembers'
  | 'getRoomMessages'
  | 'getRoomSyncState'

type AccountOperation =
  | 'room.preferences.update'
  | 'room.delete'
  | 'room.record.delete'
  | 'room.leave'
  | 'room.message.send'
  | 'room.readState.update'

type DesktopResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean; action?: 'retry' | 'sign_in' } }

type ProjectionBridge = {
  query(request: { requestId: string; method: ProjectionOperation; args: unknown[] }): Promise<DesktopResult>
}

type AccountBridge = {
  execute(command: { requestId: string; operation: AccountOperation; input: Record<string, unknown> }): Promise<DesktopResult>
}

type DesktopWindow = typeof globalThis & {
  shennianDesktop?: { data?: ProjectionBridge; account?: AccountBridge }
}

export type DesktopRoomConversationPort = {
  getRoom(roomId: string): Promise<{ room: RoomDetailView; membershipId: string | null }>
  listMembers(roomId: string): Promise<RoomMemberView[]>
  listMessages(roomId: string, page: { after?: string; before?: string; limit?: number }): Promise<{ messages: RoomMessageView[]; hasMore: boolean }>
  sendMessage(roomId: string, message: RoomSendInput): Promise<RoomMessageView>
  updateReadState(roomId: string, lastReadSequence: string): Promise<void>
}

let requestSequence = 0

export class DesktopRoomDataError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopRoomDataError'
  }
}

export const desktopRoomDataPort = {
  async readList(accountId: string): Promise<RoomListSnapshot> {
    const [rooms, requests] = await Promise.all([
      query('getRoomSummaries', [requireId(accountId, 'accountId')]),
      query('getRoomJoinRequests', [accountId]),
    ])
    if (!Array.isArray(rooms) || !Array.isArray(requests)) throw invalidOutput()
    return {
      rooms: rooms.map(readRoomListItem),
      pendingRequests: requests.map(readPendingRequest),
    }
  },

  async readWorkspace(accountId: string, roomId: string): Promise<{
    room: RoomDetailView
    membershipId: string | null
    members: RoomMemberView[]
  }> {
    const [detail, members] = await Promise.all([
      this.readRoom(accountId, roomId),
      this.readMembers(accountId, roomId),
    ])
    return {
      ...detail,
      members,
    }
  },

  async readRoom(accountId: string, roomId: string): Promise<{
    room: RoomDetailView
    membershipId: string | null
  }> {
    requireId(accountId, 'accountId')
    requireId(roomId, 'roomId')
    const rooms = await query('getRoomSummaries', [accountId])
    if (!Array.isArray(rooms)) throw invalidOutput()
    const summary = rooms.map(readRoomListItem).find(room => room.id === roomId)
    if (!summary) throw new DesktopRoomDataError('NOT_FOUND', 'Room is not in the Desktop projection.', false)
    const detail = readRoomDetail(summary.roomDetail ?? summary)
    // Realtime ingestion advances the summary before detail reconciliation.
    // Never use the older detail cursor to exclude already committed messages.
    const room = { ...detail, lastSequence: BigInt(summary.lastSequence) > BigInt(detail.lastSequence)
      ? summary.lastSequence : detail.lastSequence }
    if (room.id !== roomId) throw invalidOutput()
    const projectedMembershipId = summary.membershipId ?? null
    if (projectedMembershipId !== null && typeof projectedMembershipId !== 'string') throw invalidOutput()
    let membershipId: string | null = projectedMembershipId
    if (membershipId === null) {
      // Summary and member projections commit independently. On a cold launch,
      // recover only the signed-in human's committed membership; an owned Agent
      // or another member must never grant public send access.
      const rows = await query('getRoomMembers', [accountId, roomId])
      if (!Array.isArray(rows)) throw invalidOutput()
      membershipId = rows
        .map(row => readMemberRow(row, roomId))
        .find(member =>
          member.principalType === 'human' && member.ownerUserId === accountId,
        )?.id ?? null
    }
    return { room, membershipId }
  },

  async readMembers(accountId: string, roomId: string): Promise<RoomMemberView[]> {
    requireId(accountId, 'accountId')
    requireId(roomId, 'roomId')
    const rows = await query('getRoomMembers', [accountId, roomId])
    if (!Array.isArray(rows)) throw invalidOutput()
    return rows.map(row => readMemberRow(row, roomId))
  },

  async readMessages(
    accountId: string,
    roomId: string,
    page: { after?: string; before?: string; limit?: number },
  ): Promise<{ messages: RoomMessageView[]; hasMore: boolean }> {
    requireId(accountId, 'accountId')
    requireId(roomId, 'roomId')
    const limit = readLimit(page.limit ?? 50)
    const queryPage = readPage(page, limit + 1)
    const [messageRows, syncState] = await Promise.all([
      query('getRoomMessages', [accountId, roomId, queryPage]),
      query('getRoomSyncState', [accountId, roomId]),
    ])
    if (!Array.isArray(messageRows)) throw invalidOutput()
    const messages = messageRows.map(value => readMessage(value, roomId))
    const hasLocalMore = messages.length > limit
    return {
      messages: page.before === undefined ? messages.slice(0, limit) : messages.slice(-limit),
      hasMore: hasLocalMore || (page.before !== undefined && readHasOlder(syncState)),
    }
  },

  async updatePreference(roomId: string, pinned: boolean): Promise<string | null> {
    const value = requireObject(await execute('room.preferences.update', { roomId, pinned }))
    if (value.pinnedAt !== null && typeof value.pinnedAt !== 'string') throw invalidOutput()
    return value.pinnedAt
  },

  async updateNotificationPreferences(
    roomId: string,
    changes: { muteRegularNotifications?: boolean; muteMentionNotifications?: boolean },
  ): Promise<{ muteRegularNotifications: boolean; muteMentionNotifications: boolean }> {
    const value = requireObject(await execute('room.preferences.update', { roomId, ...changes }))
    return {
      muteRegularNotifications: value.muteRegularNotifications === true,
      muteMentionNotifications: value.muteMentionNotifications === true,
    }
  },

  async deleteRoom(roomId: string): Promise<void> {
    await execute('room.delete', { roomId })
  },

  async deleteRoomRecord(roomId: string): Promise<void> {
    await execute('room.record.delete', { roomId })
  },

  async leaveRoom(roomId: string): Promise<void> {
    await execute('room.leave', { roomId })
  },

  async sendMessage(roomId: string, message: RoomSendInput): Promise<RoomMessageView> {
    const value = requireObject(await execute('room.message.send', {
      roomId,
      message: toJsonObject(message),
    }))
    return readMessage(value.message, roomId)
  },

  async updateReadState(roomId: string, lastReadSequence: string): Promise<void> {
    await execute('room.readState.update', { roomId, lastReadSequence })
  },
}

export function bindDesktopRoomConversationPort(
  accountId: string,
): DesktopRoomConversationPort {
  requireId(accountId, 'accountId')
  return {
    async getRoom(roomId) {
      return desktopRoomDataPort.readRoom(accountId, roomId)
    },
    async listMembers(roomId) {
      return desktopRoomDataPort.readMembers(accountId, roomId)
    },
    listMessages: (roomId, page) => desktopRoomDataPort.readMessages(accountId, roomId, page),
    sendMessage: desktopRoomDataPort.sendMessage,
    updateReadState: desktopRoomDataPort.updateReadState,
  }
}

function projectionBridge(): ProjectionBridge {
  const bridge = (globalThis as DesktopWindow).shennianDesktop?.data
  if (!bridge || typeof bridge.query !== 'function') {
    throw new DesktopRoomDataError('BRIDGE_UNAVAILABLE', 'Desktop Room projection bridge is unavailable.', false)
  }
  return bridge
}

function accountBridge(): AccountBridge {
  const bridge = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopRoomDataError('BRIDGE_UNAVAILABLE', 'Desktop Room account bridge is unavailable.', false)
  }
  return bridge
}

async function query(method: ProjectionOperation, args: unknown[]): Promise<unknown> {
  const result = await projectionBridge().query({
    requestId: `desktop-room-projection-${Date.now()}-${++requestSequence}`,
    method,
    args,
  })
  if (result.ok) return result.value
  throw new DesktopRoomDataError(result.error.code, result.error.message, result.error.retryable, result.error.action)
}

async function execute(operation: AccountOperation, input: Record<string, unknown>): Promise<unknown> {
  const result = await accountBridge().execute({
    requestId: `desktop-room-command-${Date.now()}-${++requestSequence}`,
    operation,
    input,
  })
  if (result.ok) return result.value
  throw new DesktopRoomDataError(result.error.code, result.error.message, result.error.retryable, result.error.action)
}

function readRoomListItem(value: unknown): RoomListItem & { roomDetail?: unknown; membershipId?: unknown } {
  const room = requireObject(value)
  if (typeof room.id !== 'string' || !room.id || typeof room.name !== 'string') throw invalidOutput()
  if (room.avatarMembers !== undefined && !Array.isArray(room.avatarMembers)) throw invalidOutput()
  return room as RoomListItem & { roomDetail?: unknown; membershipId?: unknown }
}

function readRoomDetail(value: unknown): RoomDetailView {
  const room = requireObject(value)
  if (
    typeof room.id !== 'string' || !room.id ||
    typeof room.name !== 'string' ||
    typeof room.status !== 'string' ||
    typeof room.lastSequence !== 'string'
  ) throw invalidOutput()
  return room as RoomDetailView
}

function readMemberRow(value: unknown, roomId: string): RoomMemberView {
  const row = requireObject(value)
  if (row.roomId !== roomId) throw invalidOutput()
  const member = requireObject(row.payload)
  if (
    typeof member.id !== 'string' || !member.id ||
    typeof member.displayAlias !== 'string' ||
    typeof member.principalType !== 'string'
  ) throw invalidOutput()
  return member as RoomMemberView
}

function readMessage(value: unknown, roomId: string): RoomMessageView {
  const message = requireObject(value)
  if (
    typeof message.id !== 'string' || !message.id ||
    message.roomId !== roomId ||
    typeof message.sequence !== 'string'
  ) throw invalidOutput()
  return message as RoomMessageView
}

function readPendingRequest(value: unknown): RoomListSnapshot['pendingRequests'][number] {
  const request = requireObject(value)
  if (
    typeof request.id !== 'string' || !request.id ||
    typeof request.roomId !== 'string' || !request.roomId ||
    typeof request.roomName !== 'string' ||
    request.status !== 'pending' ||
    typeof request.createdAt !== 'string'
  ) throw invalidOutput()
  return request as RoomListSnapshot['pendingRequests'][number]
}

function readHasOlder(value: unknown): boolean {
  if (value === null) return false
  const state = requireObject(value)
  if (typeof state.hasOlder !== 'boolean') throw invalidOutput()
  return state.hasOlder
}

function readPage(value: { after?: string; before?: string }, limit: number): Record<string, unknown> {
  if (value.after !== undefined && typeof value.after !== 'string') throw invalidInput()
  if (value.before !== undefined && typeof value.before !== 'string') throw invalidInput()
  if (value.after !== undefined && value.before !== undefined) throw invalidInput()
  return {
    ...(value.after === undefined ? {} : { after: value.after }),
    ...(value.before === undefined ? {} : { before: value.before }),
    limit,
  }
}

function readLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 999) throw invalidInput()
  return value
}

function requireId(value: string, name: string): string {
  if (typeof value !== 'string' || !value || value.length > 191) {
    throw new DesktopRoomDataError('INVALID_INPUT', `${name} is invalid.`, false)
  }
  return value
}

function toJsonObject(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw invalidInput()
  const parsed = JSON.parse(serialized) as unknown
  return requireObject(parsed)
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOutput()
  return value as Record<string, unknown>
}

function invalidInput(): DesktopRoomDataError {
  return new DesktopRoomDataError('INVALID_INPUT', 'Desktop Room request is invalid.', false)
}

function invalidOutput(): DesktopRoomDataError {
  return new DesktopRoomDataError('INVALID_OUTPUT', 'Desktop Room projection is invalid.', false)
}
