// @arch docs/features/network-rooms/ui.md#三昵称和头像
// @test src/__tests__/profile-avatar-editor.test.ts

import { useCallback, useMemo, useState } from 'react'
import { Alert, Image, Platform, Pressable, Text, View } from 'react-native'
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { getApiBaseUrl } from '../../../config/api'
import { useAuthStore } from '../../../config/auth'
import { profileAccountClient } from '../../account/profileAccountClient'
import { styles } from '../styles'
import { avatarBorderRadius } from '../../../components/avatarShape'
import {
  buildSquareAvatarActions,
  resolveProfileAvatarUrl,
  stableAvatarColor,
} from '../profileAvatar'

type Props = {
  t: (key: string) => string
  size?: number
}

type Avatar = NonNullable<NonNullable<ReturnType<typeof useAuthStore.getState>['user']>['avatar']>

function showError(message: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(message)
  else Alert.alert('', message)
}

export function ProfileAvatarEditor({ t, size }: Props) {
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const refreshToken = useAuthStore((state) => state.refreshToken)
  const login = useAuthStore((state) => state.login)
  const [busy, setBusy] = useState(false)
  const initial = (user?.name.trim().slice(0, 1) || '?').toUpperCase()
  const initialColor = useMemo(() => stableAvatarColor(user?.id ?? initial), [initial, user?.id])

  const saveAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      const actions = buildSquareAvatarActions(asset.width || 0, asset.height || 0)
      const normalized = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
      })
      const blob = await fetch(normalized.uri).then((response) => response.blob())
      const avatar: Avatar = await profileAccountClient.setAvatar(blob, 'image/jpeg')
      if (user && token && refreshToken)
        await login(token, refreshToken, { ...user, avatar })
    },
    [login, refreshToken, token, user],
  )

  const choosePhoto = useCallback(async (source: 'library' | 'camera') => {
    if (busy) return
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
      if (!result.canceled && result.assets[0]) await saveAsset(result.assets[0])
    } catch {
      showError(t('profile_avatar_save_failed'))
    } finally {
      setBusy(false)
    }
  }, [busy, saveAsset, t])

  const chooseAvatar = useCallback(() => {
    if (Platform.OS === 'web') { void choosePhoto('library'); return }
    Alert.alert(t('profile_avatar_choose'), '', [
      { text: t('profile_avatar_camera'), onPress: () => void choosePhoto('camera') },
      { text: t('profile_avatar_choose'), onPress: () => void choosePhoto('library') },
      { text: t('cancel'), style: 'cancel' },
    ])
  }, [choosePhoto, t])

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('profile_avatar_choose')}
      testID="profile-avatar-library"
      disabled={busy}
      onPress={chooseAvatar}
      style={[
        styles.profileAvatarPressable,
        size ? { width: size, height: size, borderRadius: avatarBorderRadius(size), marginRight: 0 } : null,
        busy && { opacity: 0.62 },
      ]}
    >
      {user?.avatar ? (
        <Image
          source={{
            uri: resolveProfileAvatarUrl(
              user.avatar.mediumUrl,
              getApiBaseUrl(),
              user.avatar.version,
            ),
          }}
          style={[styles.profileAvatarImage, size ? { width: size, height: size, borderRadius: avatarBorderRadius(size) } : null]}
        />
      ) : (
        <View style={[styles.profileAvatarImage, size ? { width: size, height: size, borderRadius: avatarBorderRadius(size) } : null, { backgroundColor: initialColor }]}>
          <Text style={[styles.profileAvatarInitial, size ? { fontSize: size * 0.42 } : null]}>{initial}</Text>
        </View>
      )}
    </Pressable>
  )
}
