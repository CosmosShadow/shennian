// @arch docs/features/desktop-settings-information-architecture.md
// @test ../../__tests__/desktop-profile-presentation.test.ts
import type { ComponentProps, ReactNode, RefObject } from 'react'
import { Text, TextInput, View } from 'react-native'
import type { ProfileIdentityCard } from '../profile/components/ProfileIdentityCard'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { desktopTypography, desktopControlMetrics } from '../desktop-shell/desktopDesignTokens'

type Props = ComponentProps<typeof ProfileIdentityCard> & {
  avatar: ReactNode
  nicknameDirty: boolean
  nicknameTriggerRef: RefObject<View | null>
}

/** Identity presentation only; the Desktop controller owns avatar selection and profile writes. */
export function DesktopProfileIdentity(props: Props) {
  const { colors, t } = props
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {props.avatar}
      <Text style={[desktopTypography.body, { color: colors.text, flexShrink: 1 }]}>{props.nickname || t('profile_nickname_unset')}</Text>
    </View>
    {props.nicknameEditing ? <>
      <TextInput accessibilityLabel={t('profile_nickname')} autoFocus selectTextOnFocus
        testID="desktop-nickname-input"
        value={props.nicknameDraft} onChangeText={props.onChangeNicknameDraft}
        editable={!props.nicknameSaving} maxLength={40} onSubmitEditing={props.onSaveNickname}
        placeholder={t('profile_nickname_placeholder')} placeholderTextColor={colors.textTertiary}
        style={[desktopTypography.body, { minHeight: desktopControlMetrics.standardControlHeight, paddingHorizontal: 10,
          borderWidth: 1, borderRadius: desktopControlMetrics.radiusControl,
          color: colors.text, backgroundColor: colors.bg, borderColor: colors.border }]} />
      {props.nicknameDirty ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="desktop-nickname-unsaved-status"
          style={[desktopTypography.metadata, { color: colors.textSecondary, flexShrink: 1 }]}
        >
          {t('desktop_settings_unsaved_message')}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <DesktopMachineAction compact label={t('cancel')} disabled={props.nicknameSaving} onPress={props.onCancelNicknameEdit} />
        <DesktopMachineAction compact label={t('save')} disabled={props.nicknameSaving} onPress={props.onSaveNickname} />
      </View>
    </> : (
      <View testID="desktop-nickname-edit-trigger" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
        <DesktopMachineAction compact actionRef={props.nicknameTriggerRef} label={t('profile_nickname')} onPress={props.onStartNicknameEdit} />
      </View>
    )}
  </View>
}
