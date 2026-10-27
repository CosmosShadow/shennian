// @arch docs/architecture/desktop/unified-desktop.md#7-信息架构
// The caller maps canonical Room memberships and AI identities into this view.

import { useMemo } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import type { SocialAvatar } from './desktopSocialAccountPort'
import type { RoomInvitation } from './desktopSocialAccountPort'

export type DesktopContactView = {
  id: string
  displayName: string
  description?: string
  kind: 'human' | 'agent'
  group: 'mine' | 'friends'
  avatar?: SocialAvatar
  agentWorkspaceId?: string
}

export function DesktopContactDirectory({ contacts, invitations = [], invitationBusy = null, query, state, onQueryChange, onRetry, onOpen, onOpenPlaza, onCreateAi, onOpenAiWorkbench, onRespondInvitation }: {
  contacts: DesktopContactView[]
  invitations?: RoomInvitation[]
  invitationBusy?: string | null
  query: string
  state: 'loading' | 'ready' | 'failed'
  onQueryChange(value: string): void
  onRetry(): void
  onOpen(contact: DesktopContactView): void
  onOpenPlaza(): void
  onCreateAi(): void
  onOpenAiWorkbench(): void
  onRespondInvitation?(invitationId: string, decision: 'accept' | 'decline'): void
}) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const copy = zh ? { title: '联系人', search: '搜索联系人', mine: '我', myAi: '我的 AI', friends: '好友',
    human: '真人', agent: 'AI', myIdentity: '我的身份', myAgent: '我的 AI', createAi: '创建 AI', manageAi: '管理',
    noResults: '没有找到联系人', noFriends: '还没有好友', failed: '暂时无法读取联系人', retry: '重试', invitations: '待处理邀请',
    from: '来自', accept: '接受', decline: '拒绝' }
    : { title: 'Contacts', search: 'Search contacts', mine: 'Me', myAi: 'My AI', friends: 'Friends',
      human: 'Person', agent: 'AI', myIdentity: 'My identity', myAgent: 'My AI', createAi: 'Create AI', manageAi: 'Manage',
      noResults: 'No matching contacts', noFriends: 'No friends yet', failed: 'Could not load contacts', retry: 'Retry', invitations: 'Invitations',
      from: 'From', accept: 'Accept', decline: 'Decline' }
  const { colors } = useTheme()
  const wide = useWindowDimensions().width >= 1100
  const groups = useMemo(() => {
    const matches = contacts.filter(contact => contact.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    return {
      mine: matches.filter(contact => contact.group === 'mine' && contact.kind === 'human'),
      myAi: matches.filter(contact => contact.group === 'mine' && contact.kind === 'agent'),
      friends: matches.filter(contact => contact.group === 'friends'),
    }
  }, [contacts, query])
  const cards = (rows: DesktopContactView[]) => <View style={styles.cards}>{rows.map(contact => <Pressable key={contact.id}
    testID={`desktop-contact-${contact.id}`} accessibilityRole="button"
    accessibilityLabel={`${contact.displayName}, ${contact.kind === 'agent' ? copy.agent : copy.human}`}
    onPress={() => onOpen(contact)} style={({ pressed }) => [styles.card, wide && styles.wideCard,
      { backgroundColor: pressed ? colors.surfaceHover : colors.surface, borderColor: colors.border }]}>
    <RoomIdentityAvatar name={contact.displayName} avatar={contact.avatar} agent={contact.kind === 'agent'} size={44} />
    <View style={styles.cardCopy}>
      <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{contact.displayName}</Text>
      <Text numberOfLines={1} style={[styles.description, { color: colors.textSecondary }]}>
        {contact.description || (contact.group === 'mine'
          ? contact.kind === 'agent' ? copy.myAgent : copy.myIdentity
          : contact.kind === 'agent' ? copy.agent : copy.human)}
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
  </Pressable>)}</View>
  return <View testID="desktop-contact-directory" style={[styles.root, { backgroundColor: colors.bg }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{copy.title}</Text>
      <Pressable testID="desktop-contacts-create-ai" accessibilityRole="button" onPress={onCreateAi} style={styles.headerAction}>
        <Ionicons name="add" size={20} color={colors.brand} />
        <Text style={{ color: colors.brand, fontWeight: '600' }}>{copy.createAi}</Text>
      </Pressable>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
        <Ionicons name="search-outline" size={19} color={colors.textSecondary} />
        <TextInput value={query} onChangeText={onQueryChange} placeholder={copy.search}
          placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]} />
      </View>
      <Pressable testID="desktop-contacts-open-plaza" accessibilityRole="button" onPress={onOpenPlaza}
        style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surfaceHover : colors.surface, borderColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.brandLight }]}><Ionicons name="compass-outline" size={23} color={colors.brand} /></View>
        <View style={styles.cardCopy}>
          <Text style={[styles.name, { color: colors.text }]}>{i18n.language.startsWith('zh') ? '广场' : 'Discover'}</Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>{i18n.language.startsWith('zh') ? '发现公开的 AI' : 'Explore public AI'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
      </Pressable>
      {invitations.length ? <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{copy.invitations}</Text>
        {invitations.map(invitation => <View key={invitation.invitationId} style={[styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardCopy}>
            <Text style={[styles.name, { color: colors.text }]}>{invitation.roomName}</Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>{copy.from} {invitation.inviterName}</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={invitationBusy === invitation.invitationId}
            onPress={() => onRespondInvitation?.(invitation.invitationId, 'decline')}>
            <Text style={{ color: colors.textSecondary }}>{copy.decline}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={invitationBusy === invitation.invitationId}
            onPress={() => onRespondInvitation?.(invitation.invitationId, 'accept')}>
            <Text style={{ color: colors.brand, fontWeight: '600' }}>{copy.accept}</Text>
          </Pressable>
        </View>)}
      </View> : null}
      {groups.mine.length ? <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{copy.mine}</Text>{cards(groups.mine)}
      </View> : null}
      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{copy.myAi}</Text>
          <Pressable testID="desktop-contacts-manage-ai" accessibilityRole="button" onPress={onOpenAiWorkbench}>
            <Text style={{ color: colors.brand }}>{copy.manageAi}</Text>
          </Pressable>
        </View>
        {groups.myAi.length ? cards(groups.myAi) : null}
      </View>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{copy.friends}</Text>
        {groups.friends.length ? cards(groups.friends) : null}
        {state === 'loading' ? <View style={styles.status}><ActivityIndicator color={colors.brand} /></View>
          : state === 'failed' ? <View style={styles.status} accessibilityRole="alert">
            <Text style={{ color: colors.textSecondary }}>{copy.failed}</Text>
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={{ color: colors.brand }}>{copy.retry}</Text></Pressable>
          </View> : !groups.friends.length && (!query.trim() || !groups.mine.length && !groups.myAi.length) ? <Text style={{ color: colors.textSecondary }}>
            {query.trim() ? copy.noResults : copy.noFriends}
          </Text> : null}
      </View>
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 }, header: { minHeight: 76, justifyContent: 'space-between', flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 28 },
  headerAction: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: desktopTypography.windowTitle, scroll: { flex: 1 }, content: { width: '100%', maxWidth: 1050, alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 24, gap: 24 },
  search: { height: 42, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14 }, section: { gap: 10 }, sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, card: { width: '100%', minHeight: 74, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
  wideCard: { width: '49%' }, avatar: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, minWidth: 0, gap: 3 }, name: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  description: { fontSize: 12, lineHeight: 17 }, status: { minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 10 },
  retry: { minHeight: 36, minWidth: 54, alignItems: 'center', justifyContent: 'center' },
})
