// @arch docs/features/free-growth-phase.md
// @test src/__tests__/profile-settings-structure.test.ts

import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { styles } from '../styles'
import { ProfileAvatarEditor } from './ProfileAvatarEditor'

type ThemeColors = {
  border: string
  bg: string
  surface: string
  text: string
  textSecondary: string
  textTertiary: string
  surfaceHover: string
}

type Props = {
  colors: ThemeColors
  nickname: string
  nicknameDraft: string
  nicknameEditing: boolean
  nicknameSaving: boolean
  onCancelNicknameEdit: () => void
  onChangeNicknameDraft: (value: string) => void
  onSaveNickname: () => void
  onStartNicknameEdit: () => void
  onOpenProfile?: () => void
  introduction?: string
  t: (key: string) => string
}

export function ProfileIdentityCard({
  colors,
  nickname,
  nicknameDraft,
  nicknameEditing,
  nicknameSaving,
  onCancelNicknameEdit,
  onChangeNicknameDraft,
  onSaveNickname,
  onStartNicknameEdit,
  onOpenProfile,
  introduction,
  t,
}: Props) {
  return (
    <>
      <View style={styles.profileIdentityCard}>
        <ProfileAvatarEditor t={t} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(onOpenProfile ? 'mobile_view_personal_profile' : 'profile_nickname')}
          style={styles.profileIdentityName}
          onPress={onOpenProfile ?? onStartNicknameEdit}
          testID={onOpenProfile ? 'profile-open-personal' : 'profile-edit-nickname'}
        >
          <View style={styles.profileIdentityText}>
            <Text style={[styles.profileIdentityNickname, { color: colors.text }]} numberOfLines={1}>
              {nickname || t('profile_nickname_unset')}
            </Text>
            <Text style={[styles.profileIdentityHint, { color: colors.textSecondary }]} numberOfLines={1}>
              {onOpenProfile ? (introduction?.trim() || t('mobile_introduction_empty')) : t('settings_profile_hint')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <Modal
        visible={nicknameEditing}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        onRequestClose={onCancelNicknameEdit}
      >
        <KeyboardAvoidingView
          style={styles.nicknameModalKeyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={styles.nicknameModalOverlay}
            accessibilityViewIsModal
            testID="profile-nickname-modal"
          >
            <Pressable
              style={styles.nicknameModalBackdrop}
              onPress={onCancelNicknameEdit}
              accessible={false}
            />
            <View
              style={[
                styles.nicknameModalCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.nicknameModalTitle, { color: colors.text }]}>
                {t('profile_nickname')}
              </Text>
              <TextInput
                accessibilityLabel={t('profile_nickname')}
                autoFocus
                selectTextOnFocus
                value={nicknameDraft}
                onChangeText={onChangeNicknameDraft}
                onSubmitEditing={onSaveNickname}
                editable={!nicknameSaving}
                maxLength={40}
                returnKeyType="done"
                placeholder={t('profile_nickname_placeholder')}
                placeholderTextColor={colors.textTertiary}
                testID="profile-nickname-input"
                style={[
                  styles.nicknameModalInput,
                  {
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />
              <View style={styles.nicknameModalActions}>
                <Pressable
                  style={styles.nicknameModalAction}
                  disabled={nicknameSaving}
                  onPress={onCancelNicknameEdit}
                  testID="profile-cancel-nickname"
                >
                  <Text style={[styles.nicknameModalCancelText, { color: colors.textSecondary }]}>
                    {t('cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.nicknameModalAction, { backgroundColor: colors.surfaceHover }]}
                  disabled={nicknameSaving}
                  onPress={onSaveNickname}
                  testID="profile-save-nickname"
                >
                  {nicknameSaving ? (
                    <ActivityIndicator color={colors.text} size="small" />
                  ) : (
                    <Text style={[styles.nicknameModalSaveText, { color: colors.text }]}>
                      {t('save')}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  )
}
