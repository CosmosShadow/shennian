// @arch docs/features/agent-workspaces.md#四信息架构
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-agent-detail-screen.test.ts

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { formatSessionPreviewForDisplay } from '@shennian/shared'
import type { AgentWorkspaceSession } from '@shennian/wire'
import { useTheme } from '../../hooks/useTheme'
import { formatSessionClockTime } from '../session-list/display'
import { RoomGroupAvatar } from '../rooms/components/RoomGroupAvatar'
import type { RoomListItem } from '../rooms/roomListCache'
import { isRoomPreviewMessage } from '../rooms/roomMessagePreview'

/** Desktop row renders only the main-owned Room list projection; it never loads messages itself. */
export function DesktopAgentRoomRow({ session, room, selected = false, showSeparator = false, onPress }: {
  session: AgentWorkspaceSession
  selected?: boolean
  showSeparator?: boolean
  room?: RoomListItem
  onPress(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const latest = isRoomPreviewMessage(room?.latestMessage) ? room?.latestMessage : null
  const raw = latest
    ? latest.text?.trim() || (latest.attachments.some((item) => item.mediaKind === 'image')
      ? t('spaces_latest_message_image')
      : latest.attachments.some((item) => item.mediaKind === 'audio')
        ? t('spaces_latest_message_audio') : t('spaces_latest_message_file'))
    : ''
  const preview = formatSessionPreviewForDisplay(raw, {
    image: t('session_preview_image'), images: (count) => t('session_preview_images', { count }),
    file: t('session_preview_file'), files: (count) => t('session_preview_files', { count }),
  })
  const roomName = room?.name ?? session.room!.roomName
  return <Pressable testID={`desktop-agent-room-${session.room!.roomId}`} accessibilityRole="button"
    accessibilityLabel={roomName} onPress={onPress} accessibilityState={{selected}}
    style={({ pressed }) => [styles.row,
      { backgroundColor: selected ? colors.selectionBackground : pressed ? colors.surfaceHover : 'transparent' }]}>
    <RoomGroupAvatar members={room?.avatarMembers ?? []} compact />
    <View style={styles.copy}>
      <View style={styles.line}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{roomName}</Text>
        <Text style={[styles.time, { color: colors.textTertiary }]}>{formatSessionClockTime(latest?.createdAt)}</Text>
      </View>
      <View style={[styles.line, styles.previewLine]}>
        <Text numberOfLines={1} style={[styles.preview, { color: colors.textMuted }]}>
          {latest ? t('spaces_latest_message_preview', { sender: latest.author.displayName, message: preview }) : t('spaces_latest_message_empty')}
        </Text>
        <Text style={[styles.mode, { color: colors.textMuted }]}>{t(`agent_mode_compact_${session.room!.activationMode}`)}</Text>
      </View>
    </View>
    {showSeparator && !selected ? <View pointerEvents="none" style={[styles.separator, { backgroundColor: colors.border }]} /> : null}
  </Pressable>
}

const styles = StyleSheet.create({
  row: { minHeight: 56, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6,
    flexDirection: 'row', alignItems: 'center', gap: 11, position: 'relative' },
  copy: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewLine: { marginTop: 2 },
  name: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  preview: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  mode: { fontSize: 12, lineHeight: 17 },
  time: { fontSize: 12, lineHeight: 17 },
  separator: { position: 'absolute', left: 53, right: 8, bottom: 0, height: StyleSheet.hairlineWidth },
})
