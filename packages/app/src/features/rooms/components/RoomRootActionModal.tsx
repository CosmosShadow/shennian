import { getServerUrl } from '../../../config/server'
import { ActionIcon } from '../../../components/ActionIcon'
// @arch docs/features/network-rooms/ui.md#六移动端
// @test src/__tests__/room-navigation.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { extractRoomInvitation } from '../../../utils/scan'

export function RoomRootActionModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean
  onClose: () => void
  onCreate: () => void
}) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [joining, setJoining] = useState(false)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const nativeMenuPresented = useRef(false)
  useEffect(() => {
    if (!visible) {
      nativeMenuPresented.current = false
      setJoining(false)
      setValue('')
      setInvalid(false)
    }
  }, [visible])

  const submit = () => {
    const invitation = extractRoomInvitation(value, getServerUrl())
    if (!invitation) return setInvalid(true)
    onClose()
    router.navigate(
      `/spaces/${encodeURIComponent(invitation.roomId)}?invite=${encodeURIComponent(invitation.inviteToken)}`,
    )
  }

  const scan = useCallback(() => {
    onClose()
    router.navigate('/(main)/scan')
  }, [onClose, router])
  const create = useCallback(() => {
    onClose()
    onCreate()
  }, [onClose, onCreate])

  useEffect(() => {
    if (Platform.OS === 'web' || !visible || joining || nativeMenuPresented.current) return
    nativeMenuPresented.current = true
    const actions = [t('spaces_scan_invite'), t('spaces_enter_link'), t('mobile_new_conversation')]
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t('spaces_add_room'),
          options: [...actions, t('cancel')],
          cancelButtonIndex: actions.length,
        },
        (selectedIndex) => {
          if (selectedIndex === 0) scan()
          else if (selectedIndex === 1) setJoining(true)
          else if (selectedIndex === 2) create()
          else onClose()
        },
      )
      return
    }
    Alert.alert(
      t('spaces_add_room'),
      undefined,
      [
        { text: actions[0], onPress: scan },
        { text: actions[1], onPress: () => setJoining(true) },
        { text: actions[2], onPress: create },
      ],
      { cancelable: true, onDismiss: onClose },
    )
  }, [create, joining, onClose, scan, t, visible])

  if (Platform.OS !== 'web') {
    return (
      <Modal
        visible={visible && joining}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={onClose}
      >
        <SafeAreaView style={[styles.nativeRoot, { backgroundColor: colors.bg }]}>
          <KeyboardAvoidingView
            style={styles.nativeRoot}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[styles.nativeHeader, { borderBottomColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('cancel')}
                style={styles.nativeHeaderAction}
                onPress={onClose}
              >
                <Text style={[styles.nativeHeaderActionText, { color: colors.brand }]}>
                  {t('cancel')}
                </Text>
              </Pressable>
              <Text style={[styles.nativeTitle, { color: colors.text }]}>
                {t('spaces_enter_link')}
              </Text>
              <View style={styles.nativeHeaderAction} />
            </View>
            <View style={styles.nativeForm}>
              <TextInput
                autoFocus
                value={value}
                onChangeText={(next) => {
                  setValue(next)
                  setInvalid(false)
                }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('spaces_invite_input_placeholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.nativeInput,
                  {
                    color: colors.text,
                    backgroundColor: colors.surface,
                    borderColor: invalid ? colors.error : colors.border,
                  },
                ]}
              />
              {invalid ? (
                <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13 }}>
                  {t('spaces_invite_input_invalid')}
                </Text>
              ) : null}
              <View style={styles.nativeActions}>
                <Pressable
                  accessibilityRole="button"
                  style={styles.nativeSecondary}
                  onPress={() =>
                    void Clipboard.getStringAsync().then((text) => {
                      setValue(text)
                      setInvalid(false)
                    })
                  }
                >
                  <Text style={{ color: colors.brand, fontSize: 17 }}>{t('paste')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.nativePrimary, { backgroundColor: colors.brand }]}
                  onPress={submit}
                >
                  <Text style={styles.nativePrimaryText}>{t('spaces_join_room')}</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    )
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.surface }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            {joining ? t('spaces_enter_link') : t('spaces_add_room')}
          </Text>
          {joining ? (
            <>
              <TextInput
                autoFocus
                value={value}
                onChangeText={(next) => {
                  setValue(next)
                  setInvalid(false)
                }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('spaces_invite_input_placeholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: invalid ? colors.error : colors.border },
                ]}
              />
              <View style={styles.actions}>
                <Pressable
                  style={styles.secondary}
                  onPress={() =>
                    void Clipboard.getStringAsync().then((text) => {
                      setValue(text)
                      setInvalid(false)
                    })
                  }
                >
                  <Text style={{ color: colors.brand }}>{t('paste')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.primary, { backgroundColor: colors.brand }]}
                  onPress={submit}
                >
                  <Text style={styles.primaryText}>{t('spaces_join_room')}</Text>
                </Pressable>
              </View>
              {invalid ? (
                <Text style={{ color: colors.error, fontSize: 12 }}>
                  {t('spaces_invite_input_invalid')}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Pressable
                style={[styles.row, { borderBottomColor: colors.border }]}
                onPress={scan}
                testID="room-scan-invite-action"
              >
                <Ionicons name="scan-outline" size={22} color={colors.textSecondary} />
                <Text style={[styles.rowText, { color: colors.text }]}>
                  {t('spaces_scan_invite')}
                </Text>
              </Pressable>
              <Pressable
                testID="room-paste-invite-action"
                style={[styles.row, { borderBottomColor: colors.border }]}
                onPress={() => setJoining(true)}
              >
                <Ionicons name="link-outline" size={22} color={colors.textSecondary} />
                <Text style={[styles.rowText, { color: colors.text }]}>
                  {t('spaces_enter_link')}
                </Text>
              </Pressable>
              <Pressable
                testID="room-create-action-menu"
                style={[styles.row, styles.lastRow]}
                onPress={create}
              >
                <ActionIcon name="add" color={colors.textSecondary} />
                <Text style={[styles.rowText, { color: colors.text }]}>
                  {t('spaces_create_action')}
                </Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  nativeRoot: { flex: 1 },
  nativeHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  nativeHeaderAction: {
    width: 72,
    minHeight: 44,
    paddingHorizontal: 8,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  nativeHeaderActionText: { fontSize: 17, lineHeight: 22 },
  nativeTitle: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22, fontWeight: '600' },
  nativeForm: { padding: 16, gap: 12 },
  nativeInput: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 17,
  },
  nativeActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  nativeSecondary: {
    minHeight: 48,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativePrimary: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativePrimaryText: { color: '#fff', fontSize: 17, lineHeight: 22, fontWeight: '600' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 420, borderRadius: 18, padding: 18 },
  title: { fontSize: 19, fontWeight: '700', marginBottom: 14 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { fontSize: 16 },
  lastRow: { borderBottomWidth: 0 },
  input: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, fontSize: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  secondary: {
    minHeight: 42,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '600' },
})
