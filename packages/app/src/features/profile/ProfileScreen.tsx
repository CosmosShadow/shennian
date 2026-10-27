import { useMobileModuleBack } from '../../components/useMobileModuleBack'
// @arch docs/features/free-growth-phase.md
// @arch docs/features/desktop-local-first-client.md
// @arch docs/features/desktop-settings-information-architecture.md
// @test src/__tests__/profile-settings-structure.test.ts

import React, { useState, useCallback, useMemo, useRef } from 'react'
import { View, Text, Pressable, Alert, ScrollView, Platform, Linking, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useAuthStore } from '../../config/auth'
import { useMachinesStore } from '@shennian/shared'
import { useTheme } from '../../hooks/useTheme'
import { AppPageHeader, HeaderIconButton } from '../../components/ConnectedAppPageHeader'
import { clearAccountLocalData } from '../../config/sync'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Crypto from 'expo-crypto'
import { displayDeviceName, platformIconName, type DeviceInfo, useRelativeTime } from './profileUtils'
import { styles } from './styles'
import { ProfileAccountCard } from './components/ProfileAccountCard'
import { ProfileIdentityCard } from './components/ProfileIdentityCard'
import { ProfileDevicesCard } from './components/ProfileDevicesCard'
import { useAppUpdateState } from './appUpdate'
import { useLatestCliVersionForBadges, useSettingsUpgradeBadges } from './settingsBadges'
import {
  clearProfileDevices,
  refreshProfileDevices,
  removeCachedProfileDevice,
  useProfileDevicesStore,
} from '../../config/profileDevices'
import { clearMyProfileCache, hydrateMyProfile, refreshMyProfile, useMyProfileStore } from '../../config/myProfile'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { resolveSettingsAccountUiState } from './settingsAccountUiState'
import { ProfileAccountDataStateNotice } from './components/ProfileAccountDataStateNotice'
import { ProfileContactGroup } from './components/ProfileContactGroup'
import { VersionActionButton } from '../desktop-settings/versionPresentation'
import { profileAccountClient } from '../account/profileAccountClient'
import { machineAccountClient } from '../machines/machineAccountClient'
import { useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import { getMobileAppDownloadUrl } from '../../platform/mobileAppDownload'
import { revokeAiDataConsents } from '../privacy/aiDataConsent'
import { PUBLIC_SITE_URL } from '../../config/server'

const EMPTY_DEVICES: DeviceInfo[] = []

export default function ProfileScreen({ mode = 'root' }: { mode?: 'root' | 'account' | 'devices' } = {}) {
  const { t } = useTranslation()
  const networkStatus = useNetworkStatus()
  const moduleBack = useMobileModuleBack()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)
  const machines = useMachinesStore((s) => s.machines)
  const machinesLoading = useMachinesStore((s) => s.loading)
  const setMachines = useMachinesStore((s) => s.setMachines)
  const { colors, isDark } = useTheme()
  const relativeTime = useRelativeTime()
  const devices = useProfileDevicesStore((s) => (s.userId === user?.id ? s.devices : EMPTY_DEVICES))
  const devicesLoading = useProfileDevicesStore((s) => s.userId === user?.id && s.refreshing)
  const devicesLoaded = useProfileDevicesStore((s) => s.userId === user?.id && s.loaded)
  const [devicesOpen, setDevicesOpen] = useState(mode === 'devices')
  const [devicesFailed, setDevicesFailed] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [nicknameEditing, setNicknameEditing] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [nicknameSaving, setNicknameSaving] = useState(false)
  const myProfile = useMyProfileStore((s) => (s.userId === user?.id ? s.profile : null))
  const introduction = myProfile?.person.description ?? ''
  const [revoking, setRevoking] = useState<string | null>(null)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(false)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const accountDeletionOperationId = useRef<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const compatibilitySnapshot = useRelayConnectivitySnapshot()
  const appUpdate = useAppUpdateState({ autoCheck: true, compatibilitySnapshot })
  const latestCliVersion = useLatestCliVersionForBadges(machines.length > 0)
  const loadDevices = useCallback(async () => {
    setDevicesFailed(false)
    try {
      await refreshProfileDevices(user?.id)
    } catch {
      setDevicesFailed(true)
    }
  }, [user?.id])

  useFocusEffect(
    useCallback(() => {
      void hydrateMyProfile(user?.id).then(() => refreshMyProfile(user?.id)).catch(() => {})
      machineAccountClient
        .listMachines()
        .then((nextMachines) => setMachines(nextMachines))
        .catch(() => {})
      if (token && refreshToken) {
        profileAccountClient.getProfile()
          .then((currentUser) => login(token, refreshToken, currentUser))
          .catch(() => {})
      }
      void loadDevices()
    }, [loadDevices, login, refreshToken, setMachines, token, user?.id]),
  )

  const settingsBadges = useSettingsUpgradeBadges({
    machines,
    latestCliVersion,
    ota: appUpdate.hasUpdateBadge,
  })
  const accountDataState = resolveSettingsAccountUiState({
    desktop: false,
    initialLoadPending: (machinesLoading && machines.length === 0) || !devicesLoaded,
    cachedItemCount: machines.length + devices.length,
    offline: networkStatus === 'offline',
    refreshFailed: devicesFailed,
  })

  const handleRevoke = async (deviceId: string) => {
    setRevoking(deviceId)
    try {
      await profileAccountClient.revokeDevice(deviceId)
      if (user?.id) removeCachedProfileDevice(user.id, deviceId)
    } catch {
      // silent
    } finally {
      setRevoking(null)
    }
  }

  const handleToggleDevices = useCallback(() => {
    const nextOpen = !devicesOpen
    setDevicesOpen(nextOpen)
    if (nextOpen && !devicesLoaded && !devicesLoading) {
      void loadDevices()
    }
  }, [devicesLoaded, devicesLoading, devicesOpen, loadDevices])

  const handleStartNicknameEdit = useCallback(() => {
    setNicknameDraft(user?.name ?? '')
    setNicknameEditing(true)
  }, [user?.name])

  const handleCancelNicknameEdit = useCallback(() => {
    setNicknameDraft(user?.name ?? '')
    setNicknameEditing(false)
  }, [user?.name])

  const handleSaveNickname = useCallback(async (): Promise<boolean> => {
    if (nicknameSaving) return false
    setNicknameSaving(true)
    try {
      const currentUser = await profileAccountClient.updateProfile(nicknameDraft)
      if (token && refreshToken) await login(token, refreshToken, currentUser)
      setNicknameEditing(false)
      return true
    } catch {
      Alert.alert('', t('profile_nickname_save_failed'))
      return false
    } finally {
      setNicknameSaving(false)
    }
  }, [login, nicknameDraft, nicknameSaving, refreshToken, t, token])

  const confirmRevoke = (device: DeviceInfo) => {
    Alert.alert(t('device_revoke_confirm'), t('device_revoke_confirm_desc'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm'),
        style: 'destructive',
        onPress: () => handleRevoke(device.id),
      },
    ])
  }

  const handleLogout = () => {
    Alert.alert(t('logout'), '', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('logout'),
        style: 'destructive',
        onPress: () => {
          void doLogout()
        },
      },
    ])
  }

  const doLogout = async () => {
    const accountId = user?.id
    await logout()
    await clearAccountLocalData(accountId).catch(() => {})
    await clearProfileDevices(accountId)
    await clearMyProfileCache(accountId)
  }

  const performDeleteAccount = async () => {
    if (accountDeleting) return
    setAccountDeleting(true)
    const operationId = accountDeletionOperationId.current ?? Crypto.randomUUID()
    accountDeletionOperationId.current = operationId
    try {
      await profileAccountClient.deleteAccount(operationId)
    } catch {
      setAccountDeleting(false)
      setConfirmingDeleteAccount(false)
      Alert.alert('', t('account_delete_failed'))
      return
    }
    accountDeletionOperationId.current = null
    const accountId = user?.id
    await logout()
    await clearAccountLocalData(accountId).catch(() => {})
    await clearProfileDevices(accountId)
    await clearMyProfileCache(accountId)
    router.replace('/(auth)/login')
  }

  const requestDeleteAccount = () => {
    Alert.alert(t('account_delete'), t('account_delete_warning'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm'),
        onPress: () => {
          Alert.alert(t('account_delete'), t('account_delete_confirm'), [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('account_delete'),
              style: 'destructive',
              onPress: () => {
                void performDeleteAccount()
              },
            },
          ])
        },
      },
    ])
  }

  const handleToggleVersion = useCallback(() => {
    const nextOpen = !versionOpen
    setVersionOpen(nextOpen)
    if (nextOpen && appUpdate.status === 'idle') {
      void appUpdate.check()
    }
  }, [appUpdate, versionOpen])

  const handleOpenNativeUpdate = useCallback(() => {
    if (Platform.OS !== 'android') return
    void Linking.openURL(getMobileAppDownloadUrl('android')).catch(() => {
      Alert.alert('', t('app_update_open_failed'))
    })
  }, [t])

  const manageAiDataConsent = useCallback(() => {
    Alert.alert(t('ai_consent_settings_title'), t('ai_consent_settings_body'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('ai_consent_privacy'),
        onPress: () => { void Linking.openURL(`${PUBLIC_SITE_URL}/privacy`) },
      },
      {
        text: t('ai_consent_revoke'),
        style: 'destructive',
        onPress: () => {
          void revokeAiDataConsents(user?.id ?? '').then(() => {
            Alert.alert('', t('ai_consent_revoked'))
          })
        },
      },
    ])
  }, [t, user?.id])

  const badgeGreen = isDark
    ? { bg: '#052e16', text: '#4ade80' }
    : { bg: '#dcfce7', text: '#15803d' }

  const ds = useMemo(
    () => ({
      container: { backgroundColor: colors.bg },
      header: {
        backgroundColor: colors.bg,
        borderBottomColor: colors.border,
      },
      headerTitle: { color: colors.text },
      card: { backgroundColor: colors.surface, borderColor: colors.border },
      settingsGroup: { backgroundColor: colors.groupedSurface },
      rowLabel: { color: colors.text },
      rowValue: { color: Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary },
      deviceRow: { borderTopColor: colors.groupedSeparator },
      deviceName: { color: colors.text },
      deviceTime: { color: Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary },
      revokeText: { color: Platform.OS === 'web' ? colors.error : colors.errorText },
      logoutText: { color: Platform.OS === 'web' ? colors.error : colors.errorText },
      deleteAccountText: { color: Platform.OS === 'web' ? colors.error : colors.errorText },
      neutralBadge: {
        backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.14)',
      },
      onlineBadge: { backgroundColor: badgeGreen.bg },
      onlineText: { color: badgeGreen.text },
      currentBadge: { backgroundColor: badgeGreen.bg },
      currentText: { color: badgeGreen.text },
    }),
    [colors, badgeGreen],
  )

  const accountCard = (
    <ProfileAccountCard
      devicesPanel={<ProfileDevicesCard
        colors={colors}
        confirmRevoke={confirmRevoke}
        devices={devices}
        devicesLoaded={devicesLoaded}
        devicesLoading={devicesLoading}
        devicesFailed={devicesFailed}
        devicesOpen={mode === 'devices' && devicesOpen}
        ds={ds}
        embedded
        handleToggleDevices={mode === 'account'
          ? () => router.navigate('/(main)/login-devices')
          : handleToggleDevices}
        retryDevices={loadDevices}
        iconColor={colors.textSecondary}
        relativeTime={relativeTime}
        revoking={revoking}
        t={t}
      />}
      accountOpen={accountOpen}
      standalone={mode === 'account'}
      accountDeleting={accountDeleting}
      phone={user?.phone}
      colors={colors}
      iconColor={colors.textSecondary}
      confirmingDeleteAccount={confirmingDeleteAccount}
      confirmingLogout={confirmingLogout}
      ds={ds}
      onConfirmDeleteAccount={() => {
        void performDeleteAccount()
      }}
      onConfirmLogout={doLogout}
      onRequestDeleteAccount={requestDeleteAccount}
      onRequestLogout={handleLogout}
      onToggleOpen={() => {
        if (mode === 'root') router.navigate('/(main)/account-settings')
        else setAccountOpen((value) => !value)
        setConfirmingDeleteAccount(false)
        setConfirmingLogout(false)
      }}
      setConfirmingDeleteAccount={setConfirmingDeleteAccount}
      setConfirmingLogout={setConfirmingLogout}
      t={t}
    />
  )

  if (mode === 'account') {
    return <SafeAreaView style={[styles.container, ds.container]} edges={['top']}>
      <AppPageHeader title={t('mobile_account_security')} onBack={() => router.back()} />
      <ScrollView style={[styles.scrollView, { backgroundColor: isDark ? colors.bg : colors.surfaceHover }]}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings_account_section')}</Text>
        {accountCard}
      </ScrollView>
    </SafeAreaView>
  }

  if (mode === 'devices') {
    const renderDevice = (device: DeviceInfo, index: number) => <View key={device.id}
      style={[styles.deviceRow, { marginLeft: 0, paddingLeft: 16,
        borderTopWidth: index ? StyleSheet.hairlineWidth : 0, minHeight: 70 }, ds.deviceRow]}>
      <Ionicons name={platformIconName(device.platform)} size={24} color={colors.textSecondary} />
      <View style={styles.deviceInfo}>
        <View style={styles.deviceNameRow}>
          <Text style={[styles.deviceName, ds.deviceName]} numberOfLines={1}>{displayDeviceName(device, t)}</Text>
          {device.current ? <View style={[styles.currentBadge, ds.currentBadge]}>
            <Text style={[styles.currentText, ds.currentText]}>{t('device_current')}</Text>
          </View> : null}
        </View>
        <Text style={[styles.deviceTime, ds.deviceTime]}>{relativeTime(device.lastActiveAt)}</Text>
      </View>
      {!device.current ? <Pressable onPress={() => confirmRevoke(device)} disabled={revoking === device.id}
        accessibilityRole="button" style={styles.revokeBtn}>
        {revoking === device.id ? <ActivityIndicator color={colors.error} />
          : <Text style={[styles.revokeText, ds.revokeText]}>{t('device_revoke')}</Text>}
      </Pressable> : null}
    </View>
    const currentDevices = devices.filter((device) => device.current)
    const otherDevices = devices.filter((device) => !device.current)
    return <SafeAreaView style={[styles.container, ds.container]} edges={['top']}>
      <AppPageHeader title={t('devices_title')} onBack={() => router.back()} />
      <ScrollView style={[styles.scrollView, { backgroundColor: isDark ? colors.bg : colors.surfaceHover }]}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('mobile_login_devices_hint', { count: devices.length })}</Text>
        {devicesLoading && !devicesLoaded ? <ActivityIndicator color={colors.brand} /> : devicesFailed ?
          <Pressable onPress={() => void loadDevices()}><Text style={{ color: colors.error }}>{t('account_security_load_failed')}</Text>
            <Text style={{ color: colors.brand }}>{t('retry')}</Text></Pressable> : <>
          {currentDevices.length ? <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('mobile_current_device')}</Text>
            <View style={[styles.settingsGroup, ds.settingsGroup]}>{currentDevices.map(renderDevice)}</View>
          </> : null}
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('mobile_other_devices')}</Text>
          <View style={[styles.settingsGroup, ds.settingsGroup]}>
            {otherDevices.length ? otherDevices.map(renderDevice)
              : <Text style={{ color: colors.textSecondary, padding: 18 }}>{t('devices_empty_hint')}</Text>}
          </View>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('mobile_other_devices_hint')}</Text>
        </>}
      </ScrollView>
    </SafeAreaView>
  }

  return (
    <SafeAreaView style={[styles.container, ds.container]} edges={['top']}>
      <AppPageHeader
        title={t('settings')}
        onBack={moduleBack}
        showsConnectivityStatus
        trailing={
          <HeaderIconButton
            icon="scan-outline"
            label={t('scan_code')}
            onPress={() => router.navigate('/(main)/scan')}
            testID="profile-scan-action"
          />
        }
      />

      <ScrollView
        testID="profile-scroll-view"
        // The nickname Modal is still a descendant in the responder tree.
        // Let its buttons receive the first tap while the keyboard is open.
        keyboardShouldPersistTaps="handled"
        style={[styles.scrollView, { backgroundColor: isDark ? colors.bg : colors.surfaceHover }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.section, mode === 'root' && styles.rootSection]}>
          <ProfileAccountDataStateNotice state={accountDataState} retry={loadDevices} />
          <View style={[styles.identityGroup, ds.settingsGroup]}>
            <ProfileIdentityCard
              nickname={user?.name ?? ''}
              nicknameDraft={nicknameDraft}
              nicknameEditing={nicknameEditing}
              nicknameSaving={nicknameSaving}
              colors={colors}
              onCancelNicknameEdit={handleCancelNicknameEdit}
              onChangeNicknameDraft={setNicknameDraft}
              onSaveNickname={handleSaveNickname}
              onStartNicknameEdit={handleStartNicknameEdit}
              onOpenProfile={() => router.navigate('/(main)/personal-profile')}
              introduction={introduction}
              t={t}
            />
          </View>
          <View style={[styles.settingsGroup, ds.settingsGroup]}>
            <Pressable
              testID="settings-general"
              accessibilityRole="button"
              style={styles.row}
              onPress={() => router.navigate('/(main)/general-settings')}
            >
              <Ionicons name="options-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.rowLabel, ds.rowLabel]}>{t('settings_general')}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>

          <View style={[styles.settingsGroup, ds.settingsGroup]}>
            <Pressable
              testID="settings-machines"
              accessibilityRole="button"
              style={styles.row}
              onPress={() => router.push({ pathname: '/(main)/machines', params: { __mobileEntry: 'push' } })}
            >
              <Ionicons name="desktop-outline" size={20} color={colors.textSecondary} />
              <RowLabelWithDot colors={colors} showDot={settingsBadges.machines}>
                {t('mobile_my_computers')}
              </RowLabelWithDot>
              {settingsBadges.machines ? (
                <Text style={[styles.rowValue, styles.rowSummary, { color: colors.warningText }]}>
                  {t('machine_cli_update_available_short')}
                </Text>
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>

          <ProfileContactGroup>
            <Pressable
              testID="settings-ai-data-consent"
              accessibilityRole="button"
              style={styles.row}
              onPress={manageAiDataConsent}
            >
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.rowLabel, ds.rowLabel]}>{t('ai_consent_settings_title')}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          </ProfileContactGroup>

          <View style={[styles.settingsGroup, ds.settingsGroup]}>
            <Pressable
              testID="settings-version"
              accessibilityRole="button"
              accessibilityState={{ expanded: versionOpen }}
              style={[styles.subRow, { borderTopColor: colors.groupedSeparator }]}
              onPress={handleToggleVersion}
            >
              <Ionicons name="arrow-down-circle-outline" size={23} color={colors.textSecondary} />
              <RowLabelWithDot colors={colors} showDot={settingsBadges.ota}>
                {t('app_version')}
              </RowLabelWithDot>
              <Text
                style={[
                  styles.rowValue,
                  styles.rowSummary,
                  ds.rowValue,
                  appUpdate.hasUpdateBadge && { color: colors.warningText },
                ]}
              >
                {appUpdate.rowValueLabel}
              </Text>
              <Ionicons
                name={versionOpen ? 'chevron-up-outline' : 'chevron-forward'}
                size={16}
                color={colors.textTertiary}
              />
            </Pressable>
            {versionOpen && (
              <View style={[styles.versionDetails, { borderTopColor: colors.groupedSeparator }]}>
                <View style={styles.versionActions}>
                  <VersionActionButton
                    label={appUpdate.checking ? t('app_update_checking') : t('app_update_check')}
                    disabled={appUpdate.checking || appUpdate.downloading}
                    onPress={() => void appUpdate.check()}
                    colors={colors}
                  />
                  {(appUpdate.nativeUpdateAvailable || appUpdate.nativeUpdateRequired) && (
                    <VersionActionButton
                      label={t('app_update_download_android')}
                      primary
                      onPress={handleOpenNativeUpdate}
                      colors={colors}
                    />
                  )}
                  {appUpdate.status === 'downloaded' && (
                    <VersionActionButton
                      label={t('app_update_restart')}
                      primary
                      onPress={() => void appUpdate.restart()}
                      colors={colors}
                    />
                  )}
                </View>
                    <Text style={[styles.versionMessage, { color: colors.textSecondary }]}>
                      {appUpdate.message}
                    </Text>
                  </View>
                )}
          </View>

          {accountCard}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function RowLabelWithDot({
  children,
  colors,
  showDot,
}: {
  children: React.ReactNode
  colors: ReturnType<typeof useTheme>['colors']
  showDot: boolean
}) {
  return (
    <View style={styles.rowLabelWithDot}>
      <Text style={[styles.rowLabelInline, { color: colors.text }]}>{children}</Text>
      {showDot ? <View style={[styles.rowUpdateDot, { backgroundColor: colors.error }]} /> : null}
    </View>
  )
}
