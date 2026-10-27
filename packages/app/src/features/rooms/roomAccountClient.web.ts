// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type { User } from '@shennian/shared'
import type { RoomActivationMode, RoomMessageView, RoomSummary } from '@shennian/wire'
import type {
  RoomAccountClient,
  RoomBrowserSession,
  RoomInviteLink,
  RoomJoinRequest,
  MyRoomJoinRequest,
} from './roomAccountClient.types'
import type { LinkedRoomBindingView, RoomDetailView, RoomMemberView } from './types'
import { db } from '../../storage/db.web'
import { requireDesktopRoomReplicaAccountId } from './desktopRoomReplicaProjection.web'

export type {
  RoomBrowserSession,
  RoomInviteLink,
  RoomJoinRequest,
} from './roomAccountClient.types'
export {
  isRoomAccountForbidden,
  isRoomAccountNotFound,
} from './roomAccountClient.types'

type RoomOperation =
  | 'room.binding.getBySession'
  | 'account.profile.update'
  | 'agent.recover'
  | 'room.create'
  | 'room.list'
  | 'room.get'
  | 'room.update'
  | 'room.delete'
  | 'room.record.delete'
  | 'room.leave'
  | 'room.members.list'
  | 'room.member.remove'
  | 'room.inviteLink.get'
  | 'room.inviteLink.reset'
  | 'room.joinRequests.list'
  | 'room.joinRequest.review'
  | 'room.joinRequest.cancel'
  | 'room.browserSessions.list'
  | 'room.browserSession.revoke'
  | 'room.messages.list'
  | 'room.message.send'
  | 'room.readState.update'
  | 'room.preferences.update'
  | 'room.joinRequests.mine'
  | 'room.agentMode.update'

type DesktopResult =
  | { ok: true; value: unknown }
  | {
      ok: false
      error: {
        code: string
        message: string
        retryable: boolean
        action?: 'retry' | 'sign_in'
      }
    }

type DesktopRoomAccountBridge = {
  execute(command: {
    requestId: string
    operation: RoomOperation
    input: Record<string, unknown>
  }): Promise<DesktopResult>
}

type DesktopRoomWindow = typeof globalThis & {
  shennianDesktop?: { account?: DesktopRoomAccountBridge }
}

let requestSequence = 0

export class DesktopRoomAccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopRoomAccountError'
  }
}

export const roomAccountClient: Omit<RoomAccountClient, 'initializeAttachment' | 'completeAttachment' | 'getAttachmentDownload'> = {
  async getSessionBinding(sessionId) {
    const binding = requireObject(await execute('room.binding.getBySession', { sessionId })).binding
    if (binding === null) return null
    const record = requireObject(binding)
    const room = requireObject(record.room)
    if (typeof record.id !== 'string' || !record.id
      || !['pending_approval', 'active', 'paused', 'detached'].includes(String(record.status))
      || !['auto_follow', 'mention_only', 'paused'].includes(String(record.activationMode))
      || typeof record.agentDisplayName !== 'string'
      || typeof room.id !== 'string' || !room.id || typeof room.name !== 'string'
      || !['active', 'archived', 'deleted'].includes(String(room.status))) throw invalidOutput()
    return record as LinkedRoomBindingView
  },
  async listRooms() {
    return (await readReplica(() => db.getRoomSummaries(requireAccountId()))).map(requireRoomSummary)
  },
  async listMyJoinRequests() {
    return (await readReplica(() => db.getRoomJoinRequests(requireAccountId()))).map(requireMyJoinRequest)
  },
  async updatePreference(roomId, pinned) {
    const pinnedAt = requireObject(await execute('room.preferences.update', {
      roomId,
      pinned,
    })).pinnedAt
    if (pinnedAt !== null && typeof pinnedAt !== 'string') throw invalidOutput()
    return pinnedAt
  },
  async updateNotificationPreferences(roomId, changes) {
    const result = requireObject(await execute('room.preferences.update', {
      roomId,
      ...changes,
    }))
    return {
      muteRegularNotifications: result.muteRegularNotifications === true,
      muteMentionNotifications: result.muteMentionNotifications === true,
    }
  },
  async updateCurrentUserName(name) {
    return requireUser(requireObject(await execute('account.profile.update', { name })).user)
  },
  async createRoom(name) {
    return requireRoomSummary(requireObject(await execute('room.create', {
      name,
      visibility: 'private',
      joinPolicy: 'open',
    })).room)
  },
  async getRoom(roomId) {
    const accountId = requireAccountId()
    const summary = (await readReplica(() => db.getRoomSummaries(accountId)))
      .find((room) => room.id === roomId)
    if (!summary) throw new DesktopRoomAccountError('NOT_FOUND', 'Room is not in the local replica.', false)
    // Room summaries and member rows are committed independently. During a
    // reconciliation window the summary can temporarily omit membershipId even
    // though the signed-in human membership is already present in the committed
    // member projection. Recover only that exact owned human membership; never
    // infer access from an Agent or from an unrelated member.
    const membershipId = summary.membershipId ?? await readReplica(async () => {
      const members = await db.getRoomMembers(accountId, roomId)
      return members
        .map((member) => requireMember(member.payload))
        .find((member) => member.principalType === 'human' && member.ownerUserId === accountId)
        ?.id ?? null
    })
    const detail = requireRoom(summary.roomDetail ?? summary)
    const room = { ...detail, lastSequence: BigInt(summary.lastSequence) > BigInt(detail.lastSequence)
      ? summary.lastSequence : detail.lastSequence }
    return { room, membershipId }
  },
  async listMembers(roomId) {
    return (await readReplica(() => db.getRoomMembers(requireAccountId(), roomId)))
      .map((member) => requireMember(member.payload))
  },
  async updateRoom(roomId, changes) {
    return requireRoom(requireObject(await execute('room.update', {
      roomId,
      changes: toJsonObject(changes),
    })).room)
  },
  async deleteRoom(roomId) {
    await execute('room.delete', { roomId })
  },
  async deleteRoomRecord(roomId) {
    const value = requireObject(await execute('room.record.delete', { roomId }))
    return {
      deleted: value.deleted === true,
      activeMembershipRetained: value.activeMembershipRetained === true,
      historyFromSequence:
        typeof value.historyFromSequence === 'string' ? value.historyFromSequence : null,
      idempotent: value.idempotent === true,
    }
  },
  async leaveRoom(roomId) {
    await execute('room.leave', { roomId })
  },
  async removeMember(roomId, membershipId) {
    await execute('room.member.remove', { roomId, membershipId })
  },
  async listPendingJoinRequests(roomId) {
    const requests = requireObject(await execute('room.joinRequests.list', {
      roomId,
      status: 'pending',
    })).joinRequests
    if (!Array.isArray(requests)) throw invalidOutput()
    return requests.map(requireJoinRequest)
  },
  async reviewJoinRequest(roomId, requestId, decision) {
    await execute('room.joinRequest.review', { roomId, requestId, decision })
  },
  async cancelJoinRequest(roomId, requestId) {
    await execute('room.joinRequest.cancel', { roomId, requestId })
  },
  async getInviteLink(roomId) {
    return requireInvite(requireObject(await execute('room.inviteLink.get', { roomId })).invite)
  },
  async resetInviteLink(roomId) {
    return requireInvite(requireObject(await execute('room.inviteLink.reset', { roomId })).invite)
  },
  async listBrowserSessions(roomId) {
    const sessions = requireObject(await execute('room.browserSessions.list', { roomId })).sessions
    if (!Array.isArray(sessions)) throw invalidOutput()
    return sessions.map(requireBrowserSession)
  },
  async revokeBrowserSession(roomId, sessionId) {
    const status = requireObject(await execute('room.browserSession.revoke', {
      roomId,
      sessionId,
    })).status
    if (status !== 'revoked' && status !== 'expired') throw invalidOutput()
    return status
  },
  async listMessages(roomId, page) {
    const accountId = requireAccountId()
    const limit = page.limit ?? 50
    const [rawMessages, state] = await readReplica(() => Promise.all([
      db.getRoomMessages(accountId, roomId, { ...page, limit: limit + 1 }),
      db.getRoomSyncState(accountId, roomId),
    ]))
    const hasLocalMore = rawMessages.length > limit
    const messages = page.before === undefined
      ? rawMessages.slice(0, limit)
      : rawMessages.slice(-limit)
    return {
      messages: messages.map(requireMessage),
      hasMore: hasLocalMore || (page.before !== undefined && Boolean(state?.hasOlder)),
    }
  },
  async sendMessage(roomId, message) {
    return requireMessage(requireObject(await execute('room.message.send', {
      roomId,
      message: toJsonObject(message),
    })).message)
  },
  async updateReadState(roomId, lastReadSequence) {
    await execute('room.readState.update', { roomId, lastReadSequence })
  },
  async updateAgentMode(roomId, membershipId, update) {
    const activationMode = update.activationMode === undefined
      ? undefined
      : {
          auto_follow: 'always',
          mention_only: 'mentions',
          paused: 'off',
        }[update.activationMode]
    const value = requireObject(await execute('room.agentMode.update', {
      roomId,
      membershipId,
      ...(activationMode === undefined ? {} : { activationMode }),
      ...(update.restorePrevious === true ? { restorePrevious: true } : {}),
    }))
    if (
      (value.status !== 'active' && value.status !== 'paused') ||
      !isActivationMode(value.activationMode)
    ) throw invalidOutput()
    return { status: value.status, activationMode: value.activationMode }
  },
  async recoverAgent(agentId) {
    await execute('agent.recover', { agentId })
  },
}

async function readReplica<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof DesktopRoomAccountError) throw error
    const value = error && typeof error === 'object'
      ? error as { code?: unknown; message?: unknown; retryable?: unknown }
      : null
    throw new DesktopRoomAccountError(
      typeof value?.code === 'string' ? value.code : 'BRIDGE_UNAVAILABLE',
      typeof value?.message === 'string' ? value.message : 'Desktop Room replica is unavailable.',
      typeof value?.retryable === 'boolean' ? value.retryable : false,
    )
  }
}

function requireAccountId(): string {
  try {
    return requireDesktopRoomReplicaAccountId()
  } catch {
    throw new DesktopRoomAccountError(
      'AUTH_REQUIRED',
      'Desktop Room requires a signed-in account.',
      false,
      'sign_in',
    )
  }
}

function requireBridge(): DesktopRoomAccountBridge {
  const bridge = (globalThis as DesktopRoomWindow).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopRoomAccountError(
      'BRIDGE_UNAVAILABLE',
      'Desktop Room account bridge is unavailable.',
      false,
    )
  }
  return bridge
}

async function execute(operation: RoomOperation, input: Record<string, unknown>): Promise<unknown> {
  const requestId = `room-account-${Date.now()}-${++requestSequence}`
  const result = await requireBridge().execute({ requestId, operation, input })
  if (result.ok) return result.value
  throw new DesktopRoomAccountError(
    result.error.code,
    result.error.message,
    result.error.retryable,
    result.error.action,
  )
}

function toJsonObject(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('Room input is not JSON-compatible')
  const parsed = JSON.parse(serialized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Room input must be an object')
  }
  return parsed as Record<string, unknown>
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOutput()
  return value as Record<string, unknown>
}

function requireRoom(value: unknown): RoomDetailView {
  const room = requireObject(value)
  if (
    typeof room.id !== 'string' ||
    typeof room.name !== 'string' ||
    typeof room.status !== 'string' ||
    typeof room.lastSequence !== 'string'
  ) throw invalidOutput()
  return room as RoomDetailView
}

function requireRoomSummary(value: unknown): RoomSummary {
  const room = requireObject(value)
  if (typeof room.id !== 'string' || typeof room.name !== 'string') throw invalidOutput()
  return room as RoomSummary
}

function requireMember(value: unknown): RoomMemberView {
  const member = requireObject(value)
  if (
    typeof member.id !== 'string' ||
    typeof member.displayAlias !== 'string' ||
    typeof member.principalType !== 'string'
  ) throw invalidOutput()
  return member as RoomMemberView
}

function requireMessage(value: unknown): RoomMessageView {
  const message = requireObject(value)
  if (typeof message.id !== 'string' || typeof message.sequence !== 'string') throw invalidOutput()
  return message as RoomMessageView
}

function requireUser(value: unknown): User {
  const user = requireObject(value)
  if (typeof user.id !== 'string' || typeof user.name !== 'string') throw invalidOutput()
  return user as User
}

function requireJoinRequest(value: unknown): RoomJoinRequest {
  const request = requireObject(value)
  const applicant = requireObject(request.applicant)
  if (
    typeof request.id !== 'string' ||
    typeof applicant.id !== 'string' ||
    typeof applicant.name !== 'string' ||
    typeof request.createdAt !== 'string' ||
    (request.message !== null && typeof request.message !== 'string')
  ) throw invalidOutput()
  return request as RoomJoinRequest
}

function requireMyJoinRequest(value: unknown): MyRoomJoinRequest {
  const request = requireObject(value)
  if (
    typeof request.id !== 'string' ||
    typeof request.roomId !== 'string' ||
    typeof request.roomName !== 'string' ||
    request.status !== 'pending' ||
    typeof request.createdAt !== 'string'
  ) throw invalidOutput()
  return request as MyRoomJoinRequest
}

function requireInvite(value: unknown): RoomInviteLink {
  const invite = requireObject(value)
  if (
    typeof invite.id !== 'string' ||
    invite.status !== 'active' ||
    invite.expiresAt !== null ||
    typeof invite.url !== 'string' ||
    typeof invite.version !== 'number'
  ) throw invalidOutput()
  return invite as RoomInviteLink
}

function requireBrowserSession(value: unknown): RoomBrowserSession {
  const session = requireObject(value)
  if (
    typeof session.id !== 'string' ||
    (session.clientLabel != null && typeof session.clientLabel !== 'string') ||
    !['active', 'expired', 'revoked'].includes(String(session.status)) ||
    typeof session.createdAt !== 'string' ||
    typeof session.lastSeenAt !== 'string' ||
    typeof session.expiresAt !== 'string' ||
    (session.endedAt !== null && typeof session.endedAt !== 'string')
  ) throw invalidOutput()
  return { ...session, clientLabel: typeof session.clientLabel === 'string' ? session.clientLabel : null } as RoomBrowserSession
}

function isActivationMode(value: unknown): value is RoomActivationMode {
  return value === 'auto_follow' || value === 'mention_only' || value === 'paused'
}

function invalidOutput(): DesktopRoomAccountError {
  return new DesktopRoomAccountError('INVALID_OUTPUT', 'Desktop Room response is invalid.', false)
}
