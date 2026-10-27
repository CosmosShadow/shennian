// @arch docs/features/agent-workspaces.md
// @test src/__tests__/agent-avatar-editor.test.ts

import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native'
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import type { AgentWorkspace } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { agentAccountClient } from './agentAccountClient'
import { useAuthStore } from '../../config/auth'
import { buildSquareAvatarActions } from '../profile/profileAvatar'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'

export type AgentAvatarDraft = { uri: string }

export async function prepareAgentAvatarDraft(
  asset: ImagePicker.ImagePickerAsset,
): Promise<AgentAvatarDraft> {
  const actions = buildSquareAvatarActions(asset.width || 0, asset.height || 0)
  const normalized = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
  })
  return { uri: normalized.uri }
}

export async function uploadAgentAvatarDraft(
  agentId: string,
  draft: AgentAvatarDraft,
): Promise<NonNullable<AgentWorkspace['avatar']>> {
  const blob = await fetch(draft.uri).then((response) => response.blob())
  return agentAccountClient.setAgentAvatar(agentId, blob, 'image/jpeg')
}

function showError(message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(message)
  else Alert.alert('', message)
}

export function AgentAvatarEditor({
  agent,
  onAvatarChanged,
}: {
  agent: AgentWorkspace
  onAvatarChanged: (avatar: AgentWorkspace['avatar']) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const [busy, setBusy] = useState(false)

  const saveAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      const draft = await prepareAgentAvatarDraft(asset)
      onAvatarChanged(await uploadAgentAvatarDraft(agent.id, draft))
    },
    [agent.id, onAvatarChanged],
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
      showError(t('agents_avatar_save_failed'))
    } finally {
      setBusy(false)
    }
  }, [busy, saveAsset, t])

  const chooseAvatar = useCallback(() => {
    if (Platform.OS === 'web') { void choosePhoto('library'); return }
    Alert.alert(t('agents_avatar_change'), '', [
      { text: t('profile_avatar_camera'), onPress: () => void choosePhoto('camera') },
      { text: t('profile_avatar_choose'), onPress: () => void choosePhoto('library') },
      { text: t('cancel'), style: 'cancel' },
    ])
  }, [choosePhoto, t])

  const restoreOwnerAvatar = useCallback(() => {
    Alert.alert(t('agents_avatar_use_mine'), t('agents_avatar_use_mine_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm'),
        onPress: () => {
          setBusy(true)
          void agentAccountClient.removeAgentAvatar(agent.id)
            .then(() => onAvatarChanged(null))
            .catch(() => showError(t('agents_avatar_save_failed')))
            .finally(() => setBusy(false))
        },
      },
    ])
  }, [agent.id, onAvatarChanged, t])

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('agents_avatar_change')}
        accessibilityHint={agent.avatar ? t('agents_avatar_use_mine_confirm') : undefined}
        testID="agent-avatar-library"
        disabled={busy}
        onPress={chooseAvatar}
        onLongPress={agent.avatar ? restoreOwnerAvatar : undefined}
        style={styles.avatarButton}
      >
        <RoomIdentityAvatar
          name={agent.displayName}
          avatar={agent.avatar}
          agent
          ownerName={user?.name}
          ownerAvatar={user?.avatar}
          size={76}
        />
        {busy ? <ActivityIndicator style={styles.loading} size="small" /> : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingVertical: 4, gap: 2 },
  avatarButton: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  loading: {
    position: 'absolute',
    alignSelf: 'center',
  },
})
