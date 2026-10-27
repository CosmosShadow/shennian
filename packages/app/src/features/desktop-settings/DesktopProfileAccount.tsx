// @arch docs/features/desktop-settings-information-architecture.md
// @test ../../__tests__/desktop-profile-presentation.test.ts
import type { ComponentProps, RefObject } from 'react'
import { ActivityIndicator, Text, View, type View as ViewType } from 'react-native'
import type { ProfileAccountCard } from '../profile/components/ProfileAccountCard'
import { maskPhone } from '../profile/profileUtils'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

type Props = Omit<ComponentProps<typeof ProfileAccountCard>, 'accountOpen' | 'onToggleOpen'> & {
  busy?: boolean
  confirmationRef?: RefObject<ViewType | null>
  deleteProgressRef?: RefObject<ViewType | null>
  deleteTriggerRef?: RefObject<ViewType | null>
  logoutTriggerRef?: RefObject<ViewType | null>
}

/** Account actions are flat; confirmation state is supplied by the owning controller. */
export function DesktopProfileAccount(props: Props) {
  const { t, colors } = props
  const busy = Boolean(props.busy || props.accountDeleting)
  return <View style={{ gap: 12 }}>
    {props.phone ? <Text style={[desktopTypography.metadata, { color: colors.textSecondary }]}>{maskPhone(props.phone)}</Text> : null}
    {props.accountDeleting ? <View
      ref={props.deleteProgressRef}
      accessibilityLabel={t('account_delete_progress')}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      focusable
      testID="desktop-account-delete-progress"
    >
      <ActivityIndicator color={colors.text} />
      <Text style={[desktopTypography.body, { color: colors.text }]}>{t('account_delete_progress')}</Text>
      <Text style={[desktopTypography.metadata, { color: colors.textSecondary }]}>{t('account_delete_progress_detail')}</Text>
    </View> : props.confirmingDeleteAccount ? <>
      <Text style={[desktopTypography.body, { color: colors.textSecondary }]}>{t('account_delete_warning')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <DesktopMachineAction compact actionRef={props.confirmationRef} label={t('cancel')} disabled={busy} onPress={() => props.setConfirmingDeleteAccount(false)} />
        <DesktopMachineAction compact label={t('account_delete')} destructive disabled={busy} onPress={props.onConfirmDeleteAccount} />
      </View>
    </> : props.confirmingLogout ? <>
      <Text style={[desktopTypography.body, { color: colors.textSecondary }]}>{t('logout_confirm')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <DesktopMachineAction compact actionRef={props.confirmationRef} label={t('cancel')} disabled={busy} onPress={() => props.setConfirmingLogout(false)} />
        <DesktopMachineAction compact label={t('logout')} destructive disabled={busy} onPress={props.onConfirmLogout} />
      </View>
    </> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <DesktopMachineAction compact actionRef={props.deleteTriggerRef} label={t('account_delete')} destructive disabled={busy} onPress={props.onRequestDeleteAccount} />
    </View>}
  </View>
}
