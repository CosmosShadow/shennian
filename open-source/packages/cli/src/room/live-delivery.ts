// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-live-delivery.test.ts

import type { ReqFrame, RoomMessageView } from '@shennian/wire'
import type { CliRelayClient } from '../relay/client.js'
import type { RoomMirrorSyncService } from './mirror-sync-service.js'

export async function handleLiveRoomDelivery(
  client: Pick<CliRelayClient, 'sendRes'>,
  mirror: RoomMirrorSyncService | null,
  req: ReqFrame,
): Promise<void> {
  try {
    if (!mirror) throw new Error('room_delivery_unavailable')
    const message = parseRoomMessage(req.params.message)
    const result = await mirror.deliverLive(message)
    client.sendRes({ type: 'res', id: req.id, ok: true, payload: result })
  } catch (error) {
    client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : 'invalid_room_delivery',
    })
  }
}

export function parseRoomMessage(value: unknown): RoomMessageView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const message = value as Partial<RoomMessageView>
  if (
    typeof message.id !== 'string' || !message.id || message.id.length > 191 ||
    typeof message.roomId !== 'string' || !message.roomId || message.roomId.length > 191 ||
    typeof message.sequence !== 'string' || !/^\d+$/.test(message.sequence) ||
    (message.kind !== 'text' && message.kind !== 'attachment' && message.kind !== 'mixed' && message.kind !== 'system') ||
    !message.author || typeof message.author !== 'object' ||
    typeof message.author.membershipId !== 'string' || !message.author.membershipId ||
    (message.author.principalType !== 'human' && message.author.principalType !== 'agent') ||
    typeof message.author.ownerUserId !== 'string' || !message.author.ownerUserId ||
    typeof message.author.displayName !== 'string' || !message.author.displayName ||
    typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt)) ||
    !Array.isArray(message.attachments)
  ) invalid()
  validateSystemEvent(message.systemEvent)
  return message as RoomMessageView
}

function validateSystemEvent(value: RoomMessageView['systemEvent']): void {
  if (value == null) return
  const allowed = new Set([
    'membership_joined',
    'membership_left',
    'membership_removed',
    'room_renamed',
    'binding_mode_changed',
    'agent_unavailable',
  ])
  if (
    typeof value !== 'object' ||
    !allowed.has(value.type) ||
    (value.subjectMembershipId !== undefined &&
      (typeof value.subjectMembershipId !== 'string' || !value.subjectMembershipId)) ||
    (value.subjectPrincipalType !== undefined &&
      value.subjectPrincipalType !== 'human' &&
      value.subjectPrincipalType !== 'agent')
  ) invalid()
}

function invalid(): never {
  throw new Error('invalid_room_delivery')
}
