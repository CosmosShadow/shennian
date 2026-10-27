import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Crypto from 'expo-crypto'
import { AppPageHeader } from '../../../src/components/AppPageHeader'
import BottomSheet from '../../../src/components/BottomSheet'
import { contactAccountClient, type SavedContact } from '../../../src/features/contacts/contactAccountClient'
import { readSavedContactsCache, writeSavedContactsCache } from '../../../src/features/contacts/savedContactsCache'
import { useAuthStore } from '../../../src/config/auth'
import { roomContactInvitationClient } from '../../../src/features/contacts/roomContactInvitationClient'
import { RoomIdentityAvatar } from '../../../src/features/rooms/components/RoomIdentityAvatar'
import { publishRoomSyncRequest } from '../../../src/features/rooms/roomEvents'
import { useTheme } from '../../../src/hooks/useTheme'

export default function NewConversationScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const [contacts, setContacts] = useState<SavedContact[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [showSelected, setShowSelected] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(false)
  const [creating, setCreating] = useState(false)
  const [failure, setFailure] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const operationId = useRef(Crypto.randomUUID())

  useFocusEffect(useCallback(() => {
    let active = true
    void (async () => {
      const cached = await readSavedContactsCache(accountId)
      if (!active) return
      if (cached !== null) {
        setContacts(cached)
        setLoading(false)
      }
      try {
        const result = await contactAccountClient.list()
        if (!active) return
        await writeSavedContactsCache(accountId, result.contacts).catch(() => {})
        if (!active) return
        setLoadFailed(false)
        setContacts(result.contacts)
        setAvailable(true)
      } catch {
        if (active && cached === null) setLoadFailed(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [accountId, reloadKey]))

  const toggle = (contact: SavedContact) => {
    const next = selected.includes(contact.id)
      ? selected.filter((id) => id !== contact.id)
      : selected.length < 20 ? [...selected, contact.id] : selected
    setSelected(next)
    operationId.current = Crypto.randomUUID()
    setFailure(false)
  }

  const chosen = selected.flatMap((id) => {
    const item = contacts.find((contact) => contact.id === id)
    return item ? [item] : []
  })
  const people = chosen.filter((item) => item.kind === 'human' && !item.owned && item.userId)
  const ownAgents = chosen.filter((item) => item.kind === 'agent' && item.owned && item.agentWorkspaceId)
  const otherAgents = chosen.filter((item) => item.kind === 'agent' && !item.owned)

  const create = async () => {
    if (creating || !chosen.length) return
    if (otherAgents.length) {
      if (chosen.length === 1 && otherAgents[0].publicId) {
        router.navigate({ pathname: '/(main)/published-conversations/new',
          params: { publicId: otherAgents[0].publicId } })
      } else {
        Alert.alert(t('mobile_new_conversation'), t('mobile_other_ai_mix_unavailable'))
      }
      return
    }
    if (people.length && !available) {
      Alert.alert(t('mobile_new_conversation'), t('mobile_invitation_unavailable'))
      return
    }
    setCreating(true)
    setFailure(false)
    try {
      const name = chosen.map((item) => item.displayName).join('、').slice(0, 80)
      let roomId: string
      if (people.length) {
        const result = await roomContactInvitationClient.create(name,
          people.map((item) => item.userId!), operationId.current)
        if (result.invitations.length !== people.length) throw new Error('invitations_missing')
        roomId = result.room.id
      } else {
        roomId = (await roomContactInvitationClient.createWithoutHumanInvite(name)).room.id
      }
      publishRoomSyncRequest('tab-focused')
      if (ownAgents.length) {
        router.replace({ pathname: '/(main)/spaces/agent-add', params: { roomId,
          selectedAgentIds: ownAgents.map((item) => item.agentWorkspaceId).join(',') } })
      } else {
        router.replace({ pathname: '/(main)/room-workspace', params: { roomId } })
      }
    } catch {
      setFailure(true)
    } finally {
      setCreating(false)
    }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleContacts = contacts.filter((item) => item.displayName.toLocaleLowerCase().includes(normalizedQuery))
  const sections = [
    { key: 'mine', title: t('mobile_my_ai'), items: visibleContacts.filter((item) => item.kind === 'agent' && item.owned) },
    { key: 'people', title: t('mobile_other_people'), items: visibleContacts.filter((item) => item.kind === 'human' && !item.owned && item.userId) },
    { key: 'agents', title: t('mobile_other_ai'), items: visibleContacts.filter((item) => item.kind === 'agent' && !item.owned) },
  ]
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    <AppPageHeader title={t('mobile_new_conversation')} onBack={() => router.back()} />
    <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
      {chosen.length ? <>
        {chosen.slice(0, 2).map((item) => <Pressable key={item.id} onPress={() => setShowSelected(true)}
          accessibilityRole="button" accessibilityLabel={t('mobile_selected_members_count', { count: chosen.length })}
          hitSlop={4} style={styles.selectedAvatar}>
          <RoomIdentityAvatar name={item.displayName} avatar={item.avatar} agent={item.kind === 'agent'} size={30} />
        </Pressable>)}
        {chosen.length > 2 ? <Pressable onPress={() => setShowSelected(true)} accessibilityRole="button"
          accessibilityLabel={t('mobile_selected_members_count', { count: chosen.length })}
          style={[styles.selectedOverflow, { backgroundColor: colors.bg }]}>
          <Text style={[styles.selectedOverflowText, { color: colors.brand }]}>+{chosen.length - 2}</Text>
        </Pressable> : null}
        <View style={[styles.searchDivider, { backgroundColor: colors.border }]} />
      </> : null}
      <Ionicons name="search-outline" size={21} color={colors.textSecondary} />
      <TextInput value={query} onChangeText={setQuery} placeholder={t('mobile_search_people_ai')}
        placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]} />
    </View>
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color={colors.brand} /> : loadFailed ? <Pressable onPress={() => setReloadKey((current) => current + 1)} style={styles.empty}>
        <Text style={{ color: colors.textSecondary }}>{t('mobile_contacts_load_failed')}</Text>
        <Text style={{ color: colors.brand }}>{t('retry')}</Text>
      </Pressable> : sections.some((section) => section.items.length) ? sections.map((section) =>
        section.items.length ? <View key={section.key}>
          <Text style={[styles.section, { color: colors.textSecondary, backgroundColor: colors.surfaceHover }]}>{section.title}</Text>
          {section.items.map((item) => <Pressable key={item.id} onPress={() => toggle(item)} accessibilityRole="checkbox"
            accessibilityState={{ checked: selected.includes(item.id) }}
            style={[styles.row, { borderBottomColor: colors.border }]}>
            <RoomIdentityAvatar name={item.displayName} avatar={item.avatar} agent={item.kind === 'agent'} size={42} />
            <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{item.displayName}</Text>
            <Ionicons name={selected.includes(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
              size={25} color={selected.includes(item.id) ? colors.brand : colors.textTertiary} />
          </Pressable>)}
        </View> : null,
      ) : <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('mobile_no_conversation_choices')}</Text>}
    </ScrollView>
    {otherAgents.length && chosen.length > 1 ? <Text style={[styles.error, { color: colors.textSecondary }]}>
      {t('mobile_other_ai_mix_unavailable')}
    </Text> : null}
    {failure ? <Text style={[styles.error, { color: colors.error }]}>{t('mobile_conversation_create_failed')}</Text> : null}
    <Pressable onPress={() => void create()} disabled={creating || !chosen.length}
      style={[styles.submit, { backgroundColor: colors.brand, opacity: chosen.length && !creating ? 1 : 0.45 }]}>
      <Text style={styles.submitText}>{t('mobile_start_conversation_selected', { count: chosen.length })}</Text>
    </Pressable>
    <BottomSheet isOpen={showSelected} onClose={() => setShowSelected(false)}
      title={t('mobile_selected_members_count', { count: chosen.length })}>
      {chosen.map((item) => <Pressable key={item.id} onPress={() => toggle(item)} accessibilityRole="button"
        accessibilityLabel={t('mobile_remove_selected_member', { name: item.displayName })}
        style={[styles.selectedRow, { borderBottomColor: colors.border }]}>
        <RoomIdentityAvatar name={item.displayName} avatar={item.avatar} agent={item.kind === 'agent'} size={42} />
        <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{item.displayName}</Text>
        <Ionicons name="remove-circle-outline" size={24} color={colors.error} />
      </Pressable>)}
    </BottomSheet>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, search: { height: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginHorizontal: 16, marginTop: 8 },
  searchInput: { flex: 1, fontSize: 16 },
  selectedAvatar: { width: 30, height: 30 },
  selectedOverflow: { minWidth: 30, height: 30, borderRadius: 9, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  selectedOverflowText: { fontSize: 13, fontWeight: '600' },
  searchDivider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2 },
  selectedRow: { minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  list: { flex: 1, marginTop: 8 }, listContent: { paddingBottom: 24 },
  section: { fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 7 },
  row: { minHeight: 60, marginHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowName: { flex: 1, fontSize: 16, fontWeight: '600' },
  empty: { alignItems: 'center', textAlign: 'center', marginTop: 30, fontSize: 14, gap: 8 },
  error: { textAlign: 'center', marginHorizontal: 16, marginBottom: 8, fontSize: 13 },
  submit: { marginHorizontal: 16, marginBottom: 18, minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
