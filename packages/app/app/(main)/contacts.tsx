import { useMobileModuleBack } from '../../src/components/useMobileModuleBack'
import { normalizeDisplayText } from '../../src/components/headEllipsis'
import { useCallback, useRef, useState } from 'react'
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../src/config/auth'
import { AppPageHeader, HeaderIconButton } from '../../src/components/ConnectedAppPageHeader'
import { RoomIdentityAvatar } from '../../src/features/rooms/components/RoomIdentityAvatar'
import { contactAccountClient, type SavedContact } from '../../src/features/contacts/contactAccountClient'
import { readSavedContactsCache, writeSavedContactsCache } from '../../src/features/contacts/savedContactsCache'
import { useAgentListModel } from '../../src/features/agents/useAgentListModel'
import { useTheme } from '../../src/hooks/useTheme'

/** In-memory only: lets repeat visits within the session render owned agents' plaza status
 * immediately, since the persisted cache below deliberately excludes owned contacts. */
const contactsSnapshots = new Map<string, SavedContact[]>()

export default function ContactsScreen() {
  const { t, i18n } = useTranslation()
  const moduleBack = useMobileModuleBack()
  const router = useRouter()
  const { colors } = useTheme()
  const user = useAuthStore((state) => state.user)
  const accountId = user?.id ?? ''
  const { agents } = useAgentListModel()
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<SavedContact[]>(() => contactsSnapshots.get(accountId) ?? [])
  const [loading, setLoading] = useState(!contactsSnapshots.has(accountId))
  const [failed, setFailed] = useState(false)
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestGeneration = useRef(0)
  const shownAccount = useRef(accountId)
  const hasSnapshot = useRef(contactsSnapshots.has(accountId))

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current
    if (shownAccount.current !== accountId) {
      shownAccount.current = accountId
      hasSnapshot.current = contactsSnapshots.has(accountId)
      setContacts(contactsSnapshots.get(accountId) ?? [])
    }
    const hadSnapshot = hasSnapshot.current
    if (!hadSnapshot) setLoading(true)
    setFailed(false)
    if (!accountId) {
      setLoading(false)
      return
    }
    // The persisted cache deliberately excludes owned contacts (see savedContactsCache).
    // Skip hydrating from it when we already have a full snapshot in memory, otherwise
    // it would briefly wipe owned agents (and their plaza badge) on every refocus.
    if (!hadSnapshot) {
      const cached = await readSavedContactsCache(accountId)
      if (generation !== requestGeneration.current) return
      if (cached !== null) {
        hasSnapshot.current = true
        setContacts(cached)
        setLoading(false)
      }
    }
    try {
      const response = await contactAccountClient.list()
      if (generation !== requestGeneration.current) return
      hasSnapshot.current = true
      contactsSnapshots.set(accountId, response.contacts)
      setContacts(response.contacts)
      setLoading(false)
      await writeSavedContactsCache(accountId, response.contacts).catch(() => {})
    } catch {
      if (generation === requestGeneration.current && !hasSnapshot.current) setFailed(true)
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [accountId])

  useFocusEffect(useCallback(() => {
    void load()
    return () => {
      requestGeneration.current += 1
      if (navigationTimer.current) clearTimeout(navigationTimer.current)
      navigationTimer.current = null
      setSelectedRow(null)
    }
  }, [load]))

  const selectAndNavigate = (row: string, navigate: () => void) => {
    if (navigationTimer.current) return
    setSelectedRow(row)
    navigationTimer.current = setTimeout(() => {
      navigationTimer.current = null
      navigate()
    }, 140)
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchesQuery = (item: SavedContact) => item.displayName.toLocaleLowerCase().includes(normalizedQuery)
  const owned = contacts.filter((item) => item.owned && matchesQuery(item))
  const saved = contacts.filter((item) => !item.owned && matchesQuery(item))
  const ownAgents = agents.filter((agent) => normalizeDisplayText(agent.displayName).toLocaleLowerCase().includes(normalizedQuery))
  const ownedFromContacts = owned.filter((item) =>
    !item.agentWorkspaceId || !agents.some((agent) => agent.id === item.agentWorkspaceId),
  )
  const listedAgentIds = new Set(owned.filter((item) => item.plazaListed)
    .map((item) => item.agentWorkspaceId))
  const publicBadge = i18n.language.startsWith('zh') ? '公开' : 'Public'
  const openContact = (item: SavedContact) => {
    if (item.owned && item.agentWorkspaceId) {
      router.navigate(`/(main)/agents/${item.agentWorkspaceId}`)
    } else if (item.owned) {
      router.navigate('/(main)/agents')
    } else if (item.kind === 'agent' && item.publicId) {
      router.navigate({ pathname: '/(main)/plaza/[publicId]', params: { publicId: item.publicId } })
    } else {
      router.navigate({ pathname: '/(main)/contacts/[contactId]', params: { contactId: item.id } })
    }
  }
  const openAddMenu = () => {
    const scan = () => router.navigate('/(main)/scan')
    const createAi = () => router.navigate('/(main)/agents/new')
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({
        options: [t('mobile_add_contact'), t('mobile_create_ai'), t('cancel')],
        cancelButtonIndex: 2,
      }, (index) => { if (index === 0) scan(); else if (index === 1) createAi() })
    } else {
      Alert.alert(t('mobile_contacts'), undefined, [
        { text: t('mobile_add_contact'), onPress: scan },
        { text: t('mobile_create_ai'), onPress: createAi },
        { text: t('cancel'), style: 'cancel' },
      ])
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader title={t('mobile_saved_contacts')} onBack={moduleBack} showsConnectivityStatus trailing={
        <HeaderIconButton icon="add" label={t('mobile_add_contact')} onPress={openAddMenu} />
      } />
      <ScrollView style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
          <Ionicons name="search-outline" size={22} color={colors.textSecondary} />
          <TextInput value={query} onChangeText={setQuery} placeholder={t('mobile_search_contacts')}
            placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]}
            clearButtonMode="while-editing" autoCorrect={false} />
        </View>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.entry, {
          borderBottomColor: colors.border,
          backgroundColor: pressed || selectedRow === 'plaza' ? colors.surfaceHover : 'transparent',
        }]} onPress={() => selectAndNavigate('plaza', () => router.navigate('/(main)/plaza'))}>
          <View style={[styles.plazaIcon, { backgroundColor: colors.brand }]}><Ionicons name="compass" size={21} color="#fff" /></View>
          <View style={styles.rowCopy}><Text style={[styles.name, { color: colors.text }]}>{t('mobile_plaza')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('mobile_plaza_hint')}</Text></View>
        </Pressable>
        <Text style={[styles.section, { color: colors.textSecondary }]}>{t('mobile_me')}</Text>
        <ContactRow name={user?.name || t('mobile_me')} subtitle={t('mobile_my_identity')} avatar={user?.avatar ?? null}
          colors={colors} selected={selectedRow === 'me'}
          onPress={() => selectAndNavigate('me', () => router.navigate('/(main)/personal-profile'))} />
        {(ownAgents.length > 0 || ownedFromContacts.length > 0) ? <>
          <Text style={[styles.section, { color: colors.textSecondary }]}>{t('mobile_my_ai')}</Text>
          {ownAgents.map((agent) => <ContactRow key={agent.id} name={normalizeDisplayText(agent.displayName)}
            avatar={agent.avatar} agent subtitle={listedAgentIds.has(agent.id) ? publicBadge : undefined}
            colors={colors} selected={selectedRow === `agent:${agent.id}`}
            onPress={() => selectAndNavigate(`agent:${agent.id}`, () => router.navigate(`/(main)/agents/${agent.id}`))} />)}
          {ownedFromContacts.map((item) => <ContactRow key={item.id} name={item.displayName}
            avatar={item.avatar} agent subtitle={item.plazaListed ? publicBadge : undefined}
            colors={colors} selected={selectedRow === `contact:${item.id}`}
            onPress={() => selectAndNavigate(`contact:${item.id}`, () => openContact(item))} />)}
        </> : null}
        <Text style={[styles.section, { color: colors.textSecondary }]}>{t('mobile_saved_contacts')}</Text>
        {loading ? <ActivityIndicator style={styles.state} color={colors.brand} /> : failed ? (
          <Pressable style={styles.state} onPress={() => void load()}>
            <Text style={{ color: colors.textSecondary }}>{t('mobile_contacts_load_failed')}</Text>
            <Text style={{ color: colors.brand }}>{t('retry')}</Text>
          </Pressable>
        ) : <>
          {saved.length ? saved.map((item) => <ContactRow key={item.id} name={item.displayName}
            badge={item.kind === 'agent' ? t('mobile_ai') : undefined} avatar={item.avatar}
            agent={item.kind === 'agent'} colors={colors} selected={selectedRow === `contact:${item.id}`}
            onPress={() => selectAndNavigate(`contact:${item.id}`, () => openContact(item))} />) :
            <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('mobile_contacts_empty')}</Text>}
        </>}
      </ScrollView>
    </SafeAreaView>
  )
}

function ContactRow({ name, subtitle, badge, avatar, agent = false, colors, selected, onPress }: {
  name: string; subtitle?: string; badge?: string; avatar: SavedContact['avatar']; agent?: boolean;
  colors: ReturnType<typeof useTheme>['colors']; selected: boolean; onPress: () => void
}) {
  return <Pressable style={({ pressed }) => [styles.entry, {
    borderBottomColor: colors.border,
    backgroundColor: pressed || selected ? colors.surfaceHover : 'transparent',
  }]} onPress={onPress} accessibilityRole="button">
    <RoomIdentityAvatar name={name} avatar={avatar} agent={agent} size={40} />
    <View style={styles.rowCopy}>
      <View style={styles.nameLine}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{name}</Text>
        {badge ? <View style={[styles.aiBadge, { backgroundColor: `${colors.navigationSelected}16` }]}>
          <Text style={[styles.aiBadgeText, { color: colors.navigationSelected }]}>{badge}</Text>
        </View> : null}
      </View>
      {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
    </View>
  </Pressable>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, body: { flex: 1 }, content: { paddingHorizontal: 16, paddingBottom: 24 },
  search: { height: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  entry: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowCopy: { flex: 1, gap: 3 }, name: { fontSize: 16, fontWeight: '600' }, subtitle: { fontSize: 13 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  aiBadge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  aiBadgeText: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  plazaIcon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 13, fontWeight: '600', marginTop: 10, marginBottom: 2 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  empty: { fontSize: 13, paddingVertical: 20 },
})
