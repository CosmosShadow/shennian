// @arch docs/features/desktop-settings-information-architecture.md
// @test src/__tests__/desktop-settings-shell.test.ts

import { useState, type ReactNode, type RefObject } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import type { useTheme } from '../../hooks/useTheme'
import type { useDesktopUpdateState } from '../desktop-control/hooks/useDesktopUpdateState'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { DesktopSettingsShell } from './DesktopSettingsShell'
import { DesktopGeneralSettings } from './DesktopGeneralSettings'
import { VersionActionButton } from './versionPresentation'
import { DesktopNotificationSystemSettings, DesktopShortcutSettings } from './DesktopSystemSettings'
import type { DesktopSystemSettingsSnapshot } from '../desktop-control/types'
import { DesktopSwitch } from '../desktop-shell/DesktopSwitch'
import { DesktopVersionSettings } from './DesktopVersionSettings'

type Colors = ReturnType<typeof useTheme>['colors']
type DesktopUpdate = ReturnType<typeof useDesktopUpdateState>

type Props = {
  logoutTriggerRef?: RefObject<View | null>
  onLogout: () => void
  onBack: () => void
  onEscape: () => void
  onRequestCategoryChange: (change: () => void) => void
  colors: Colors
  currentTheme: 'light' | 'dark' | 'system'
  currentLanguage: 'zh' | 'en'
  onSelectTheme: (theme: 'light' | 'dark' | 'system') => void
  onSelectLanguage: (language: 'zh' | 'en') => void
  identity: ReactNode
  account: ReactNode
  devices: ReactNode
  machines: ReactNode
  notifications: {
    available: boolean
    enabled: boolean | null
    showBody: boolean | null
    loading: boolean
    onChange: (enabled: boolean) => void
    onChangeBody: (showBody: boolean) => void
    error?: string | null
    onRetry?: () => void
  }
  systemSettings: {
    snapshot: DesktopSystemSettingsSnapshot | null
    loading: boolean
    error: string | null
    onRefresh: () => void
    onOpenNotificationSettings: () => void
    onOpenMicrophoneSettings: () => void
  }
  logs: {
    available: boolean
    exporting: boolean
    canReveal: boolean
    onExport: () => void
    onReveal: () => void
  }
  version: {
    label: string
    badge: boolean
    warning: boolean
    updateMessage: string
    desktopUpdate: DesktopUpdate
    restartImpactMessage: string
    showRestartConfirmation: boolean
    onInstallLater: () => void
    onRequestRestart: () => void
    onConfirmRestart: () => void
  }
}

export function DesktopProfileSettings({
  logoutTriggerRef,
  onLogout,
  onBack,
  onEscape,
  onRequestCategoryChange,
  colors,
  currentTheme,
  currentLanguage,
  onSelectTheme,
  onSelectLanguage,
  identity,
  account,
  devices,
  machines,
  notifications,
  systemSettings,
  logs,
  version,
}: Props) {
  const { t } = useTranslation()
  const notificationPermission = systemSettings.snapshot?.notification
  const [showDevices, setShowDevices] = useState(false)
  const groupStyle = [
    styles.settingsGroup,
    styles.card,
    { backgroundColor: colors.bg, borderColor: colors.border },
  ]

  return (
    <DesktopSettingsShell logoutTriggerRef={logoutTriggerRef}
      onLogout={() => { setShowDevices(false); onLogout() }}
      onBack={showDevices ? () => setShowDevices(false) : onBack}
      onEscape={onEscape}
      onRequestCategoryChange={change => onRequestCategoryChange(() => { setShowDevices(false); change() })}
      sections={{
        account: (
          <>
            {showDevices ? <><Pressable accessibilityRole="button" onPress={() => setShowDevices(false)} style={styles.row}><Text style={{color: colors.text}}>{t('back')}</Text></Pressable>{devices}</> : <>
              <View style={[styles.identityGroup, ...groupStyle]}>{identity}</View>
              <Pressable accessibilityRole="button" onPress={() => setShowDevices(true)} style={styles.row}>
                <Text style={[styles.rowLabel, {color: colors.text}]}>{t('desktop_settings_devices')}</Text><Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </Pressable>
              {account}
            </>}
          </>
        ),
        machines,
        general: (
          <View style={{ gap: 16 }}>
            <DesktopGeneralSettings
              colors={colors}
              currentTheme={currentTheme}
              currentLanguage={currentLanguage}
              onSelectTheme={onSelectTheme}
              onSelectLanguage={onSelectLanguage}
            />
            <View style={groupStyle}>
              {notifications.available &&
              notifications.loading &&
              notifications.enabled === null ? (
                <ActivityIndicator color={colors.brand} />
              ) : null}
              {notifications.error ? (
                <View>
                  <Text
                    accessibilityRole="alert"
                    style={[desktopTypography.body, { color: colors.errorText, padding: 16 }]}
                  >
                    {notifications.error}
                  </Text>
                  {notifications.onRetry ? (
                    <VersionActionButton
                      label={t('retry')}
                      colors={colors}
                      onPress={notifications.onRetry}
                    />
                  ) : null}
                </View>
              ) : null}
              {notifications.available && notifications.enabled !== null ? (
                <View style={styles.row}>
                  <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
                  <Text style={[styles.rowLabel, { color: colors.text }]}>
                    {t('desktop_notifications_title')}
                  </Text>
                  <Text style={[styles.rowValue, { color: colors.textSecondary }]}>
                    {notificationPermission && notificationPermission.status !== 'granted' ? t(`desktop_permission_${notificationPermission.status.replace('-', '_')}`) : t(notifications.enabled ? 'enabled' : 'disabled')}
                  </Text>
                  {notificationPermission?.canOpenSettings && notificationPermission.status !== 'granted' ? <VersionActionButton label={t('desktop_permission_open_settings')} colors={colors} onPress={systemSettings.onOpenNotificationSettings} /> : null}
                  <DesktopSwitch
                    testID="desktop-notifications-toggle"
                    accessibilityLabel={t('desktop_notifications_title')}
                    disabled={notifications.loading}
                    value={notifications.enabled}
                    onValueChange={notifications.onChange}
                  />
                </View>
              ) : null}
              <DesktopNotificationSystemSettings colors={colors} {...systemSettings}
                onRefresh={systemSettings.onRefresh}
                onOpenNotificationSettings={systemSettings.onOpenNotificationSettings}
                onOpenMicrophoneSettings={systemSettings.onOpenMicrophoneSettings} />
              {logs.available ? (
                <>
                  <Pressable
                    testID="desktop-settings-export-log"
                    style={
                      notifications.available
                        ? [styles.subRow, { borderTopColor: colors.border }]
                        : styles.row
                    }
                    disabled={logs.exporting}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: logs.exporting }}
                    onPress={logs.onExport}
                  >
                    <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
                    <Text style={[styles.rowLabel, { color: colors.text }]}>
                      {t('desktop_local_export_log')}
                    </Text>
                    <Ionicons name="download-outline" size={18} color={colors.textSecondary} />
                  </Pressable>
                  {logs.canReveal ? (
                    <Pressable
                      testID="desktop-settings-reveal-log"
                      style={[styles.subRow, { borderTopColor: colors.border }]}
                      accessibilityRole="button"
                      onPress={logs.onReveal}
                    >
                      <Ionicons name="folder-open-outline" size={20} color={colors.textSecondary} />
                      <Text style={[styles.rowLabel, { color: colors.text }]}>
                        {t('desktop_show_in_folder')}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
        ),
        shortcuts: systemSettings.snapshot ? (
          <DesktopShortcutSettings colors={colors} shortcuts={systemSettings.snapshot.shortcuts} />
        ) : (
          <View style={[styles.shortcutState, ...groupStyle]}>
            {systemSettings.loading ? <ActivityIndicator color={colors.brand} /> : null}
            {systemSettings.error ? (
              <Text
                accessibilityRole="alert"
                style={[desktopTypography.body, { color: colors.errorText }]}
              >
                {systemSettings.error}
              </Text>
            ) : null}
            {!systemSettings.loading ? (
              <VersionActionButton
                label={t('desktop_permission_refresh')}
                colors={colors}
                onPress={systemSettings.onRefresh}
              />
            ) : null}
          </View>
        ),
        version: <DesktopVersionSettings colors={colors} {...version} />,
      }}
    />
  )
}

// Desktop settings do not inherit the mobile profile's 16/15px rows or
// right-aligned value style for explanatory paragraphs.
const styles = StyleSheet.create({
  identityGroup: { paddingHorizontal: 20, paddingVertical: 14 },
  settingsGroup: { overflow: 'hidden' },
  card: {
    borderRadius: desktopControlMetrics.radiusContainer,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  subRow: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { ...desktopTypography.body, flex: 1, minWidth: 0 },
  rowValue: { ...desktopTypography.metadata, minWidth: 0, flexShrink: 1, textAlign: 'right' },
  description: { ...desktopTypography.metadata, marginTop: 4, textAlign: 'left' },
  shortcutState: { minHeight: 88, padding: 16, alignItems: 'flex-start', gap: 10 },
})
