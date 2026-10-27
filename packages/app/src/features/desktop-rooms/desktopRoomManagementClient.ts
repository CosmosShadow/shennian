// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-management-client.test.ts

import type { RoomInviteLink, RoomJoinRequest } from '../rooms/roomAccountClient.types'
import type { RoomDetailView, RoomMemberView } from '../rooms/types'
import type { DesktopRoomManagementClient } from './desktopRoomManagementModel'
import { desktopRoomDataPort } from './desktopRoomDataPort'

type Operation =
  | 'room.get'
  | 'room.members.list'
  | 'room.update'
  | 'room.delete'
  | 'room.record.delete'
  | 'room.leave'
  | 'room.member.remove'
  | 'room.inviteLink.get'
  | 'room.inviteLink.reset'
  | 'room.joinRequests.list'
  | 'room.joinRequest.review'

type Result =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean; action?: 'retry' | 'sign_in' } }

type Bridge = {
  execute(command: { requestId: string; operation: Operation; input: Record<string, unknown> }): Promise<Result>
}

type DesktopWindow = typeof globalThis & { shennianDesktop?: { account?: Bridge } }

let sequence = 0

export class DesktopRoomManagementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopRoomManagementError'
  }
}

/** Desktop-only Room management port. HTTP routes, credentials and retries stay in main. */
export const desktopRoomManagementClient: DesktopRoomManagementClient = {
  async getRoom(roomId) {
    const root = object(await execute('room.get', { roomId }))
    const membershipId = root.membershipId
    if (membershipId !== null && typeof membershipId !== 'string') invalidOutput()
    return { room: room(root.room, roomId), membershipId }
  },
  async listMembers(roomId) {
    const memberships = object(await execute('room.members.list', { roomId })).memberships
    if (!Array.isArray(memberships)) invalidOutput()
    return memberships.map(member)
  },
  async listPendingJoinRequests(roomId) {
    const requests = object(await execute('room.joinRequests.list', { roomId, status: 'pending' })).joinRequests
    if (!Array.isArray(requests)) invalidOutput()
    return requests.map(joinRequest)
  },
  async getInviteLink(roomId) {
    return invite(object(await execute('room.inviteLink.get', { roomId })).invite)
  },
  async resetInviteLink(roomId) {
    return invite(object(await execute('room.inviteLink.reset', { roomId })).invite)
  },
  async updateRoom(roomId, changes) {
    return room(object(await execute('room.update', { roomId, changes })).room, roomId)
  },
  updateNotificationPreferences: desktopRoomDataPort.updateNotificationPreferences,
  async removeMember(roomId, membershipId) {
    await execute('room.member.remove', { roomId, membershipId })
  },
  async reviewJoinRequest(roomId, requestId, decision) {
    await execute('room.joinRequest.review', { roomId, requestId, decision })
  },
  async leaveRoom(roomId) {
    await execute('room.leave', { roomId })
  },
  async deleteRoomRecord(roomId) {
    await execute('room.record.delete', { roomId })
  },
  async deleteRoom(roomId) {
    await execute('room.delete', { roomId })
  },
}

function bridge(): Bridge {
  const value = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!value || typeof value.execute !== 'function') {
    throw new DesktopRoomManagementError('BRIDGE_UNAVAILABLE', 'Desktop Room management is unavailable.', false)
  }
  return value
}

async function execute(operation: Operation, input: Record<string, unknown>): Promise<unknown> {
  const result = await bridge().execute({ requestId: `desktop-room-management-${++sequence}`, operation, input })
  if (result.ok) return result.value
  throw new DesktopRoomManagementError(result.error.code, result.error.message, result.error.retryable, result.error.action)
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidOutput()
  return value as Record<string, unknown>
}

function room(value: unknown, roomId: string): RoomDetailView {
  const item = object(value)
  if (
    item.id !== roomId || typeof item.name !== 'string' || typeof item.description !== 'string' ||
    !['active', 'archived', 'deleted'].includes(String(item.status)) ||
    !['private', 'public_read'].includes(String(item.visibility)) ||
    !['open', 'approval', 'closed'].includes(String(item.joinPolicy)) ||
    typeof item.lastSequence !== 'string' || typeof item.historyFromSequence !== 'string'
  ) invalidOutput()
  return item as RoomDetailView
}

function member(value: unknown): RoomMemberView {
  const item = object(value)
  if (
    typeof item.id !== 'string' || !item.id ||
    !['human', 'agent'].includes(String(item.principalType)) ||
    typeof item.ownerUserId !== 'string' ||
    (item.parentHumanMembershipId !== null && typeof item.parentHumanMembershipId !== 'string') ||
    typeof item.displayAlias !== 'string' ||
    !['owner', 'admin', 'member'].includes(String(item.role)) ||
    typeof item.joinedAt !== 'string'
  ) invalidOutput()
  return item as RoomMemberView
}

function joinRequest(value: unknown): RoomJoinRequest {
  const item = object(value)
  const applicant = object(item.applicant)
  if (
    typeof item.id !== 'string' || !item.id || typeof applicant.id !== 'string' ||
    typeof applicant.name !== 'string' || typeof item.createdAt !== 'string' ||
    (item.message !== null && typeof item.message !== 'string')
  ) invalidOutput()
  return item as RoomJoinRequest
}

function invite(value: unknown): RoomInviteLink {
  const item = object(value)
  if (
    typeof item.id !== 'string' || !item.id || item.status !== 'active' || item.expiresAt !== null ||
    typeof item.url !== 'string' || !item.url || typeof item.version !== 'number'
  ) invalidOutput()
  return item as RoomInviteLink
}

function invalidOutput(): never {
  throw new DesktopRoomManagementError('INVALID_OUTPUT', 'Desktop Room management response is invalid.', false)
}
