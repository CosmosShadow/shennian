// @arch docs/features/network-rooms/ui.md#六移动端
// @test src/__tests__/room-management-panel.test.ts

import { useEffect, useRef } from 'react'
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useTheme } from '../../../hooks/useTheme'
import type { RoomMemberView } from '../types'

export function RoomMemberRemovalConfirmModal({
  member,
  visible,
  removing,
  failed,
  onClose,
  onConfirm,
}: {
  member: RoomMemberView | null
  visible: boolean
  removing: boolean
  failed: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const nativePresentedMemberId = useRef<string | null>(null)
  const nativeFailureMemberId = useRef<string | null>(null)
  const isAgent = member?.principalType === 'agent'
  const title = isAgent
    ? t('spaces_agent_remove_confirm_title', { name: member?.displayAlias ?? '' })
    : t('spaces_member_remove_confirm')
  const message = isAgent
    ? undefined
    : t('spaces_member_remove_confirm_body', { name: member?.displayAlias ?? '' })
  useEscapeKey(Platform.OS === 'web' && visible && !removing, onClose)

  useEffect(() => {
    if (Platform.OS === 'web') return
    if (!visible || !member) {
      nativePresentedMemberId.current = null
      nativeFailureMemberId.current = null
      return
    }
    if (nativePresentedMemberId.current === member.id) return
    nativePresentedMemberId.current = member.id
    Alert.alert(
      title,
      message,
      [
        { text: t('cancel'), style: 'cancel', onPress: onClose },
        { text: t('spaces_member_remove_action'), style: 'destructive', onPress: onConfirm },
      ],
      { cancelable: true, onDismiss: onClose },
    )
  }, [member, message, onClose, onConfirm, t, title, visible])

  useEffect(() => {
    if (Platform.OS === 'web' || !visible || !member || !failed) return
    if (nativeFailureMemberId.current === member.id) return
    nativeFailureMemberId.current = member.id
    Alert.alert(t('error'), t('spaces_manage_action_failed'), [
      { text: t('ok'), onPress: onClose },
    ])
  }, [failed, member, onClose, t, visible])

  if (Platform.OS !== 'web') return null

  return (
    <Modal
      visible={visible && Boolean(member)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable disabled={removing} style={styles.overlay} onPress={onClose}>
        <Pressable
          accessibilityRole="none"
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          {message ? (
            <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
          ) : null}
          {failed ? (
            <Text style={[styles.error, { color: colors.error }]}>
              {t('spaces_manage_action_failed')}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={removing}
              style={[styles.button, { backgroundColor: colors.surfaceHover }]}
              onPress={onClose}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>{t('cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={removing}
              style={[styles.button, { backgroundColor: colors.error }]}
              onPress={onConfirm}
            >
              {removing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.buttonText, { color: '#fff' }]}>
                  {t('spaces_member_remove_action')}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    width: 340,
    maxWidth: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 20,
    gap: 10,
  },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  button: {
    minWidth: 72,
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
})
