// @arch docs/features/desktop-room-entry.md
// @test ../../__tests__/desktop-room-entry-client.test.ts

export type DesktopRoomEntrySummary = { id: string; name: string }
export type DesktopRoomInvitation = {
  room: { id: string; name: string; description: string; joinPolicy: 'open' | 'approval' | 'closed' }
}
export type DesktopRoomInvitationExchange = {
  entryState: 'joined' | 'pending_approval' | 'can_join'
  roomId?: string
  invite?: DesktopRoomInvitation
  joinHandle?: string
}
export type DesktopRoomInvitationResult = {
  outcome: 'joined' | 'pending_approval'
  roomId: string
  joinRequestId?: string
}

type Operation =
  | 'room.create'
  | 'room.invitation.exchange'
  | 'room.invitation.join'
  | 'room.joinRequest.cancel'

type Result =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean; action?: 'retry' | 'sign_in' } }

type Bridge = {
  execute(command: { requestId: string; operation: Operation; input: Record<string, unknown> }): Promise<Result>
}

type DesktopWindow = typeof globalThis & { shennianDesktop?: { account?: Bridge } }

let sequence = 0

export class DesktopRoomEntryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopRoomEntryError'
  }
}

/** Desktop-only entry port. Main owns credentials, HTTP routes and error normalization. */
export const desktopRoomEntryClient = {
  async create(name: string): Promise<DesktopRoomEntrySummary> {
    const value = object(object(await execute('room.create', {
      name,
      visibility: 'private',
      joinPolicy: 'open',
    })).room)
    if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string') invalidOutput()
    return value as DesktopRoomEntrySummary
  },

  async exchange(input: { roomId?: string; token: string }): Promise<DesktopRoomInvitationExchange> {
    const value = object(await execute('room.invitation.exchange', input))
    let roomId: unknown
    if (value.entryState === 'can_join') {
      const room = object(object(value.invite).room)
      roomId = room.id
      if (
        typeof value.joinHandle !== 'string' || !value.joinHandle ||
        typeof room.name !== 'string' || typeof room.description !== 'string' ||
        !['open', 'approval', 'closed'].includes(String(room.joinPolicy))
      ) invalidOutput()
    } else if (value.entryState === 'joined' || value.entryState === 'pending_approval') {
      roomId = value.roomId
    } else invalidOutput()
    if (typeof roomId !== 'string' || !roomId || (input.roomId && input.roomId !== roomId)) invalidOutput()
    return value as DesktopRoomInvitationExchange
  },

  async join(input: { joinHandle: string; message?: string }): Promise<DesktopRoomInvitationResult> {
    const value = object(await execute('room.invitation.join', input))
    if (
      !['joined', 'pending_approval'].includes(String(value.outcome)) ||
      typeof value.roomId !== 'string' || !value.roomId ||
      (value.joinRequestId !== undefined && (typeof value.joinRequestId !== 'string' || !value.joinRequestId))
    ) invalidOutput()
    return value as DesktopRoomInvitationResult
  },

  async cancelRequest(roomId: string, requestId: string): Promise<void> {
    await execute('room.joinRequest.cancel', { roomId, requestId })
  },
}

function bridge(): Bridge {
  const value = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!value || typeof value.execute !== 'function') {
    throw new DesktopRoomEntryError('BRIDGE_UNAVAILABLE', 'Desktop Room entry is unavailable.', false)
  }
  return value
}

async function execute(operation: Operation, input: Record<string, unknown>): Promise<unknown> {
  const result = await bridge().execute({ requestId: `desktop-room-entry-${++sequence}`, operation, input })
  if (result.ok) return result.value
  throw new DesktopRoomEntryError(result.error.code, result.error.message, result.error.retryable, result.error.action)
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidOutput()
  return value as Record<string, unknown>
}

function invalidOutput(): never {
  throw new DesktopRoomEntryError('INVALID_OUTPUT', 'Desktop Room entry response is invalid.', false)
}
