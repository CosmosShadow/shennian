// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/room-invitation-client.test.ts
import type { RoomInvitationClient, RoomInvitationExchange, RoomInvitationResult } from './roomInvitationClient.types'
type Result = { ok: true; value: unknown } | { ok: false; error: {
  code: string; message: string; retryable: boolean; action?: string
} }
type Root = typeof globalThis & { shennianDesktop?: { account?: {
  execute(command: { requestId: string; operation: string; input: object }): Promise<Result>
} } }
let sequence = 0
const invalid = () => Object.assign(new Error('Desktop invitation response is invalid.'), { code: 'INVALID_OUTPUT' })
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
async function execute(operation: 'room.invitation.exchange' | 'room.invitation.join', input: object) {
  const bridge = (globalThis as Root).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw Object.assign(new Error('Desktop invitation bridge is unavailable.'), { code: 'BRIDGE_UNAVAILABLE' })
  }
  const result = await bridge.execute({ requestId: `room-invitation-${Date.now()}-${++sequence}`, operation, input })
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
  return object(result.value)
}
export const roomInvitationClient: RoomInvitationClient = {
  async exchange(input) {
    const value = await execute('room.invitation.exchange', input)
    let roomId: unknown
    if (value.entryState === 'can_join') {
      const room = object(object(value.invite).room)
      roomId = room.id
      if (typeof value.joinHandle !== 'string' || !value.joinHandle ||
          typeof room.name !== 'string' || typeof room.description !== 'string' ||
          !['open', 'approval', 'closed'].includes(String(room.joinPolicy))) throw invalid()
    } else if (value.entryState === 'joined' || value.entryState === 'pending_approval') {
      roomId = value.roomId
    } else throw invalid()
    if (typeof roomId !== 'string' || !roomId || (input.roomId && input.roomId !== roomId)) throw invalid()
    return value as RoomInvitationExchange
  },
  async join(input) {
    const value = await execute('room.invitation.join', input)
    if (!['joined', 'pending_approval'].includes(String(value.outcome)) ||
        typeof value.roomId !== 'string' || !value.roomId) throw invalid()
    if (value.joinRequestId !== undefined &&
        (typeof value.joinRequestId !== 'string' || !value.joinRequestId)) throw invalid()
    return value as RoomInvitationResult
  },
}
