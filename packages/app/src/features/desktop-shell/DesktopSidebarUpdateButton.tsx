// @arch docs/architecture/desktop/unified-desktop.md#8-更新
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-sidebar-update-button.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import type { useDesktopUpdateState } from '../desktop-control/hooks/useDesktopUpdateState'
import { createDesktopSidebarUpdateAction, desktopSidebarUpdatePresentation } from './desktopSidebarUpdateModel'

export function DesktopSidebarUpdateButton({ update, onOpenUpdates }: {
  update: ReturnType<typeof useDesktopUpdateState>
  onOpenUpdates(): void
}) {
  const { colors } = useTheme(); const { t } = useTranslation()
  const [busy, setBusy] = useState(false), [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false)
  const latest = useRef({ update, onOpenUpdates, t }); latest.current = { update, onOpenUpdates, t }
  const action = useMemo(() => createDesktopSidebarUpdateAction({
    state: () => latest.current.update.state,
    download: () => latest.current.update.download(),
    openUpdates: () => latest.current.onOpenUpdates(),
    busy: setBusy,
    failed: () => Alert.alert(latest.current.t('desktop_settings_version_updates'), latest.current.t('desktop_sidebar_update_failed')),
  }), [])
  useEffect(() => { action.start(); return () => action.stop() }, [action])
  const model = desktopSidebarUpdatePresentation(update.state, busy)
  if (!model.visible) return null
  const label = t(model.label, { percent: model.percent })
  const inProgress = update.state?.status === 'downloading' || update.state?.status === 'verifying'
  return <Pressable testID="desktop-sidebar-update-button" accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: model.disabled, busy: busy || inProgress }}
    disabled={model.disabled} onPress={() => void action.press()} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => ({ width: '100%', minHeight: 36, paddingHorizontal: 10, gap: 8, flexDirection: 'row', alignItems: 'center',
      borderRadius: 8, borderWidth: 1, borderColor: focused ? colors.brand : 'transparent',
      backgroundColor: hovered || pressed ? colors.surfaceHover : 'transparent', opacity: model.disabled ? 0.7 : 1 })}>
    {busy || inProgress ? <ActivityIndicator size="small" color={colors.brand} /> : <Ionicons name={update.state?.status === 'downloaded' ? 'checkmark-circle-outline' : 'download-outline'} size={16} color={colors.brand} />}
    <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '500', color: colors.brand }}>{label}</Text>
  </Pressable>
}
