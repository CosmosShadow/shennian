// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test ../../__tests__/desktop-room-management.test.ts

import type { TFunction } from 'i18next'
import { roomShareCopyValue } from '../rooms/roomShare'

export function buildDesktopRoomInvitation(
  t: TFunction,
  roomName: string,
  url: string,
  invitationsClosed: boolean,
) {
  const purpose = invitationsClosed ? 'open' as const : 'invite' as const
  return {
    purpose,
    hint: t(invitationsClosed ? 'spaces_share_closed_hint' : 'spaces_share_join_hint'),
    text: roomShareCopyValue({
      title: t(purpose === 'invite' ? 'spaces_invitation_text' : 'spaces_group_text', {
        name: roomName,
      }),
      instruction: t(
        purpose === 'invite' ? 'spaces_invite_ai_instruction' : 'spaces_group_ai_instruction',
      ),
      url,
      urlLabel: t(purpose === 'invite' ? 'spaces_invite_url_label' : 'spaces_group_url_label'),
      installLabel: t('spaces_install_url_label'),
    }),
  }
}
