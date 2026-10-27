// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts
// @test tests/e2e/web/scoped-room-dialogs.spec.ts

import { useState } from 'react'
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { ROOM_INVITE_INSTALL_URL, roomShareCopyValue } from '../roomShare'
import { getOfficialRoomLinkNavigationTarget } from '../roomNavigationTarget'

export function RoomShareLink({
  url,
  purpose,
  roomName = '',
}: {
  url: string
  purpose: 'invite' | 'open'
  roomName?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const invitationText = t(
    purpose === 'invite' ? 'spaces_invitation_text' : 'spaces_group_text',
    { name: roomName },
  )
  const instruction = t(
    purpose === 'invite' ? 'spaces_invite_ai_instruction' : 'spaces_group_ai_instruction',
  )
  const urlLabel = t(purpose === 'invite' ? 'spaces_invite_url_label' : 'spaces_group_url_label')
  const installLabel = t('spaces_install_url_label')
  const copyValue = roomShareCopyValue({
    title: invitationText,
    instruction,
    url,
    urlLabel,
    installLabel,
  })
  const copy = async () => {
    try {
      if (!await Clipboard.setStringAsync(copyValue)) throw new Error('Copy failed')
      setCopied(true)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  const share = async () => {
    try {
      await Share.share({ title: roomName, message: copyValue })
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  const openRoomLink = () => {
    if (Platform.OS !== 'web') {
      const target = getOfficialRoomLinkNavigationTarget({
        url,
        platform: Platform.OS,
        desktopControlSurface: false,
      })
      if (target) {
        router.navigate(target as never)
        return
      }
    }
    void Linking.openURL(url)
  }
  return (
    <View testID="room-share-link">
      <RoomLinkSectionHeader
        title={t(purpose === 'invite' ? 'spaces_invites_title' : 'spaces_group_link')}
        copied={copied}
        onCopy={() => void copy()}
        onShare={() => void share()}
        testID="room-copy-share-link"
        copyLabel={t('spaces_invite_copy')}
      />
      <Text selectable style={[styles.invitation, { color: colors.text }]}>
        {invitationText}{'\n'}{instruction}
      </Text>
      <Text selectable style={[styles.body, { color: colors.textSecondary }]}>
        {urlLabel}：
        <Text accessibilityRole="link" onPress={openRoomLink} style={{ color: colors.brand }}>
          {url}
        </Text>
      </Text>
      <Text selectable style={[styles.body, { color: colors.textSecondary }]}>
        {installLabel}：
        <Text
          accessibilityRole="link"
          onPress={() => void Linking.openURL(ROOM_INVITE_INSTALL_URL)}
          style={{ color: colors.brand }}
        >
          {ROOM_INVITE_INSTALL_URL}
        </Text>
      </Text>
      {failed ? (
        <Text accessibilityRole="alert" style={[styles.body, { color: colors.error }]}>
          {t('spaces_share_copy_failed')}
        </Text>
      ) : null}
    </View>
  )
}

export function RoomLinkSectionHeader({
  title,
  copied,
  onCopy,
  onShare,
  testID,
  copyLabel,
}: {
  title: string
  copied: boolean
  onCopy: () => void
  onShare: () => void
  testID?: string
  copyLabel?: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={styles.header}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('share')}
          onPress={onShare}
          hitSlop={4}
          style={({ pressed }) => [
            styles.copyButton,
            { backgroundColor: colors.brandLight },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="share-outline" size={18} color={colors.brand} />
        </Pressable>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={copied ? t('link_copied') : (copyLabel ?? t('copy_share_link'))}
          onPress={onCopy}
          hitSlop={4}
          style={({ pressed }) => [
            styles.copyButton,
            { backgroundColor: colors.brandLight },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.brand} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { minHeight: 36, flexDirection: 'row', alignItems: 'center' },
  headerActions: { flexDirection: 'row', gap: 8 },
  title: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  invitation: { marginTop: 8, fontSize: 13, lineHeight: 20 },
  body: { marginTop: 8, fontSize: 13, lineHeight: 20 },
  copyButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.55 },
})
