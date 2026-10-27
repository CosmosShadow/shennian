// @arch docs/features/agent-workspaces.md#四信息架构
// @test src/__tests__/agent-participation-navigation.test.ts
import { useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { formatSessionPreviewForDisplay } from '@shennian/shared'
import type { AgentWorkspaceSession, RoomMessageView } from '@shennian/wire'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { useAuthStore } from '../../config/auth'
import { db } from '../../storage/db'
import { formatSessionClockTime } from '../session-list/display'
import { RoomGroupAvatar } from '../rooms/components/RoomGroupAvatar'
import { getRoomBodyPreview, setRoomBodyPreview, type RoomListItem } from '../rooms/roomListCache'
import { isRoomPreviewMessage, resolveRoomMessagePreview } from '../rooms/roomMessagePreview'
import { roomAccountClient } from '../rooms/roomAccountClient'
import { RoomAgentStatusLabel } from '../rooms/components/RoomAgentStatusLabel'
import { roomActivationModeToParticipation } from '../rooms/components/roomAgentStatusPresentation'

export function AgentParticipationRoomRow({ session, room, current, onPress }: {
  session: AgentWorkspaceSession; room?: RoomListItem; current: boolean; onPress?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const roomId = session.room!.roomId
  const latest = room?.latestMessage
  const [resolved, setResolved] = useState<{ latest: typeof latest; message: RoomMessageView | null } | null>(null)
  useEffect(() => {
    let active = true
    if (!accountId || !latest || isRoomPreviewMessage(latest)) return
    void resolveRoomMessagePreview(latest, async (before) => {
      if (!active) throw new Error('cancelled')
      const local = await db.getRoomMessages(accountId, roomId, { before, limit: 50 })
      if (!active) throw new Error('cancelled')
      return local.length ? { messages: local, hasMore: local.length === 50 }
        : roomAccountClient.listMessages(roomId, { before, limit: 50 })
    }).then((message) => {
      if (!active) return
      setRoomBodyPreview(accountId, roomId, latest, message)
      setResolved({ latest, message })
    }).catch(() => {})
    return () => { active = false }
  }, [accountId, latest, roomId])
  const cached = getRoomBodyPreview(accountId, roomId, latest)
  const message = isRoomPreviewMessage(latest) ? latest : cached !== undefined ? cached
    : resolved?.latest === latest ? resolved?.message : null
  const raw = message ? message.text?.trim() || (message.attachments.some((item) => item.mediaKind === 'image')
    ? t('spaces_latest_message_image') : message.attachments.some((item) => item.mediaKind === 'audio')
      ? t('spaces_latest_message_audio') : t('spaces_latest_message_file')) : ''
  const preview = formatSessionPreviewForDisplay(raw, {
    image: t('session_preview_image'), images: (count) => t('session_preview_images', { count }),
    file: t('session_preview_file'), files: (count) => t('session_preview_files', { count }),
  })
  const paused = session.room!.activationMode === 'paused' || session.room!.status === 'paused'
  const mode = paused ? 'paused' : session.room!.activationMode
  const participation = roomActivationModeToParticipation(mode)
  return <Pressable testID={`agent-participation-${roomId}`} accessibilityRole={onPress ? "button" : undefined} disabled={!onPress}
    onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}>
    <RoomGroupAvatar members={room?.avatarMembers ?? []} />
    <View style={styles.copy}>
      <View style={styles.line}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{room?.name || session.room!.roomName || session.title}</Text>
        {current ? <Text style={[styles.mode, { color: colors.textSecondary }]}>{t('agent_participation_current_group')}</Text> : null}
        <Text style={[styles.time, { color: Platform.OS === 'web' ? colors.textTertiary : colors.textMuted }]}>{formatSessionClockTime(message?.createdAt)}</Text>
      </View>
      <View style={styles.line}>
        <Text style={[styles.preview, { color: Platform.OS === 'web' ? colors.textSecondary : colors.textMuted }]} numberOfLines={1}>
          {message ? t('spaces_latest_message_preview', { sender: message.author.displayName, message: preview }) : t('spaces_latest_message_empty')}
        </Text>
        <RoomAgentStatusLabel participation={participation} />
      </View>
    </View>
  </Pressable>
}
const styles = StyleSheet.create({
  row: { minHeight: 76, paddingHorizontal: 16, paddingVertical: 12, gap: 12, flexDirection: 'row', alignItems: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 4 }, line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, minWidth: 0, ...(Platform.OS === 'web' ? { fontSize: 17, lineHeight: 22, fontWeight: '400' } as const : mobileTypography.listTitle) },
  preview: { flex: 1, minWidth: 0, ...(Platform.OS === 'web' ? { fontSize: 13, lineHeight: 19 } : mobileTypography.secondary) },
  mode: { ...(Platform.OS === 'web' ? { fontSize: 12, lineHeight: 17 } : mobileTypography.secondary) },
  time: { ...(Platform.OS === 'web' ? { fontSize: 12, lineHeight: 17 } : mobileTypography.metadata) },
})
