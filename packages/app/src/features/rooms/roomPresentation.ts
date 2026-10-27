// @arch docs/features/network-rooms/ui.md#二成员信息架构
// @test src/__tests__/room-presentation.test.ts

import type { RoomAttachmentView, RoomAuthorSnapshot } from '@shennian/wire'
import {
  deriveCompactAgentParticipation,
  type CompactAgentParticipation,
} from '@shennian/shared/agent-participation'
import type { RoomMemberView } from './types'

export type RoomMemberGroup = {
  human: RoomMemberView
  agents: RoomMemberView[]
  isSelf: boolean
}

export function groupRoomMembers(
  members: RoomMemberView[],
  currentUserId: string | null | undefined,
): RoomMemberGroup[] {
  const agentsByParent = new Map<string, RoomMemberView[]>()
  for (const member of members) {
    if (member.principalType !== 'agent' || !member.parentHumanMembershipId) continue
    const agents = agentsByParent.get(member.parentHumanMembershipId) ?? []
    agents.push(member)
    agentsByParent.set(member.parentHumanMembershipId, agents)
  }
  return members
    .filter((member) => member.principalType === 'human')
    .map((human) => ({
      human,
      agents: (agentsByParent.get(human.id) ?? []).sort(compareMembers),
      isSelf: human.ownerUserId === currentUserId,
    }))
    .sort((left, right) => {
      if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1
      return compareMembers(left.human, right.human)
    })
}

/** A matching human keeps all their Agents; otherwise only matching Agents remain under them. */
export function filterRoomMemberGroups(
  groups: RoomMemberGroup[],
  query: string,
): RoomMemberGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return groups
  const matches: RoomMemberGroup[] = []
  for (const group of groups) {
    const humanMatches = group.human.displayAlias.toLocaleLowerCase().includes(normalizedQuery)
    const agents = humanMatches
      ? group.agents
      : group.agents.filter((agent) =>
          agent.displayAlias.toLocaleLowerCase().includes(normalizedQuery),
        )
    if (humanMatches || agents.length > 0) matches.push({ ...group, agents })
  }
  return matches
}

export function isOwnRoomAuthor(
  author: RoomAuthorSnapshot,
  currentUserId: string | null | undefined,
): boolean {
  return Boolean(currentUserId && author.ownerUserId === currentUserId)
}

export function isRoomImageOnlyMessage(message: {
  deletedAt?: unknown
  text?: string | null
  attachments: ReadonlyArray<{ mediaKind: string }>
}): boolean {
  return !message.deletedAt
    && !message.text
    && message.attachments.length > 0
    && message.attachments.every((attachment) => attachment.mediaKind === 'image')
}

/** Splits a display name so the card can ellipsize the stem while always keeping the extension visible. */
export function splitAttachmentName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1 || name.length - dot > 12) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

export function isRoomVideoAttachment(attachment: { mediaKind: string; mimeType?: string | null }): boolean {
  return attachment.mediaKind === 'video' || Boolean(attachment.mimeType?.toLowerCase().startsWith('video/'))
}

export function roomAttachmentExpiryKind(
  attachment: Pick<RoomAttachmentView, 'mediaKind' | 'status' | 'expiresAt'>,
  now = Date.now(),
): 'image' | 'attachment' | null {
  const expiresAt = attachment.expiresAt ? Date.parse(attachment.expiresAt) : Number.NaN
  const expired = attachment.status === 'expired'
    || (Number.isFinite(expiresAt) && expiresAt <= now)
  if (!expired) return null
  return attachment.mediaKind === 'image' ? 'image' : 'attachment'
}

export function linkedAgentSessionId(
  member: RoomMemberView,
  currentUserId: string | null | undefined,
): string | null {
  if (
    member.principalType !== 'agent' ||
    !currentUserId ||
    member.ownerUserId !== currentUserId ||
    !member.ownBinding?.nianSessionId ||
    (member.ownBinding.status !== 'active' && member.ownBinding.status !== 'paused')
  ) {
    return null
  }
  return member.ownBinding.nianSessionId
}

export function getRoomMemberParticipation(
  member: RoomMemberView | null | undefined,
): CompactAgentParticipation | null {
  if (!member) return null
  return deriveCompactAgentParticipation({
    principalType: member.principalType,
    activationMode: member.agentParticipation?.activationMode ?? member.ownBinding?.activationMode,
    availability: member.agentParticipation?.availability ?? member.ownBinding?.availability,
    bindingStatus: member.ownBinding?.status,
  })
}

export function avatarFromSnapshot(value: unknown): { smallUrl: string; mediumUrl: string } | null {
  if (!value || typeof value !== 'object') return null
  const avatar = value as Record<string, unknown>
  if (typeof avatar.smallUrl !== 'string' || typeof avatar.mediumUrl !== 'string') return null
  return { smallUrl: avatar.smallUrl, mediumUrl: avatar.mediumUrl }
}

/** Active members use their current avatar; the immutable message snapshot is only a fallback. */
export function roomMessageAvatars(
  snapshot: unknown,
  member: RoomMemberView | null | undefined,
  agent: boolean,
): {
  avatar: RoomMemberView['avatar'] | { smallUrl: string; mediumUrl: string } | null
  ownerAvatar: RoomMemberView['ownerAvatar'] | { smallUrl: string; mediumUrl: string } | null
} {
  const snapshotAvatar = avatarFromSnapshot(snapshot)
  if (!member) {
    return { avatar: snapshotAvatar, ownerAvatar: agent ? snapshotAvatar : null }
  }
  return {
    avatar: member.avatar,
    ownerAvatar: agent ? member.ownerAvatar : null,
  }
}

function compareMembers(left: RoomMemberView, right: RoomMemberView): number {
  return left.joinedAt.localeCompare(right.joinedAt) || left.id.localeCompare(right.id)
}
