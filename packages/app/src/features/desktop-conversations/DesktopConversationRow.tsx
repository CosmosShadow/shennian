// @arch docs/architecture/desktop/unified-desktop.md#7-信息架构
// Presentation only: the canonical Room projection supplies these values.

import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

export type DesktopConversationRowView = {
  id: string
  title: string
  preview: string
  timeLabel: string
  kind: 'group' | 'person' | 'agent'
  unreadCount: number
  active: boolean
}

/** A compact social conversation row for the existing single-tree Desktop sidebar. */
export function DesktopConversationRow({ conversation, onOpen }: {
  conversation: DesktopConversationRowView
  onOpen(id: string): void
}) {
  const { i18n } = useTranslation()
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const kindLabel = i18n.language.startsWith('zh')
    ? conversation.kind === 'agent' ? 'AI' : conversation.kind === 'person' ? '真人' : '多人'
    : conversation.kind === 'agent' ? 'AI' : conversation.kind === 'person' ? 'Person' : 'Group'
  const icon = conversation.kind === 'agent' ? 'sparkles-outline'
    : conversation.kind === 'person' ? 'person-outline' : 'people-outline'
  return <Pressable
    testID={`desktop-conversation-row-${conversation.id}`}
    accessibilityRole="button"
    accessibilityLabel={`${conversation.title}, ${kindLabel}`}
    accessibilityState={{ selected: conversation.active }}
    onPress={() => onOpen(conversation.id)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => [styles.row, {
      backgroundColor: conversation.active ? colors.selectionBackground
        : pressed || hovered ? colors.surfaceHover : 'transparent',
      borderColor: focused ? colors.brand : 'transparent',
    }]}
  >
    <View style={[styles.avatar, { backgroundColor: colors.brandLight }]}>
      <Ionicons name={icon} size={19} color={colors.brand} />
    </View>
    <View style={styles.content}>
      <View style={styles.heading}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{conversation.title}</Text>
        <Text style={[styles.time, { color: colors.textTertiary }]}>{conversation.timeLabel}</Text>
      </View>
      <View style={styles.secondary}>
        <Text numberOfLines={1} style={[styles.preview, { color: colors.textSecondary }]}>{conversation.preview || kindLabel}</Text>
        {conversation.unreadCount > 0 ? <View style={[styles.unread, { backgroundColor: colors.brand }]}>
          <Text style={styles.unreadText}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</Text>
        </View> : null}
      </View>
    </View>
  </Pressable>
}

const styles = StyleSheet.create({
  row: { minHeight: 62, marginHorizontal: 7, marginVertical: 2, paddingHorizontal: 8, borderWidth: 1, borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  content: { minWidth: 0, flex: 1, gap: 3 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { ...desktopTypography.sidebarItem, flex: 1, minWidth: 0, fontWeight: '600' },
  time: { fontSize: 11, lineHeight: 15 }, secondary: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  preview: { fontSize: 12, lineHeight: 16, flex: 1, minWidth: 0 },
  unread: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unreadText: { color: '#fff', fontSize: 10, lineHeight: 13, fontWeight: '700' },
})
