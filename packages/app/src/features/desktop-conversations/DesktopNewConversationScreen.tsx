// @arch docs/architecture/desktop/unified-desktop.md#7-信息架构

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { useDesktopAgentSidebarModel } from '../desktop-control/useDesktopAgentSidebarModel'
import { desktopAccountActions } from '../desktop-control/useDesktopAccountSync'
import { DesktopRoomEntryModal } from '../desktop-rooms/DesktopRoomEntryModal'
import { desktopSocialAccountPort, type SavedContact } from './desktopSocialAccountPort'

export default function DesktopNewConversationScreen() {
  const accountId = useAuthStore(state => state.user?.id ?? '')
  return accountId ? <AccountNewConversation key={accountId} accountId={accountId} /> : null
}

function AccountNewConversation({ accountId }: { accountId: string }) {
  const router = useRouter()
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const { colors } = useTheme()
  const ownAgents = useDesktopAgentSidebarModel().agents
  const [contacts, setContacts] = useState<SavedContact[]>([])
  const [contactState, setContactState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [legacyStage, setLegacyStage] = useState<'create' | 'join-link' | null>(null)
  const legacyActionRef = useRef<View>(null)
  const copy = zh ? {
    back: '返回', title: '创建对话', search: '搜索联系人', mine: '我的 AI', friends: '好友',
    myAi: '我的 AI', human: '真人', agent: 'AI', start: '开始对话', selected: '已选择', notSelected: '未选择', name: '对话名称',
    namePlaceholder: '为对话命名', failed: '暂时无法读取好友', retry: '重试',
    noFriends: '还没有好友', noResults: '没有匹配的联系人',
    aiUnavailable: '与 AI 的直接对话尚未开放；可打开其现有工作会话。',
    openWork: '打开 AI 工作会话', pending: '真人收到邀请并接受后才会加入对话。',
    createFailed: '暂时无法开始对话，请重试。', oldCreate: '创建空群聊', join: '输入群聊链接',
  } : {
    back: 'Back', title: 'New conversation', search: 'Search contacts', mine: 'My AI', friends: 'Friends',
    myAi: 'My AI', human: 'Person', agent: 'AI', start: 'Start conversation', selected: 'Selected', notSelected: 'Not selected', name: 'Conversation name',
    namePlaceholder: 'Name this conversation', failed: 'Could not load friends', retry: 'Retry',
    noFriends: 'No friends yet', noResults: 'No matching contacts',
    aiUnavailable: 'Direct AI conversations are not available yet. You can open an existing work conversation.',
    openWork: 'Open AI work conversation', pending: 'People join only after accepting your invitation.',
    createFailed: 'Could not start the conversation. Try again.', oldCreate: 'Create empty group', join: 'Enter group link',
  }

  useEffect(() => {
    let active = true
    setContactState('loading')
    void desktopSocialAccountPort.contacts().then(result => {
      if (!active || useAuthStore.getState().user?.id !== accountId) return
      setContacts(result.contacts.filter(contact => !contact.owned))
      setContactState('ready')
    }).catch(() => { if (active) setContactState('failed') })
    return () => { active = false }
  }, [accountId, revision])

  const friends = contacts.filter(contact => contact.kind === 'human' && !!contact.userId)
  const savedAgents = contacts.filter(contact => contact.kind === 'agent')
  const visibleFriends = contacts.filter(contact => contact.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const visibleAgents = ownAgents.filter(agent => agent.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selectedAgents = useMemo(() => ownAgents.filter(agent => selected.includes(`agent:${agent.id}`)), [ownAgents, selected])
  const selectedSavedAgents = useMemo(() => savedAgents.filter(contact => selected.includes(`saved-agent:${contact.id}`)), [savedAgents, selected])
  const selectedFriends = useMemo(() => friends.filter(contact => selected.includes(`human:${contact.id}`)), [friends, selected])
  const canStart = contactState === 'ready' && selectedFriends.length > 0 && selectedAgents.length === 0 && selectedSavedAgents.length === 0
    && selectedFriends.length === selected.length && !!name.trim() && !busy

  const toggle = (key: string) => {
    const next = selected.includes(key) ? selected.filter(value => value !== key) : [...selected, key]
    setSelected(next)
    setName(friends.filter(contact => next.includes(`human:${contact.id}`)).map(contact => contact.displayName).join('、').slice(0, 80))
    setError(false)
  }
  const create = async () => {
    if (!canStart || useAuthStore.getState().user?.id !== accountId) return
    setBusy(true)
    setError(false)
    try {
      const targetUserIds = selectedFriends.map(contact => contact.userId!).sort()
      const key = `desktop-room-invite:${accountId}:${JSON.stringify([targetUserIds, name.trim()])}`
      let operationId = globalThis.localStorage.getItem(key)
      if (!operationId) {
        operationId = globalThis.crypto.randomUUID()
        globalThis.localStorage.setItem(key, operationId)
      }
      const result = await desktopSocialAccountPort.inviteHumans(targetUserIds, name.trim(), operationId)
      if (useAuthStore.getState().user?.id !== accountId) return
      globalThis.localStorage.removeItem(key)
      void desktopAccountActions.reconcile()
      router.replace({ pathname: '/(main)/room-workspace', params: { roomId: result.roomId } } as never)
    } catch { if (useAuthStore.getState().user?.id === accountId) setError(true) }
    finally { if (useAuthStore.getState().user?.id === accountId) setBusy(false) }
  }
  const row = (key: string, displayName: string, avatar: SavedContact['avatar'], kind: 'mine' | 'agent' | 'human') => {
    const checked = selected.includes(key)
    return <Pressable key={key} testID={`desktop-new-conversation-${key}`} accessibilityRole="checkbox"
      accessibilityState={{ checked }} accessibilityLabel={`${displayName}, ${kind === 'mine' ? copy.myAi : kind === 'agent' ? copy.agent : copy.human}, ${checked ? copy.selected : copy.notSelected}`}
      onPress={() => toggle(key)} style={[styles.row, { borderBottomColor: colors.border }]}>
      <RoomIdentityAvatar name={displayName} avatar={avatar} agent={kind !== 'human'} size={42} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowName, { color: colors.text }]}>{displayName}</Text>
        <Text style={{ color: colors.textSecondary }}>{kind === 'mine' ? copy.myAi : kind === 'agent' ? copy.agent : copy.human}</Text>
      </View>
      <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={23}
        color={checked ? colors.brand : colors.textTertiary} />
    </Pressable>
  }

  return <View testID="desktop-new-conversation" style={[styles.root, { backgroundColor: colors.bg }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary }}>{copy.back}</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[desktopTypography.windowTitle, { color: colors.text }]}>{copy.title}</Text>
      <Pressable testID="desktop-new-conversation-start" accessibilityRole="button" disabled={!canStart}
        accessibilityState={{ disabled: !canStart }} onPress={() => void create()}
        style={[styles.start, { backgroundColor: colors.brand, opacity: canStart ? 1 : 0.45 }]}>
        <Text style={styles.startText}>{busy ? '…' : copy.start}</Text>
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
        <Ionicons name="search-outline" size={19} color={colors.textSecondary} />
        <TextInput value={query} onChangeText={setQuery} placeholder={copy.search}
          placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]} />
      </View>
      {selected.length ? <View style={styles.chips}>
        <Text style={{ color: colors.textSecondary }}>{copy.selected}</Text>
        {selectedAgents.map(agent => <Pressable key={agent.id} accessibilityRole="button" onPress={() => toggle(`agent:${agent.id}`)}
          style={[styles.chip, { backgroundColor: colors.surfaceHover }]}><Text style={{ color: colors.text }}>{agent.displayName} ×</Text></Pressable>)}
        {selectedSavedAgents.map(contact => <Pressable key={contact.id} accessibilityRole="button" onPress={() => toggle(`saved-agent:${contact.id}`)}
          style={[styles.chip, { backgroundColor: colors.surfaceHover }]}><Text style={{ color: colors.text }}>{contact.displayName} ×</Text></Pressable>)}
        {selectedFriends.map(contact => <Pressable key={contact.id} accessibilityRole="button" onPress={() => toggle(`human:${contact.id}`)}
          style={[styles.chip, { backgroundColor: colors.surfaceHover }]}><Text style={{ color: colors.text }}>{contact.displayName} ×</Text></Pressable>)}
      </View> : null}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{copy.mine}</Text>
        {visibleAgents.map(agent => row(`agent:${agent.id}`, agent.displayName, agent.avatar ?? null, 'mine'))}
      </View>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{copy.friends}</Text>
        {contactState === 'loading' ? <ActivityIndicator color={colors.brand} /> :
          contactState === 'failed' ? <Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)}
            style={styles.friendStatus}><Text style={{ color: colors.textSecondary }}>{copy.failed}</Text>
            <Text style={{ color: colors.brand }}>{copy.retry}</Text></Pressable> :
            visibleFriends.length ? visibleFriends.map(contact => row(contact.kind === 'human' ? `human:${contact.id}` : `saved-agent:${contact.id}`,
              contact.displayName, contact.avatar, contact.kind)) :
              <Text style={{ color: colors.textSecondary }}>{query.trim() ? copy.noResults : copy.noFriends}</Text>}
      </View>
      {selectedFriends.length ? <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{copy.name}</Text>
        <TextInput value={name} onChangeText={setName}
          maxLength={80} placeholder={copy.namePlaceholder} placeholderTextColor={colors.textTertiary}
          style={[styles.nameInput, { color: colors.text, borderColor: colors.border }]} />
        <Text style={{ color: colors.textSecondary }}>{copy.pending}</Text>
      </View> : null}
      {selectedAgents.length || selectedSavedAgents.length ? <View style={styles.section}>
        <Text style={{ color: colors.textSecondary }}>{copy.aiUnavailable}</Text>
        {selectedAgents.length === 1 ? <Pressable accessibilityRole="button" onPress={() => router.navigate(`/(main)/agents/${selectedAgents[0].id}` as never)}>
          <Text style={{ color: colors.brand }}>{copy.openWork}</Text>
        </Pressable> : null}
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{copy.createFailed}</Text> : null}
      <View style={[styles.legacy, { borderTopColor: colors.border }]}>
        <Pressable ref={legacyActionRef} accessibilityRole="button" onPress={() => setLegacyStage('create')}>
          <Text style={{ color: colors.brand }}>{copy.oldCreate}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setLegacyStage('join-link')}>
          <Text style={{ color: colors.brand }}>{copy.join}</Text>
        </Pressable>
      </View>
    </ScrollView>
    {legacyStage ? <DesktopRoomEntryModal visible initialStage={legacyStage} returnFocusRef={legacyActionRef}
      onClose={() => setLegacyStage(null)} onRefresh={() => void desktopAccountActions.reconcile()}
      onOpenRoom={roomId => router.replace({ pathname: '/(main)/room-workspace', params: { roomId } } as never)} /> : null}
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 },
  header: { minHeight: 76, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 28 },
  back: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4 },
  start: { marginLeft: 'auto', minHeight: 38, borderRadius: 8, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  startText: { color: '#fff', fontWeight: '600' },
  content: { width: '100%', maxWidth: 850, alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 24, gap: 24 },
  search: { height: 42, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14 },
  chips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 30, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' },
  section: { gap: 10 }, sectionTitle: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  row: { minHeight: 62, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 }, rowName: { fontSize: 15, fontWeight: '600' },
  friendStatus: { minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 8 },
  nameInput: { minHeight: 42, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 },
  legacy: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18, flexDirection: 'row', gap: 22 },
})
