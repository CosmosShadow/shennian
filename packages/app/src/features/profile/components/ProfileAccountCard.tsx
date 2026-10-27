// @arch docs/features/free-growth-phase.md
// @arch docs/features/desktop-settings-information-architecture.md
// @test src/__tests__/profile-settings-structure.test.ts

import { type ReactNode } from 'react'
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { styles } from '../styles'
import { maskPhone } from '../profileUtils'

type ThemeColors = {
  bg: string
  error: string
  groupedSeparator: string
  surfaceHover: string
  text: string
  textSecondary: string
  textTertiary: string
}

type DynamicStyles = {
  settingsGroup: { backgroundColor: string }
  rowLabel: { color: string }
  rowValue: { color: string }
  logoutText: { color: string }
  deleteAccountText: { color: string }
}

type Props = {
  devicesPanel?: ReactNode
  accountOpen: boolean
  standalone?: boolean
  phone?: string | null
  accountDeleting: boolean
  confirmingDeleteAccount: boolean
  confirmingLogout: boolean
  colors: ThemeColors
  iconColor: string
  ds: DynamicStyles
  onConfirmDeleteAccount: () => void
  onConfirmLogout: () => void
  onRequestDeleteAccount: () => void
  onRequestLogout: () => void
  onToggleOpen: () => void
  setConfirmingDeleteAccount: (next: boolean) => void
  setConfirmingLogout: (next: boolean) => void
  t: (key: string, options?: { defaultValue: string }) => string
}

export function ProfileAccountCard({
  devicesPanel,
  accountOpen,
  standalone = false,
  phone,
  accountDeleting,
  confirmingDeleteAccount,
  confirmingLogout,
  colors,
  iconColor,
  ds,
  onConfirmDeleteAccount,
  onConfirmLogout,
  onRequestDeleteAccount,
  onRequestLogout,
  onToggleOpen,
  setConfirmingDeleteAccount,
  setConfirmingLogout,
  t,
}: Props) {
  return (
    <>
      <View style={[styles.settingsGroup, ds.settingsGroup]}>
        {standalone ? <View style={styles.row}>
          <Ionicons name="phone-portrait-outline" size={21} color={iconColor} />
          <Text style={[styles.rowLabel, ds.rowLabel]}>{t('mobile_login_phone')}</Text>
          {phone ? <Text style={[styles.rowValue, styles.rowSummary, ds.rowValue]}>{maskPhone(phone)}</Text> : null}
        </View> : <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile_account_security')}
          accessibilityState={{ expanded: accountOpen }}
          testID="profile-account-toggle"
          onPress={onToggleOpen}
        >
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={21} color={iconColor} />
            <Text style={[styles.rowLabel, ds.rowLabel]}>
              {t('mobile_account_security')}
            </Text>
            <Text style={[styles.rowValue, styles.rowSummary, ds.rowValue]} numberOfLines={1}>
              {t('mobile_account_security_summary')}
            </Text>
            <Ionicons
              name={accountOpen ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color={colors.textTertiary}
            />
          </View>
        </Pressable>}
        {standalone ? devicesPanel : null}
        {accountOpen && !standalone ? (
          <View style={[styles.expandedSubsection, { backgroundColor: colors.surfaceHover }]}>
            {devicesPanel}
            {confirmingDeleteAccount ? (
              <View style={[styles.accountDeleteBlock, { borderTopColor: colors.groupedSeparator }]}>
                <Text style={[styles.accountDeleteWarning, { color: colors.textSecondary }]}>
                  {t('account_delete_warning')}
                </Text>
                <View style={styles.accountDeleteActions}>
                  <Pressable
                    style={styles.accountCancelBtn}
                    disabled={accountDeleting}
                    onPress={() => setConfirmingDeleteAccount(false)}
                  >
                    <Text style={[styles.accountCancelText, { color: colors.textSecondary }]}>
                      {t('cancel')}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.accountDangerBtn, { backgroundColor: colors.error }]}
                    disabled={accountDeleting}
                    onPress={onConfirmDeleteAccount}
                  >
                    {accountDeleting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.accountDangerText}>{t('account_delete')}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : confirmingLogout ? (
              <View style={[styles.accountActionRow, { borderTopColor: colors.groupedSeparator }]}>
                <Text style={[styles.accountConfirmText, { color: colors.textSecondary }]}>
                  {t('logout_confirm')}
                </Text>
                <Pressable
                  style={styles.accountCancelBtn}
                  onPress={() => setConfirmingLogout(false)}
                  testID="profile-cancel-logout"
                >
                  <Text style={[styles.accountCancelText, { color: colors.textSecondary }]}>
                    {t('cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.accountDangerBtn, { backgroundColor: colors.error }]}
                  onPress={onConfirmLogout}
                  testID="profile-confirm-logout"
                >
                  <Text style={styles.accountDangerText}>{t('logout')}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.accountDangerActions, { borderTopColor: colors.groupedSeparator }]}>
                <Pressable
                  style={[
                    styles.accountActionRow,
                    styles.accountDangerActionRow,
                    styles.accountDangerFirstAction,
                  ]}
                  onPress={onRequestLogout}
                  testID="profile-request-logout"
                >
                  <Text style={[styles.accountActionText, ds.logoutText]}>{t('logout')}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.accountActionRow,
                    styles.accountDangerActionRow,
                    { borderTopColor: colors.groupedSeparator },
                  ]}
                  onPress={onRequestDeleteAccount}
                >
                  <Text style={[styles.accountActionText, ds.deleteAccountText]}>
                    {t('account_delete')}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
      </View>
      {standalone ? <>
        <View style={styles.accountSafetyCopy}>
          <Text style={[styles.accountSafetyHeading, { color: colors.textSecondary }]}>{t('mobile_security_section')}</Text>
          <Text style={[styles.accountSafetyHint, { color: colors.textSecondary }]}>{t('mobile_account_security_hint')}</Text>
        </View>
        <View style={[styles.settingsGroup, ds.settingsGroup, styles.standaloneDangerGroup]}>
          {confirmingLogout ? <View style={styles.accountStandaloneConfirm}>
            <Text style={[styles.accountConfirmText, { color: colors.textSecondary }]}>{t('logout_confirm')}</Text>
            <Pressable testID="profile-cancel-logout" onPress={() => setConfirmingLogout(false)}><Text style={{ color: colors.textSecondary }}>{t('cancel')}</Text></Pressable>
            <Pressable testID="profile-confirm-logout" onPress={onConfirmLogout}><Text style={ds.logoutText}>{t('logout')}</Text></Pressable>
          </View> : <Pressable testID="profile-request-logout" accessibilityRole="button" onPress={onRequestLogout}
            style={styles.standaloneDangerButton}>
            <Text style={[styles.accountActionText, ds.logoutText]}>{t('logout')}</Text>
          </Pressable>}
        </View>
        <View style={[styles.settingsGroup, ds.settingsGroup, styles.standaloneDeleteGroup]}>
          {confirmingDeleteAccount ? <View style={styles.accountStandaloneConfirm}>
            <Text style={[styles.accountDeleteWarning, { color: colors.textSecondary }]}>{t('account_delete_warning')}</Text>
            <View style={styles.accountDeleteActions}>
              <Pressable disabled={accountDeleting} onPress={() => setConfirmingDeleteAccount(false)}><Text style={{ color: colors.textSecondary }}>{t('cancel')}</Text></Pressable>
              <Pressable disabled={accountDeleting} onPress={onConfirmDeleteAccount}><Text style={ds.deleteAccountText}>{t('account_delete')}</Text></Pressable>
            </View>
          </View> : <Pressable accessibilityRole="button" onPress={onRequestDeleteAccount}
            style={styles.standaloneDangerButton}>
            <Text style={[styles.accountActionText, ds.deleteAccountText]}>{t('account_delete')}</Text>
            <Text style={[styles.accountSafetyHint, { color: colors.textSecondary }]}>{t('mobile_delete_account_confirm_hint')}</Text>
          </Pressable>}
        </View>
      </> : null}
      <Modal
        visible={accountDeleting}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => {}}
      >
        <View
          style={[styles.accountDeletionProgress, { backgroundColor: colors.bg }]}
          testID="account-deletion-progress"
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator color={iconColor} size="large" />
          <Text style={[styles.accountDeletionTitle, { color: colors.text }]}>
            {t('account_delete_progress')}
          </Text>
          <Text style={[styles.accountDeletionDetail, { color: colors.textSecondary }]}>
            {t('account_delete_progress_detail')}
          </Text>
        </View>
      </Modal>
    </>
  )
}
