// @arch docs/features/network-rooms/ui.md#四消息身份与来源
// @test src/__tests__/room-mention-picker.test.ts

import { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { filterRoomMemberGroups, getRoomMemberParticipation, groupRoomMembers } from '../roomPresentation'
import type { RoomMemberView } from '../types'
import { RoomAgentStatusLabel } from './RoomAgentStatusLabel'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'
import { mobileTypography } from '../../../theme/mobileTypography'

export function RoomMentionPicker({
  visible,
  members,
  currentUserId,
  onSelect,
  onClose,
}: {
  visible: boolean
  members: RoomMemberView[]
  currentUserId?: string | null
  onSelect: (member: RoomMemberView) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [query, setQuery] = useState('')
  const groups = useMemo(
    () => filterRoomMemberGroups(groupRoomMembers(members, currentUserId), query),
    [currentUserId, members, query],
  )

  useEffect(() => {
    if (!visible) setQuery('')
  }, [visible])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerSlot} />
            <Text style={[styles.title, { color: colors.text }]}>{t('spaces_mention_title')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              hitSlop={4}
              style={styles.headerSlot}
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <View
            style={[
              styles.search,
              { backgroundColor: colors.surfaceHover, borderColor: colors.border },
            ]}
          >
            <Ionicons name="search" size={19} color={colors.textTertiary} />
            <TextInput
              accessibilityLabel={t('spaces_mention_search')}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
              placeholder={t('spaces_mention_search')}
              placeholderTextColor={colors.textTertiary}
              style={[styles.searchInput, { color: colors.text }]}
            />
            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('clear_search')}
                hitSlop={8}
                onPress={() => setQuery('')}
              >
                <Ionicons name="close-circle" size={19} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {groups.map((group) => (
              <View key={group.human.id} style={[styles.group, { borderBottomColor: colors.border }]}>
                <MentionRow member={group.human} onSelect={onSelect} />
                {group.agents.length > 0 ? (
                  <View style={styles.agentBranch}>
                    <View style={[styles.branchLine, { backgroundColor: colors.border }]} />
                    {group.agents.map((agent) => (
                      <View key={agent.id} style={styles.agentRow}>
                        <View style={[styles.branchTick, { backgroundColor: colors.border }]} />
                        <MentionRow member={agent} onSelect={onSelect} />
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
            {groups.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>
                {t('spaces_mention_empty')}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function MentionRow({ member, onSelect }: {
  member: RoomMemberView
  onSelect: (member: RoomMemberView) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const agent = member.principalType === 'agent'
  const participation = getRoomMemberParticipation(member)
  const status = participation ? t(`spaces_agent_status_${participation}`) : null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        status
          ? `${t('spaces_mention_member', { name: member.displayAlias })}，${status}`
          : t('spaces_mention_member', { name: member.displayAlias })
      }
      onPress={() => onSelect(member)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
      ]}
    >
      <RoomIdentityAvatar
        name={member.displayAlias}
        avatar={member.avatar}
        agent={agent}
        ownerAvatar={member.ownerAvatar}
        ownerName={member.ownerDisplayName}
        size={agent ? 36 : 42}
      />
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
        {member.displayAlias}{agent ? ' · AI' : ''}
      </Text>
      {status && participation ? (
        <RoomAgentStatusLabel participation={participation} label={status} />
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    height: '90%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  headerSlot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, lineHeight: 24, fontWeight: '700', ...(Platform.OS !== 'web' && mobileTypography.navigationTitle) },
  search: {
    height: 44,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, minWidth: 0, height: 42, padding: 0, fontSize: 15, ...(Platform.OS !== 'web' && mobileTypography.body) },
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 32 },
  group: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  agentBranch: { position: 'relative', marginLeft: 21, paddingLeft: 23 },
  branchLine: {
    position: 'absolute', left: 0, top: 0, bottom: 28, width: StyleSheet.hairlineWidth,
  },
  branchTick: {
    position: 'absolute', left: -23, top: 28, width: 16, height: StyleSheet.hairlineWidth,
  },
  agentRow: { position: 'relative' },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  name: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.listTitle) },
  empty: { textAlign: 'center', fontSize: 14, lineHeight: 20, paddingTop: 40, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
})
