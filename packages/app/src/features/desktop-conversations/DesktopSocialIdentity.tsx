// @arch docs/architecture/desktop/unified-desktop.md#7-信息架构
// Public identity view only. Membership and opening a Room remain domain operations.

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import type { SocialAvatar } from './desktopSocialAccountPort'

export type DesktopSocialIdentityView = {
  id: string
  displayName: string
  description: string
  kind: 'human' | 'agent'
  ownerName?: string
  availability?: 'available' | 'offline' | 'paused'
  canOpenConversation: boolean
  avatar?: SocialAvatar
}

export function DesktopSocialIdentity({ identity, saved = false, saving = false, invitationStatus, onBack, onOpenConversation, onSaveContact, onInvite }: {
  identity: DesktopSocialIdentityView
  saved?: boolean
  saving?: boolean
  invitationStatus?: 'pending' | 'accepted' | 'declined' | 'expired' | 'unavailable' | null
  onBack(): void
  onOpenConversation?: (id: string) => void
  onSaveContact?: () => void
  onInvite?: () => void
}) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const copy = zh ? { back: '联系人', agent: 'AI 身份', human: '真人', owner: '创建者',
    open: '打开对话', unavailable: '暂时无法开始对话', save: '添加到联系人', saved: '已添加', available: '可用', offline: '离线', paused: '已暂停',
    disclosure: '与此 AI 的对话可能由创建者查看。开始前请阅读完整隐私说明。',
    invite: '邀请开始对话', pending: '等待对方接受', accepted: '对方已接受', declined: '对方已拒绝', expired: '邀请已过期',
    unavailableInvitation: '暂时无法检查邀请状态' }
    : { back: 'Contacts', agent: 'AI identity', human: 'Person', owner: 'Created by',
      open: 'Open conversation', unavailable: 'Conversation unavailable', save: 'Add to contacts', saved: 'Added', available: 'Available', offline: 'Offline', paused: 'Paused',
      disclosure: 'The creator may view this AI conversation. Read the full privacy notice before starting.',
      invite: 'Invite to conversation', pending: 'Waiting for acceptance', accepted: 'Accepted', declined: 'Declined', expired: 'Invitation expired',
      unavailableInvitation: 'Could not check invitation status' }
  const { colors } = useTheme()
  const agent = identity.kind === 'agent'
  return <View testID="desktop-social-identity" style={[styles.root, { backgroundColor: colors.bg }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.back} onPress={onBack} style={styles.back}>
        <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary }}>{copy.back}</Text>
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <RoomIdentityAvatar name={identity.displayName} avatar={identity.avatar} agent={agent} size={72} />
        <View style={styles.nameBlock}>
          <Text accessibilityRole="header" style={[styles.name, { color: colors.text }]}>{identity.displayName}</Text>
          <Text style={[styles.kind, { color: colors.textSecondary }]}>{agent ? copy.agent : copy.human}</Text>
        </View>
        {agent && identity.availability ? <View style={[styles.status, { backgroundColor: colors.surfaceHover }]}>
          <View style={[styles.dot, { backgroundColor: identity.availability === 'available' ? colors.success : colors.textTertiary }]} />
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{copy[identity.availability]}</Text>
        </View> : null}
      </View>
      {identity.description ? <Text selectable style={[styles.description, { color: colors.text }]}>{identity.description}</Text> : null}
      {agent && identity.ownerName ? <View style={styles.fact}>
        <Text style={[styles.factLabel, { color: colors.textSecondary }]}>{copy.owner}</Text>
        <Text style={[styles.factValue, { color: colors.text }]}>{identity.ownerName}</Text>
      </View> : null}
      {agent ? <View style={[styles.disclosure, { backgroundColor: colors.surfaceHover }]}>
        <Ionicons name="information-circle-outline" size={19} color={colors.textSecondary} />
        <Text style={[styles.disclosureText, { color: colors.textSecondary }]}>{copy.disclosure}</Text>
      </View> : null}
      <View style={styles.actions}>
        {invitationStatus ? <Text style={{ color: colors.textSecondary, alignSelf: 'center' }}>
          {invitationStatus === 'unavailable' ? copy.unavailableInvitation : copy[invitationStatus]}
        </Text> : null}
        {onInvite && invitationStatus !== 'pending' && invitationStatus !== 'accepted'
          ? <Pressable accessibilityRole="button" disabled={saving} onPress={onInvite}
            style={[styles.secondaryAction, { borderColor: colors.brand, opacity: saving ? 0.55 : 1 }]}>
            <Text style={[styles.secondaryActionText, { color: colors.brand }]}>{copy.invite}</Text>
          </Pressable> : null}
        {onSaveContact ? <Pressable accessibilityRole="button" accessibilityLabel={saved ? copy.saved : copy.save}
          disabled={saved || saving} onPress={onSaveContact}
          style={[styles.secondaryAction, { borderColor: colors.brand, opacity: saved || saving ? 0.55 : 1 }]}>
          <Text style={[styles.secondaryActionText, { color: colors.brand }]}>{saved ? copy.saved : copy.save}</Text>
        </Pressable> : null}
        {onOpenConversation ? <Pressable accessibilityRole="button" accessibilityLabel={identity.canOpenConversation ? copy.open : copy.unavailable}
          disabled={!identity.canOpenConversation} onPress={() => onOpenConversation(identity.id)}
          style={[styles.action, { backgroundColor: colors.brand, opacity: identity.canOpenConversation ? 1 : 0.5 }]}>
          <Text style={styles.actionText}>{identity.canOpenConversation ? copy.open : copy.unavailable}</Text>
        </Pressable> : null}
      </View>
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 }, header: { minHeight: 76, borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center', paddingHorizontal: 26 },
  back: { minHeight: 40, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 30, paddingVertical: 32, gap: 22 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 24, flexDirection: 'row', alignItems: 'center', gap: 18 },
  avatar: { width: 72, height: 72, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  nameBlock: { flex: 1, minWidth: 0, gap: 4 }, name: desktopTypography.windowTitle,
  kind: { fontSize: 13, lineHeight: 18 }, status: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 }, description: { fontSize: 15, lineHeight: 24 },
  fact: { flexDirection: 'row', gap: 20 }, factLabel: { width: 70, fontSize: 13 }, factValue: { flex: 1, fontSize: 13 },
  disclosure: { borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  disclosureText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  action: { minHeight: 42, borderRadius: 10, paddingHorizontal: 20, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  secondaryAction: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { fontSize: 14, fontWeight: '600' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
})
