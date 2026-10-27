// @arch docs/features/network-rooms/ui.md#二成员信息架构
// @test src/__tests__/room-management-panel.test.ts

import { useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { filterRoomMemberGroups, getRoomMemberParticipation, groupRoomMembers } from '../roomPresentation'
import type { RoomMemberView } from '../types'
import { roomAccountClient } from '../roomAccountClient'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'
import { RoomMemberProfileSheet } from './RoomMemberProfileSheet'
import { RoomMemberRemovalConfirmModal } from './RoomMemberRemovalConfirmModal'
import { RoomAgentStatusLabel } from './RoomAgentStatusLabel'
import { isRoomAgentIdentityDimmed } from './roomAgentStatusPresentation'

export function RoomMembersPanel({
  roomId,
  members,
  currentUserId,
  canManage = false,
  canToggleManage = false,
  onToggleManage,
  onMembersUpdated,
}: {
  roomId: string
  members: RoomMemberView[]
  currentUserId?: string | null
  canManage?: boolean
  canToggleManage?: boolean
  onToggleManage?: () => void
  onMembersUpdated?: (members: RoomMemberView[]) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [profileMember, setProfileMember] = useState<RoomMemberView | null>(null)
  const [removalTarget, setRemovalTarget] = useState<RoomMemberView | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeFailed, setRemoveFailed] = useState(false)
  const [query, setQuery] = useState('')
  const orderedGroups = groupRoomMembers(members, currentUserId)
  const groups = filterRoomMemberGroups(orderedGroups, query)
  const nativeMembers = groups.reduce<Array<{ member: RoomMemberView; isAgent: boolean }>>((all, group) => {
    all.push({ member: group.human, isAgent: false })
    all.push(...group.agents.map((member) => ({ member, isAgent: true })))
    return all
  }, [])
  const requestRemove = (member: RoomMemberView) => {
    setRemoveFailed(false)
    setRemovalTarget(member)
  }
  const confirmRemove = async () => {
    if (!removalTarget || removing) return
    setRemoving(true)
    setRemoveFailed(false)
    try {
      await roomAccountClient.removeMember(roomId, removalTarget.id)
      const removedIds = new Set([
        removalTarget.id,
        ...members
          .filter((item) => item.parentHumanMembershipId === removalTarget.id)
          .map((item) => item.id),
      ])
      onMembersUpdated?.(members.filter((item) => !removedIds.has(item.id)))
      if (profileMember && removedIds.has(profileMember.id)) setProfileMember(null)
      setRemovalTarget(null)
    } catch {
      setRemoveFailed(true)
    } finally {
      setRemoving(false)
    }
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {Platform.OS !== 'web' ? <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
        <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
        <TextInput value={query} onChangeText={setQuery} placeholder={t('mobile_search_members')}
          placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]} />
      </View> : null}
      {Platform.OS !== 'web' && canToggleManage ? canManage ? (
        <Text style={[styles.manageHelp, { color: colors.textSecondary }]}>{t('mobile_remove_members_help')}</Text>
      ) : (
        <Pressable accessibilityRole="button" testID="room-members-manage-toggle"
          style={styles.manageAction} onPress={onToggleManage}>
          <Text style={{ color: colors.navigationSelected }}>{t('spaces_manage_title')}</Text>
        </Pressable>
      ) : null}
      {query.trim() && (Platform.OS === 'web' ? groups.length === 0 : nativeMembers.length === 0) ? <Text style={[styles.empty, { color: colors.textSecondary }]}>
        {t('mobile_members_no_match')}
      </Text> : null}
      {Platform.OS !== 'web' ? nativeMembers.map(({ member, isAgent }) => {
        const agent = isAgent
        const participation = agent ? getRoomMemberParticipation(member) : null
        const offline = agent && isRoomAgentIdentityDimmed(participation)
        const status = participation ? t(`spaces_agent_status_${participation}`) : null
        const role = member.role === 'owner' || member.role === 'admin'
          ? `${t('spaces_role_admin')} · ${t('mobile_human')}` : t('mobile_human')
        const subtitle = agent ? canManage && status
          ? `${t('mobile_ai')} · ${status}` : t('mobile_ai') : role
        return <View key={member.id} style={[styles.nativeRow, { borderBottomColor: colors.border }]}>
          <Pressable accessibilityRole="button"
            accessibilityLabel={t('spaces_view_member_profile', { name: member.displayAlias })}
            style={[styles.profileButton, agent && styles.nativeAgentIndent]} onPress={() => setProfileMember(member)}>
            <RoomIdentityAvatar name={member.displayAlias} avatar={member.avatar} agent={agent}
              ownerAvatar={member.ownerAvatar} ownerName={member.ownerDisplayName}
              offline={offline} size={44} />
            <View style={styles.info}>
              <Text style={[styles.name, { color: offline ? colors.textSecondary : colors.text }]}
                numberOfLines={1}>{member.displayAlias}</Text>
              <Text style={[styles.nativeSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            {!canManage && status && participation ? <RoomAgentStatusLabel
              participation={participation} label={status} style={styles.agentStatus} /> : null}
          </Pressable>
          {canManage && member.role !== 'owner' ? <Pressable
            testID={`room-remove-member-${member.id}`} accessibilityRole="button"
            accessibilityLabel={t('spaces_member_remove')} style={styles.remove}
            onPress={() => requestRemove(member)}>
            <Ionicons name="remove-circle-outline" size={24} color={colors.error} />
          </Pressable> : null}
        </View>
      }) : groups.map((group) => (
        <View key={group.human.id} style={[styles.group, { borderBottomColor: colors.border }]}>
          <View style={styles.humanRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('spaces_view_member_profile', {
                name: group.human.displayAlias,
              })}
              style={styles.profileButton}
              onPress={() => setProfileMember(group.human)}
            >
              <RoomIdentityAvatar name={group.human.displayAlias} avatar={group.human.avatar} />
              <View style={styles.info}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {group.human.displayAlias}
                </Text>
              </View>
            </Pressable>
            {canManage && group.human.role !== 'owner' ? (
              <Pressable
                testID={`room-remove-member-${group.human.id}`}
                style={styles.remove}
                onPress={() => requestRemove(group.human)}
                accessibilityRole="button"
                accessibilityLabel={t('spaces_member_remove')}
              >
                <Ionicons name="remove-circle-outline" size={22} color={colors.error} />
              </Pressable>
            ) : null}
          </View>
          {group.agents.length > 0 ? (
            <View style={styles.agentBranch}>
              <View style={[styles.branchLine, { backgroundColor: colors.border }]} />
              {group.agents.map((agent) => {
                const participation = getRoomMemberParticipation(agent)
                const offline = isRoomAgentIdentityDimmed(participation)
                const status = participation ? t(`spaces_agent_status_${participation}`) : null
                return (
                  <View key={agent.id} style={styles.agentRow}>
                    <View style={[styles.branchTick, { backgroundColor: colors.border }]} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        status
                          ? t('spaces_agent_status_accessibility', {
                              name: agent.displayAlias,
                              status,
                            })
                          : t('spaces_view_member_profile', { name: agent.displayAlias })
                      }
                      style={styles.profileButton}
                      onPress={() => setProfileMember(agent)}
                    >
                      <RoomIdentityAvatar
                        name={agent.displayAlias}
                        avatar={agent.avatar}
                        agent
                        ownerAvatar={agent.ownerAvatar}
                        ownerName={agent.ownerDisplayName}
                        size={36}
                        offline={offline}
                      />
                      <View style={styles.info}>
                        <Text
                          style={[
                            styles.agentName,
                            { color: offline ? (Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary) : colors.text },
                          ]}
                          numberOfLines={1}
                        >
                          {agent.displayAlias} · AI
                        </Text>
                      </View>
                      {status && participation ? (
                        <RoomAgentStatusLabel
                          participation={participation}
                          label={status}
                          style={styles.agentStatus}
                        />
                      ) : null}
                    </Pressable>
                    {canManage ? (
                      <Pressable
                        testID={`room-remove-member-${agent.id}`}
                        style={styles.remove}
                        onPress={() => requestRemove(agent)}
                        accessibilityRole="button"
                        accessibilityLabel={t('spaces_member_remove')}
                      >
                        <Ionicons name="remove-circle-outline" size={21} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      ))}
      <RoomMemberProfileSheet
        member={profileMember}
        members={members}
        visible={Boolean(profileMember)}
        roomId={roomId}
        currentUserId={currentUserId}
        onMemberUpdated={(updated) => {
          onMembersUpdated?.(members.map((member) => (member.id === updated.id ? updated : member)))
          setProfileMember(updated)
        }}
        onClose={() => setProfileMember(null)}
      />
      <RoomMemberRemovalConfirmModal
        member={removalTarget}
        visible={Boolean(removalTarget)}
        removing={removing}
        failed={removeFailed}
        onClose={() => {
          if (removing) return
          setRemovalTarget(null)
          setRemoveFailed(false)
        }}
        onConfirm={() => void confirmRemove()}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 30 },
  search: { minHeight: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginVertical: 8 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  empty: { textAlign: 'center', fontSize: 14, marginTop: 26 },
  manageAction: { minHeight: 42, alignItems: 'flex-end', justifyContent: 'center' },
  manageHelp: { fontSize: 13, lineHeight: 19, marginTop: 14, marginBottom: 12 },
  nativeRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  // Half of the 44px avatar makes the Agent visibly belong to the human above it.
  nativeAgentIndent: { marginLeft: 22 },
  nativeSubtitle: { fontSize: 14, lineHeight: 19, marginTop: 3 },
  group: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  humanRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  agentBranch: { position: 'relative', marginLeft: 21, paddingLeft: 23, paddingTop: 4 },
  branchLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 18,
    width: StyleSheet.hairlineWidth,
  },
  branchTick: {
    position: 'absolute',
    left: -23,
    top: 22,
    width: 16,
    height: StyleSheet.hairlineWidth,
  },
  agentRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.listTitle) },
  agentName: { fontSize: 16, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.listTitle) },
  agentStatus: { flexShrink: 0, maxWidth: Platform.OS === 'web' ? 112 : '45%' },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
})
