// @arch docs/features/network-rooms/ui.md#六移动端
// @test src/__tests__/room-navigation.test.ts

import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { RoomSummary } from '@shennian/wire'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import {
  completeRoomCreation,
  RoomCreateWorkflowError,
  type RoomCreateFailure,
} from '../roomCreateWorkflow'
import { roomAccountClient } from '../roomAccountClient'
import { mobileTypography } from '../../../theme/mobileTypography'

type Props = {
  visible: boolean
  onClose: () => void
  onCreated: (room: RoomSummary) => void
}

export function RoomCreateModal({ visible, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const refreshToken = useAuthStore((state) => state.refreshToken)
  const login = useAuthStore((state) => state.login)
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [nicknameRequired, setNicknameRequired] = useState(false)
  const [creating, setCreating] = useState(false)
  const [failure, setFailure] = useState<RoomCreateFailure | null>(null)

  useEffect(() => {
    if (visible) {
      setNickname(user?.name ?? '')
      setNicknameRequired(!user?.name.trim())
    } else {
      setName('')
      setNickname('')
      setNicknameRequired(false)
      setFailure(null)
      setCreating(false)
    }
  }, [user?.name, visible])

  const create = async () => {
    const normalizedName = name.trim()
    if (!normalizedName || creating) return
    if (nicknameRequired && !nickname.trim()) {
      setFailure('nickname_required')
      return
    }
    setCreating(true)
    setFailure(null)
    try {
      const room = await completeRoomCreation({
        name: normalizedName,
        nickname,
        nicknameRequired,
        updateProfile: (nextNickname) => roomAccountClient.updateCurrentUserName(nextNickname),
        persistProfile: async (updatedUser) => {
          if (token && refreshToken) await login(token, refreshToken, updatedUser)
        },
        createRoom: (roomName) => roomAccountClient.createRoom(roomName),
      })
      onCreated(room)
      onClose()
    } catch (error) {
      const reason = error instanceof RoomCreateWorkflowError ? error.reason : 'room_create_failed'
      if (reason === 'nickname_required') setNicknameRequired(true)
      setFailure(reason)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>{t('spaces_create_title')}</Text>
          </View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('spaces_create_name_label')}
          </Text>
          <TextInput
            testID="room-create-name-input"
            accessibilityLabel={t('spaces_create_name_label')}
            autoFocus
            value={name}
            maxLength={80}
            onChangeText={setName}
            onSubmitEditing={() => void create()}
            placeholder={t('spaces_create_name_placeholder')}
            placeholderTextColor={colors.textTertiary}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg },
            ]}
          />
          {nicknameRequired ? (
            <View style={styles.nicknameSection}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('profile_nickname')}
              </Text>
              <TextInput
                accessibilityLabel={t('profile_nickname')}
                value={nickname}
                maxLength={40}
                onChangeText={setNickname}
                onSubmitEditing={() => void create()}
                placeholder={t('profile_nickname_placeholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg },
                ]}
              />
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {t('room_invite_name_hint')}
              </Text>
            </View>
          ) : null}
          {failure ? (
            <Text style={[styles.error, { color: colors.error }]}>
              {failure === 'nickname_required'
                ? t('room_invite_name_required')
                : failure === 'profile_update_failed'
                  ? t('profile_nickname_save_failed')
                  : t('spaces_create_failed')}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable style={styles.cancel} onPress={onClose}>
              <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
                {t('cancel')}
              </Text>
            </Pressable>
            <Pressable
              testID="room-create-submit"
              disabled={!name.trim() || (nicknameRequired && !nickname.trim()) || creating}
              onPress={() => void create()}
              style={[
                styles.submit,
                {
                  backgroundColor: colors.brand,
                  opacity:
                    !name.trim() || (nicknameRequired && !nickname.trim()) || creating ? 0.45 : 1,
                },
              ]}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitText}>{t('spaces_create_action')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
    padding: 20,
  },
  card: { width: '100%', maxWidth: 430, borderRadius: 20, padding: 20 },
  header: { marginBottom: 20 },
  title: {
    ...(Platform.OS === 'web'
      ? { fontSize: 19, lineHeight: 25, fontWeight: '700' as const }
      : mobileTypography.navigationTitle),
  },
  label: {
    ...(Platform.OS === 'web'
      ? { fontSize: 12, lineHeight: 18, fontWeight: '600' as const }
      : mobileTypography.secondary),
    marginBottom: 7,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 14,
    ...(Platform.OS === 'web' ? { fontSize: 15 } : mobileTypography.body),
  },
  nicknameSection: { marginTop: 14 },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  error: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  cancel: { height: 44, justifyContent: 'center', paddingHorizontal: 15 },
  cancelText: {
    ...(Platform.OS === 'web'
      ? { fontSize: 14, fontWeight: '600' as const }
      : mobileTypography.compactAction),
  },
  submit: {
    minWidth: 100,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  submitText: {
    color: '#fff',
    ...(Platform.OS === 'web'
      ? { fontSize: 14, fontWeight: '700' as const }
      : mobileTypography.compactAction),
  },
})
