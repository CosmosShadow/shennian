// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-machine-list-projection.test.ts

import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import type { MachineListSurfaceState } from '../machines/services/machineListState'

export function DesktopMachineListState({ state, compact, onRetry }: {
  state: Extract<MachineListSurfaceState, 'initial-loading' | 'offline' | 'forbidden' | 'error'>
  compact: boolean
  onRetry(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [retryFocused, setRetryFocused] = useState(false)
  if (state === 'initial-loading') return <View testID="desktop-machines-loading" accessibilityRole="progressbar"
    accessibilityLabel={t('machines_loading')} style={[styles.panel, compact && styles.compact]}>
    <ActivityIndicator color={colors.brand} />
    <Text style={[styles.body, { color: colors.textSecondary }]}>{t('machines_loading')}</Text>
  </View>

  const forbidden = state === 'forbidden'
  const offline = state === 'offline'
  const title = t(forbidden ? 'machines_permission_title' : offline
    ? compact ? 'machines_cached_offline_title' : 'machines_offline_title'
    : 'machines_load_failed_title')
  const body = t(forbidden ? 'machines_permission_body' : offline
    ? compact ? 'machines_cached_offline_body' : 'machines_offline_body'
    : compact ? 'machines_cached_load_failed_body' : 'machines_load_failed_body')
  return <View testID={`desktop-machines-${state}`} accessibilityRole={state === 'error' ? 'alert' : undefined}
    style={[styles.panel, compact && styles.compact, { borderColor: colors.border, backgroundColor: colors.surface }]}>
    <Ionicons name={forbidden ? 'lock-closed-outline' : offline ? 'cloud-offline-outline' : 'warning-outline'}
      size={20} color={forbidden || state === 'error' ? colors.error : colors.textTertiary} />
    <View style={styles.copy}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
    </View>
    {!forbidden ? <Pressable accessibilityRole="button" accessibilityLabel={t('retry')} onPress={onRetry}
      onFocus={() => setRetryFocused(true)} onBlur={() => setRetryFocused(false)}
      style={({ pressed }) => [styles.retry, { backgroundColor: pressed ? colors.surfaceHover : colors.bg, borderColor: retryFocused ? colors.brand : colors.border }]}>
      <Text style={[styles.retryText, { color: colors.brand }]}>{t('retry')}</Text>
    </Pressable> : null}
  </View>
}

const styles = StyleSheet.create({
  panel: { minHeight: 132, borderWidth: 1, borderRadius: 10, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 8 },
  compact: { minHeight: 64, flexDirection: 'row', justifyContent: 'flex-start', paddingVertical: 10 },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  retry: { minWidth: 64, minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center' },
  retryText: { fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
})
