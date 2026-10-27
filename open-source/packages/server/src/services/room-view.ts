// @arch open-source/docs/server-runtime.md
// @test src/__tests__/rooms-routes.test.ts

import type { RoomMessageView } from '@shennian/wire'

export type RoomMessageRecord = {
  id: string
  roomId: string
  sequence: bigint
  authorMembershipId: string
  authorPrincipalTypeSnapshot: string
  ownerUserIdSnapshot: string
  authorDisplayNameSnapshot: string
  ownerDisplayNameSnapshot?: string | null
  authorAvatarSnapshot: unknown
  mentionSnapshots?: unknown
  kind: string
  source?: string
  deliveryStatus?: string | null
  clientMessageId?: string
  text: string | null
  replyToMessageId: string | null
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
  activationCauseMessageId?: string | null
  activationRootCauseMessageId?: string | null
  activationHopCount?: number | null
  attachments?: Array<{
    id: string
    mediaKind: string
    originalName: string
    mimeType: string
    byteSize: bigint
    sha256: string
    width: number | null
    height: number | null
    durationMs: number | null
    status: string
    expiresAt?: Date | null
  }>
  authorMembership?: {
    displayAlias: string
    status: string
  }
}

export function shapeRoomMessage(message: RoomMessageRecord): RoomMessageView {
  return {
    id: message.id,
    roomId: message.roomId,
    sequence: message.sequence.toString(),
    kind: message.kind as RoomMessageView['kind'],
    source:
      message.source === 'cli' ||
      message.source === 'managed_agent' ||
      message.source === 'system'
        ? message.source
        : 'app',
    ...(message.deliveryStatus == null ? {}
      : { deliveryStatus: message.deliveryStatus as RoomMessageView['deliveryStatus'] }),
    author: {
      membershipId: message.authorMembershipId,
      principalType:
        message.authorPrincipalTypeSnapshot as RoomMessageView['author']['principalType'],
      ownerUserId: message.ownerUserIdSnapshot,
      displayName:
        message.authorMembership?.status === 'active'
          ? message.authorMembership.displayAlias
          : message.authorDisplayNameSnapshot,
      ownerDisplayName: message.ownerDisplayNameSnapshot ?? null,
      avatar: message.authorAvatarSnapshot as Record<string, unknown> | null,
    },
    mentions: shapeRoomMentions(message.mentionSnapshots),
    text: message.text,
    replyToMessageId: message.replyToMessageId,
    attachments: (message.attachments ?? []).map((attachment) => ({
      attachmentId: attachment.id,
      mediaKind: attachment.mediaKind as RoomMessageView['attachments'][number]['mediaKind'],
      name: attachment.originalName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize.toString(),
      sha256: attachment.sha256,
      width: attachment.width,
      height: attachment.height,
      durationMs: attachment.durationMs,
      status: attachment.status as RoomMessageView['attachments'][number]['status'],
      expiresAt: attachment.expiresAt?.toISOString() ?? null,
      downloadRef: `shennian-room-attachment:${attachment.id}`,
    })),
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    activationCause:
      message.activationCauseMessageId &&
      message.activationRootCauseMessageId &&
      message.activationHopCount != null
        ? {
            causeMessageId: message.activationCauseMessageId,
            rootCauseMessageId: message.activationRootCauseMessageId,
            hopCount: message.activationHopCount,
          }
        : null,
    systemEvent: shapeRoomSystemEvent(message),
  }
}

function shapeRoomSystemEvent(
  message: RoomMessageRecord,
): NonNullable<RoomMessageView['systemEvent']> | null {
  if (message.kind !== 'system' || message.source !== 'system' || !message.clientMessageId) {
    return null
  }
  const clientMessageId = message.clientMessageId
  const membership = clientMessageId.match(
    /^system:(membership-joined|membership-left|membership-removed):([^:]+):/,
  )
  if (membership) {
    const type = membership[1]!.replaceAll('-', '_') as
      | 'membership_joined'
      | 'membership_left'
      | 'membership_removed'
    const subjectMembershipId = membership[2]!
    const directSubject = subjectMembershipId === message.authorMembershipId
    const humanJoin =
      type === 'membership_joined' &&
      message.authorPrincipalTypeSnapshot === 'human' &&
      message.text?.endsWith(' joined the Room.')
    return {
      type,
      subjectMembershipId,
      ...(directSubject || humanJoin
        ? {
            subjectPrincipalType: directSubject
              ? message.authorPrincipalTypeSnapshot as RoomMessageView['author']['principalType']
              : 'human',
          }
        : {}),
    }
  }
  if (clientMessageId.startsWith('system:room-renamed:')) return { type: 'room_renamed' }
  if (clientMessageId.startsWith('system:binding-mode:')) {
    return { type: 'binding_mode_changed' }
  }
  if (clientMessageId.startsWith('system:agent-unavailable:')) {
    return { type: 'agent_unavailable' }
  }
  return null
}

function shapeRoomMentions(value: unknown): RoomMessageView['mentions'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const mention = item as Record<string, unknown>
    if (
      typeof mention.membershipId !== 'string' ||
      (mention.principalType !== 'human' && mention.principalType !== 'agent') ||
      typeof mention.displayName !== 'string'
    ) {
      return []
    }
    return [
      {
        membershipId: mention.membershipId,
        principalType: mention.principalType,
        displayName: mention.displayName,
      },
    ]
  })
}
