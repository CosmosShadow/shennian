// @arch docs/features/desktop-page-state-matrix.md#machine-list-closure
// @test src/__tests__/machine-list-state.test.ts

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import type { MachineListSurfaceState } from '../services/machineListState'

export function MachineListStateNotice({
  state,
  compact,
  onRetry,
}: {
  state: Extract<
    MachineListSurfaceState,
    'initial-loading' | 'offline' | 'forbidden' | 'error'
  >
  compact: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  if (state === 'initial-loading') {
    return (
      <View
        testID="machine-list-initial-loading"
        accessibilityRole="progressbar"
        accessibilityLabel={t('machines_loading')}
        style={[styles.notice, compact && styles.compact]}
      >
        <ActivityIndicator color={colors.brand} />
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t('machines_loading')}</Text>
      </View>
    )
  }

  const forbidden = state === 'forbidden'
  const offline = state === 'offline'
  const titleKey = forbidden
    ? 'machines_permission_title'
    : offline
      ? compact
        ? 'machines_cached_offline_title'
        : 'machines_offline_title'
      : 'machines_load_failed_title'
  const bodyKey = forbidden
    ? 'machines_permission_body'
    : offline
      ? compact
        ? 'machines_cached_offline_body'
        : 'machines_offline_body'
      : compact
        ? 'machines_cached_load_failed_body'
        : 'machines_load_failed_body'

  return (
    <View
      testID={`machine-list-${state}`}
      accessibilityRole={state === 'error' ? 'alert' : undefined}
      style={[
        styles.notice,
        compact && styles.compact,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Ionicons
        name={forbidden ? 'lock-closed-outline' : offline ? 'cloud-offline-outline' : 'warning-outline'}
        size={compact ? 20 : 28}
        color={forbidden || state === 'error' ? colors.error : colors.textTertiary}
      />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{t(titleKey)}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t(bodyKey)}</Text>
      </View>
      {!forbidden ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('retry')}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retry,
            { backgroundColor: colors.surfaceHover, opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <Text style={[styles.retryText, { color: colors.brand }]}>{t('retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  notice: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  compact: {
    minHeight: 0,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingVertical: 12,
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { minHeight: 44, minWidth: 64, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center' },
  retryText: { fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
})
