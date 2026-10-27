import { UnreadCountBadge } from '../unread/UnreadCountBadge'
// @arch docs/features/published-agent-direct-conversations.md
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { formatSessionClockTime } from '../session-list/display'
import type { MyPublishedConversation } from './directConversationClient'

export function PublishedConversationListRow({ row, onPress }: { row: MyPublishedConversation; onPress: () => void }) {
  const { colors } = useTheme()
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const owner = row.role === 'owner'
  const name = owner ? row.visitorName || (zh ? '访客' : 'Visitor') : row.displayName
  const summary = owner ? (zh ? `与 ${row.displayName} 的对话` : `Chat with ${row.displayName}`) : row.description
  return <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${summary}`}
    onPress={onPress} testID={`published-conversation-${row.id}`}
    style={({ pressed }) => [styles.row, { borderBottomColor: colors.border,
      backgroundColor: pressed ? colors.surfaceHover : colors.bg }]}>
    <RoomIdentityAvatar name={name} agent={!owner} size={44} />
    <View style={styles.copy}>
      <View style={styles.titleRow}>
        <Text style={[mobileTypography.listTitle, styles.title, { color: colors.text }]} numberOfLines={1}>{name}</Text>
        <Text style={[mobileTypography.metadata, { color: colors.textMuted }]}>{formatSessionClockTime(row.lastActivityAt)}</Text>
      </View>
      <Text style={[mobileTypography.secondary, { color: colors.textMuted }]} numberOfLines={1}>{summary}</Text>
    </View>
    {owner ? <UnreadCountBadge count={row.unreadCount ?? 0} /> : null}
  </Pressable>
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
    minHeight: 80, borderBottomWidth: StyleSheet.hairlineWidth },
  copy: { flex: 1, minWidth: 0, gap: 4 }, titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { flex: 1 },
})
