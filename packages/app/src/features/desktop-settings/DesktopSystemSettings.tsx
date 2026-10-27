// @arch docs/features/desktop-settings-information-architecture.md
// @test ../../__tests__/desktop-system-settings-ui.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { useTheme } from '../../hooks/useTheme'
import type { DesktopSystemSettingsSnapshot } from '../desktop-control/types'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

type Colors = ReturnType<typeof useTheme>['colors']

export function DesktopNotificationSystemSettings({
  colors,
  snapshot,
  loading,
  error,
  onRefresh,
  onOpenMicrophoneSettings,
}: {
  colors: Colors
  snapshot: DesktopSystemSettingsSnapshot | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onOpenNotificationSettings: () => void
  onOpenMicrophoneSettings: () => void
}) {
  const { t } = useTranslation()
  const microphone = snapshot?.microphone
  return (
    <View>
      <View style={[localStyles.row, { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
        <Ionicons name="mic-outline" size={20} color={colors.textSecondary} />
        <View style={localStyles.copy}>
          <Text style={[localStyles.label, { color: colors.text }]}>
            {t('desktop_system_microphone_permission')}
          </Text>
        </View>
        {loading && !microphone ? <ActivityIndicator color={colors.brand} /> : null}
        {microphone ? (
          <Text
            testID="desktop-microphone-permission-status"
            style={{ color: statusColor(microphone.status, colors) }}
          >
            {t(`desktop_permission_${microphone.status.replace('-', '_')}`)}
          </Text>
        ) : null}
        {microphone?.canOpenSettings && microphone.status !== 'granted' ? (
          <ActionButton
            testID="desktop-microphone-open-settings"
            label={t('desktop_permission_open_settings')}
            colors={colors}
            onPress={onOpenMicrophoneSettings}
          />
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[localStyles.error, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}

      {error ? <ActionButton label={t('retry')} colors={colors} onPress={onRefresh} /> : null}

    </View>
  )
}

export function DesktopShortcutSettings({
  colors,
  shortcuts,
}: {
  colors: Colors
  shortcuts: DesktopSystemSettingsSnapshot['shortcuts']
}) {
  const { t } = useTranslation()
  const interactionShortcuts = [
    { id: 'send-message', accelerator: 'Enter', status: 'available' as const },
    { id: 'new-line', accelerator: 'Shift+Enter', status: 'available' as const },
    { id: 'close-panel', accelerator: 'Esc', status: 'available' as const },
    { id: 'context-menu', accelerator: 'Shift+F10', status: 'available' as const },
  ]
  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  const displayedShortcuts = [...interactionShortcuts, ...shortcuts].map(item => ({...item, accelerator: item.accelerator.replace(/CmdOrCtrl/g, mac ? '⌘' : 'Ctrl').replace(/Cmd/g, '⌘').replace(/Ctrl/g, mac ? '⌃' : 'Ctrl').replace(/Shift/g, mac ? '⇧' : 'Shift')}))
  return (
    <View accessibilityRole="list" style={[localStyles.group, { borderColor: colors.border }]}>
      {displayedShortcuts.map((shortcut, index) => (
        <View
          role="listitem"
          key={shortcut.id}
          testID={`desktop-shortcut-${shortcut.id}`}
          style={[
            localStyles.shortcutRow,
            index > 0 && {
              borderTopColor: colors.border,
              borderTopWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          <View style={localStyles.copy}>
            <Text style={[localStyles.label, { color: colors.text }]}>
              {t(`desktop_shortcut_${shortcut.id.split('-').join('_')}`)}
            </Text>
            {shortcut.status !== 'available' ? (
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {t(`desktop_shortcut_status_${shortcut.status}`)}
              </Text>
            ) : null}
          </View>
          <Text
            accessibilityLabel={`${t(`desktop_shortcut_${shortcut.id.split('-').join('_')}`)}: ${shortcut.accelerator}`}
            style={[
              localStyles.key,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.surfaceHover,
              },
            ]}
          >
            {shortcut.accelerator}
          </Text>
        </View>
      ))}
    </View>
  )
}

function ActionButton({
  testID,
  label,
  colors,
  disabled = false,
  onPress,
}: {
  testID?: string
  label: string
  colors: Colors
  disabled?: boolean
  onPress: () => void
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={event => setFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        localStyles.button,
        {
          borderColor: focused ? colors.brand : colors.border,
          borderWidth: focused ? 2 : StyleSheet.hairlineWidth,
        },
        pressed && { backgroundColor: colors.surfaceHover },
      ]}
    >
      <Text style={{ color: disabled ? colors.textTertiary : colors.brand }}>{label}</Text>
    </Pressable>
  )
}

function statusColor(
  status: DesktopSystemSettingsSnapshot['notification']['status'],
  colors: Colors,
) {
  if (status === 'granted') return colors.success
  if (status === 'denied' || status === 'unsupported') return colors.error
  return colors.textSecondary
}

const localStyles = StyleSheet.create({
  group: {
    width: '100%',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: desktopControlMetrics.radiusContainer,
  },
  row: { minHeight: 68, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  shortcutRow: {
    minHeight: 64,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  label: { ...desktopTypography.body, fontWeight: '500' },
  description: desktopTypography.metadata,
  error: { ...desktopTypography.body, paddingHorizontal: 20, paddingBottom: 12 },
  actions: {
    minHeight: 56,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  key: {
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: 'monospace',
  },
})
