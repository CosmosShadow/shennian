import { ActionIcon } from '../../../components/ActionIcon'
// @arch docs/features/network-rooms/ui.md#五web--desktop-web
// @test src/__tests__/room-management-panel.test.ts

import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import type { RoomMemberView } from '../types'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'
import { mobileTypography } from '../../../theme/mobileTypography'

export function RoomMemberGrid({
  members,
  canManage,
  currentUserId,
  flush = false,
  showCount = true,
  showTitle = true,
  maxVisible,
  onShowAll,
  onRemove,
}: {
  members: RoomMemberView[]
  canManage: boolean
  currentUserId?: string | null
  flush?: boolean
  showCount?: boolean
  showTitle?: boolean
  maxVisible?: number
  onShowAll?: () => void
  onRemove?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ordered = [...members].sort((left, right) => {
    const leftSelf = left.principalType === 'human' && left.ownerUserId === currentUserId
    const rightSelf = right.principalType === 'human' && right.ownerUserId === currentUserId
    if (leftSelf !== rightSelf) return leftSelf ? -1 : 1
    if (left.principalType !== right.principalType) return left.principalType === 'human' ? -1 : 1
    return left.joinedAt.localeCompare(right.joinedAt)
  })
  const visibleMembers = typeof maxVisible === 'number' ? ordered.slice(0, maxVisible) : ordered

  return (
    <View testID="room-member-grid" style={[styles.root, flush && styles.flush]}>
      {showTitle ? (
        <Text style={[styles.title, { color: colors.text }]}>
          {showCount
            ? t('spaces_title_with_count', {
                name: t('spaces_members_title'),
                count: members.length,
              })
            : t('spaces_members_title')}
        </Text>
      ) : null}
      <View style={styles.grid}>
        {visibleMembers.map((member) => (
          <View key={member.id} style={styles.member}>
            <RoomIdentityAvatar
              name={member.displayAlias}
              avatar={member.avatar}
              agent={member.principalType === 'agent'}
              ownerAvatar={member.ownerAvatar}
              ownerName={member.ownerDisplayName}
              size={42}
            />
            <Text style={[styles.name, { color: colors.textSecondary }]} numberOfLines={1}>
              {member.displayAlias}
            </Text>
          </View>
        ))}
        {canManage && onRemove ? (
          <MemberAction
            testID="room-member-remove"
            icon="remove"
            label={t('spaces_member_remove')}
            onPress={onRemove}
          />
        ) : null}
      </View>
      {onShowAll && visibleMembers.length < ordered.length ? (
        <Pressable
          testID="room-members-show-all"
          onPress={onShowAll}
          accessibilityRole="button"
          style={styles.showAll}
        >
          <Text style={[styles.showAllText, { color: colors.textSecondary }]}>
            {t('spaces_members_view_all')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function MemberAction({
  testID,
  icon,
  label,
  onPress,
}: {
  testID: string
  icon: 'add' | 'remove'
  label: string
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.member}
    >
      <View style={[styles.action, { borderColor: colors.border }]}>
        {icon === 'add' ? <ActionIcon name="add" color={colors.textTertiary} />
          : <Ionicons name="remove" size={24} color={colors.textTertiary} />}
      </View>
      <Text style={[styles.name, { color: Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 8 },
  flush: { paddingHorizontal: 0 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 12, ...(Platform.OS !== 'web' && mobileTypography.sectionTitle) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  member: { width: 54, alignItems: 'center', gap: 5 },
  action: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { width: 58, fontSize: 10, lineHeight: 14, textAlign: 'center', ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  showAll: { alignSelf: 'center', paddingHorizontal: 12, paddingTop: 13, paddingBottom: 2 },
  showAllText: { fontSize: 13, lineHeight: 18, fontWeight: '500', ...(Platform.OS !== 'web' && mobileTypography.compactAction) },
})
