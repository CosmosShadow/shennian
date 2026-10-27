// @covers packages/app/src/features/rooms/scopedRoomApi.ts
// @covers packages/app/app/spaces/[roomId].tsx

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../../..')

describe('scoped Room Web surface', () => {
  it('uses an isolated cookie API and remains outside the main sync layout', () => {
    const api = readFileSync(
      resolve(root, 'packages/app/src/features/rooms/scopedRoomApi.ts'),
      'utf8',
    )
    const route = readFileSync(resolve(root, 'packages/app/app/spaces/[roomId].tsx'), 'utf8')
    const html = readFileSync(resolve(root, 'packages/app/app/+html.tsx'), 'utf8')
    const screen = readFileSync(
      resolve(root, 'packages/app/src/features/rooms/ScopedRoomConversationScreen.tsx'),
      'utf8',
    )
    expect(api).toContain("credentials: 'include'")
    expect(api).not.toContain('useAuthStore')
    expect(route).toContain('ScopedRoomConversationScreen')
    expect(screen).toContain('scopedRoomEventsUrl')
    expect(screen).toContain('ComposerInputCard')
    expect(screen).toContain('RoomIdentityAvatar')
    expect(screen).toContain('uploadScopedRoomAttachment')
    expect(screen).toContain('scoped-room-composer-more-btn')
    expect(screen).toContain("label: t('composer_menu_photos')")
    expect(screen).toContain("label: t('composer_menu_files')")
    expect(screen).toContain('attachmentIds')
    expect(screen).toContain('mentionMembershipIds: selectedMentions')
    expect(screen).toContain('containsMentionToken(text, member.displayAlias)')
    expect(screen).toContain('<RoomMentionPicker')
    expect(screen).toContain("usesBrowserBottomSafeArea() ? ['top', 'bottom'] : ['top']")
    expect(html).toContain('height: 100dvh')
    expect(screen).toContain('styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.separator ?? colors.border }')
    expect(screen).toContain('styles.timeline, { backgroundColor: colors.bg }')
    expect(html).toContain("[data-testid='scoped-room-message-input']:focus")
    expect(screen).toContain("t('more')")
    expect(screen).toContain('testID="room-more-button"')
    expect(screen).toContain("'scoped_room_send_as_placeholder'")
    expect(screen).toContain('size={30}')
    expect(screen).toContain('testID={`scoped-room-message-${message.id}`}')
    expect(screen).toContain('{!own ? avatarView : null}')
    expect(screen).not.toContain('{own ? avatarView : null}')
    expect(screen).toContain('{displayName}')
    expect(screen).not.toContain("{displayName}{agent ? ' · AI' : ''}")
    expect(screen).toContain('scopedRoomSourceLabelKey(message.author.principalType, message.source)')
    expect(screen).toContain('{aiSourceKey ? <Text style={[styles.aiSource')
    expect(screen).not.toContain('borderTopWidth')
    expect(screen).not.toContain("t('scoped_room_as_user'")
    expect(screen).toContain('visibilitychange')
    expect(screen).not.toContain('useSync(')
    expect(screen).not.toContain('authApi')
  })
})
