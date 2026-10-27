// @arch docs/features/network-rooms/ui.md#七群聊详情

import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AppPageHeader } from '../../../src/components/AppPageHeader'
import BottomSheet from '../../../src/components/BottomSheet'
import { contactAccountClient, type SavedContact } from '../../../src/features/contacts/contactAccountClient'
import { roomContactInvitationClient } from '../../../src/features/contacts/roomContactInvitationClient'
import { roomAccountClient } from '../../../src/features/rooms/roomAccountClient'
import { RoomIdentityAvatar } from '../../../src/features/rooms/components/RoomIdentityAvatar'
import type { RoomMemberView } from '../../../src/features/rooms/types'
import { useAuthStore } from '../../../src/config/auth'
import { useTheme } from '../../../src/hooks/useTheme'

export default function AddConversationMembersScreen() {
  const { roomId = '' } = useLocalSearchParams<{ roomId: string }>()
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const userId = useAuthStore((state) => state.user?.id)
  const [contacts, setContacts] = useState<SavedContact[]>([])
  const [members, setMembers] = useState<RoomMemberView[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showSelected, setShowSelected] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useFocusEffect(useCallback(() => {
    let active = true
    setLoading(true)
    setFailed(false)
    void Promise.all([
      contactAccountClient.list(),
      roomAccountClient.listMembers(roomId),
      roomAccountClient.getRoom(roomId),
    ]).then(([contactData, memberData, roomData]) => {
      if (!active) return
      if (roomData.room.status !== 'active') throw new Error('room_inactive')
      setContacts(contactData.contacts)
      setMembers(memberData)
    }).catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [roomId, reloadKey]))

  const ownHuman = members.find((member) => member.principalType === 'human' && member.ownerUserId === userId)
  const isOwner = ownHuman?.role === 'owner'
  const available = contacts.filter((item) => item.kind === 'human'
    ? Boolean(item.userId && item.userId !== userId
      && !members.some((member) => member.principalType === 'human' && member.ownerUserId === item.userId))
    : Boolean(item.agentWorkspaceId
      ? !members.some((member) => member.principalType === 'agent'
        && member.agentIdentityId === item.agentWorkspaceId)
      : true))
  const chosen = selected.flatMap((id) => {
    const item = available.find((contact) => contact.id === id)
    return item ? [item] : []
  })
  const people = chosen.filter((item) => item.kind === 'human' && item.userId)
  const ownAgents = chosen.filter((item) => item.kind === 'agent' && item.owned && item.agentWorkspaceId)
  const matches = available.filter((item) => item.displayName.toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase()))
  const sections = [
    { key: 'mine', title: t('mobile_my_ai'), items: matches.filter((item) => item.kind === 'agent' && item.owned && item.agentWorkspaceId) },
    { key: 'people', title: t('mobile_other_people'), items: matches.filter((item) => item.kind === 'human' && item.userId) },
    { key: 'agents', title: t('mobile_other_ai'), items: matches.filter((item) => item.kind === 'agent' && !item.owned) },
  ]
  const toggle = (item: SavedContact) => {
    if (item.kind === 'agent' && !item.owned) {
      Alert.alert(t('mobile_add_members'), t('mobile_other_ai_add_unavailable'))
      return
    }
    if (item.kind === 'human' && !isOwner) {
      Alert.alert(t('mobile_add_members'), t('mobile_only_owner_invites_people'))
      return
    }
    setSelected((current) => current.includes(item.id)
      ? current.filter((id) => id !== item.id)
      : current.length < 20 ? [...current, item.id] : current)
  }
  const submit = async () => {
    if (busy || !chosen.length) return
    setBusy(true)
    try {
      if (people.length) {
        await roomContactInvitationClient.inviteExisting(roomId, people.map((item) => item.userId!))
      }
      if (ownAgents.length) {
        router.replace({ pathname: '/(main)/spaces/agent-add', params: {
          roomId, selectedAgentIds: ownAgents.map((item) => item.agentWorkspaceId).join(','), returnTo: 'details',
        } })
      } else {
        Alert.alert(t('mobile_members_added'), undefined, [
          { text: t('done'), onPress: () => router.back() },
        ])
      }
    } catch {
      Alert.alert(t('mobile_add_members'), t('mobile_invitation_failed'))
    } finally {
      setBusy(false)
    }
  }

  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={t('mobile_add_members')} onBack={() => router.back()} />
    <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
      {chosen.length ? <>
        {chosen.slice(0, 2).map((item) => <Pressable key={item.id} onPress={() => setShowSelected(true)}
          accessibilityRole="button" accessibilityLabel={t('mobile_selected_members_count', { count: chosen.length })}
          style={styles.selectedAvatar}>
          <RoomIdentityAvatar name={item.displayName} avatar={item.avatar} agent={item.kind === 'agent'} size={30} />
        </Pressable>)}
        {chosen.length > 2 ? <Pressable onPress={() => setShowSelected(true)} accessibilityRole="button"
          accessibilityLabel={t('mobile_selected_members_count', { count: chosen.length })}
          style={[styles.overflow, { backgroundColor: colors.bg }]}>
          <Text style={{ color: colors.brand, fontSize: 13, fontWeight: '600' }}>+{chosen.length - 2}</Text>
        </Pressable> : null}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
      </> : null}
      <Ionicons name="search-outline" size={21} color={colors.textSecondary} />
      <TextInput value={query} onChangeText={setQuery} placeholder={t('mobile_search_people_ai')}
        placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]} />
    </View>
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color={colors.brand} /> : failed ? <Pressable onPress={() => setReloadKey((value) => value + 1)} style={styles.empty}>
        <Text style={{ color: colors.textSecondary }}>{t('mobile_contacts_load_failed')}</Text>
        <Text style={{ color: colors.brand }}>{t('retry')}</Text>
      </Pressable> : sections.some((section) => section.items.length) ? sections.map((section) =>
        section.items.length ? <View key={section.key}>
          <Text style={[styles.section, { color: colors.textSecondary, backgroundColor: colors.surfaceHover }]}>{section.title}</Text>
          {section.items.map((item) => {
            const disabled = item.kind === 'agent' && !item.owned || item.kind === 'human' && !isOwner
            return <Pressable key={item.id} onPress={() => toggle(item)} accessibilityRole="checkbox"
              accessibilityState={{ checked: selected.includes(item.id), disabled }}
              accessibilityHint={disabled ? t(item.kind === 'human'
                ? 'mobile_only_owner_invites_people' : 'mobile_other_ai_add_unavailable') : undefined}
              style={[styles.row, { borderBottomColor: colors.border }]}>
              <RoomIdentityAvatar name={item.displayName} avatar={item.avatar} agent={item.kind === 'agent'} size={42} />
              <View style={styles.rowText}>
                <Text style={[styles.rowName, { color: disabled ? colors.textSecondary : colors.text }]} numberOfLines={1}>{item.displayName}</Text>
                {disabled ? <Text style={[styles.rowHint, { color: colors.textTertiary }]} numberOfLines={1}>
                  {t(item.kind === 'human' ? 'mobile_owner_only_short' : 'mobile_other_ai_add_unavailable_short')}
                </Text> : null}
              </View>
              <Ionicons name={selected.includes(item.id) ? 'checkmark-circle' : disabled ? 'lock-closed-outline' : 'ellipse-outline'}
                size={25} color={selected.includes(item.id) ? colors.brand : colors.textTertiary} />
            </Pressable>
          })}
        </View> : null,
      ) : <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('mobile_no_conversation_choices')}</Text>}
    </ScrollView>
    <Pressable onPress={() => void submit()} disabled={busy || !chosen.length}
      style={[styles.submit, { backgroundColor: colors.brand, opacity: chosen.length && !busy ? 1 : 0.45 }]}>
      <Text style={styles.submitText}>{t('mobile_add_members_selected', { count: chosen.length })}</Text>
    </Pressable>
    <BottomSheet isOpen={showSelected} onClose={() => setShowSelected(false)}
      title={t('mobile_selected_members_count', { count: chosen.length })}>
      {chosen.map((item) => <Pressable key={item.id} onPress={() => toggle(item)} accessibilityRole="button"
        accessibilityLabel={t('mobile_remove_selected_member', { name: item.displayName })}
        style={[styles.selectedRow, { borderBottomColor: colors.border }]}>
        <RoomIdentityAvatar name={item.displayName} avatar={item.avatar} agent={item.kind === 'agent'} size={42} />
        <Text style={[styles.rowName, styles.selectedName, { color: colors.text }]} numberOfLines={1}>{item.displayName}</Text>
        <Ionicons name="remove-circle-outline" size={24} color={colors.error} />
      </Pressable>)}
    </BottomSheet>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  search: { height: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginHorizontal: 16, marginTop: 8 },
  searchInput: { flex: 1, fontSize: 16 },
  selectedAvatar: { width: 30, height: 30 },
  overflow: { minWidth: 30, height: 30, borderRadius: 9, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2 },
  list: { flex: 1, marginTop: 8 }, listContent: { paddingBottom: 24 },
  section: { fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 7 },
  row: { minHeight: 60, marginHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectedRow: { minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600' },
  selectedName: { flex: 1 },
  rowHint: { marginTop: 2, fontSize: 12 },
  empty: { alignItems: 'center', textAlign: 'center', marginTop: 30, fontSize: 14, gap: 8 },
  submit: { marginHorizontal: 16, marginBottom: 18, minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
