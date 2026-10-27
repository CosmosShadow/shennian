// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-share.test.ts

export type RoomSharePolicy = 'open' | 'approval' | 'closed'

export const ROOM_INVITE_INSTALL_URL = 'https://shennian.net/install.md'

export function roomShareCopyValue(input: {
  title: string
  instruction: string
  url: string
  urlLabel: string
  installLabel: string
  installUrl?: string
}) {
  return [
    input.title,
    input.instruction,
    input.urlLabel + '：' + input.url,
    input.installLabel + '：' + (input.installUrl ?? ROOM_INVITE_INSTALL_URL),
  ].join('\n')
}

// A missing invitation is a load failure, never an implicit downgrade to a group link.
export function resolveRoomShare(roomUrl: string, inviteUrl: string, joinPolicy: RoomSharePolicy) {
  if (joinPolicy === 'closed') {
    return { url: roomUrl, purpose: 'open' as const, hintKey: 'spaces_share_closed_hint' as const }
  }
  if (!inviteUrl) return null
  return {
    url: inviteUrl,
    purpose: 'invite' as const,
    hintKey: joinPolicy === 'approval'
      ? 'spaces_share_approval_hint' as const
      : 'spaces_share_join_hint' as const,
  }
}
