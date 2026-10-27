// @arch docs/features/agent-workspaces.md
// @test src/__tests__/agent-avatar-editor.test.ts

import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { prepareAgentAvatarDraft, type AgentAvatarDraft } from './AgentAvatarEditor'

function showError(message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(message)
  else Alert.alert('', message)
}

export function AgentAvatarDraftEditor({
  name,
  value,
  disabled = false,
  onChange,
}: {
  name: string
  value: AgentAvatarDraft | null
  disabled?: boolean
  onChange: (value: AgentAvatarDraft | null) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const [busy, setBusy] = useState(false)

  const choosePhoto = useCallback(async (source: 'library' | 'camera') => {
    if (busy || disabled) return
    setBusy(true)
    try {
      if (Platform.OS !== 'web') {
        const permission = source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (permission.status !== 'granted') {
          showError(t(source === 'camera' ? 'profile_avatar_camera_permission' : 'profile_avatar_photo_permission'))
          return
        }
      }
      const pickerOptions: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions)
      if (!result.canceled && result.assets[0]) {
        onChange(await prepareAgentAvatarDraft(result.assets[0]))
      }
    } catch {
      showError(t('agents_avatar_save_failed'))
    } finally {
      setBusy(false)
    }
  }, [busy, disabled, onChange, t])

  const chooseAvatar = useCallback(() => {
    if (Platform.OS === 'web') { void choosePhoto('library'); return }
    Alert.alert(t('agents_avatar_change'), '', [
      { text: t('profile_avatar_camera'), onPress: () => void choosePhoto('camera') },
      { text: t('profile_avatar_choose'), onPress: () => void choosePhoto('library') },
      { text: t('cancel'), style: 'cancel' },
    ])
  }, [choosePhoto, t])

  const restoreOwnerAvatar = useCallback(() => {
    if (!value || busy || disabled) return
    Alert.alert(t('agents_avatar_use_mine'), t('agents_avatar_use_mine_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('confirm'), onPress: () => onChange(null) },
    ])
  }, [busy, disabled, onChange, t, value])

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('agents_avatar_change')}
        accessibilityHint={value ? t('agents_avatar_use_mine_confirm') : undefined}
        testID="agent-avatar-draft-library"
        disabled={busy || disabled}
        onPress={chooseAvatar}
        onLongPress={value ? restoreOwnerAvatar : undefined}
        style={styles.avatarButton}
      >
        {value ? (
          <Image source={{ uri: value.uri }} style={styles.preview} />
        ) : (
          <RoomIdentityAvatar
            name={name}
            avatar={null}
            agent
            ownerName={user?.name}
            ownerAvatar={user?.avatar}
            size={76}
          />
        )}
        {busy ? <ActivityIndicator style={styles.loading} size="small" /> : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingVertical: 4, gap: 2 },
  avatarButton: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  preview: { width: 76, height: 76, borderRadius: 38 },
  loading: {
    position: 'absolute',
    alignSelf: 'center',
  },
})
