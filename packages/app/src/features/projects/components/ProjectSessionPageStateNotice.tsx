// @arch docs/features/desktop-page-state-matrix.md#project-and-personal-session-closure
// @test src/__tests__/project-session-page-state.test.ts

import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import type { ProjectSessionPageSurfaceState } from '../services/projectSessionPageState'

export function ProjectSessionPageStateNotice({
  state,
  compact,
  onRetry,
  onRepair,
}: {
  state: ProjectSessionPageSurfaceState
  compact: boolean
  onRetry: () => void
  onRepair?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  if (state === 'ready') return null

  if (state === 'pending') {
    return (
      <View
        testID="project-sessions-pending"
        accessibilityLiveRegion="polite"
        style={[styles.notice, styles.unframed, compact && styles.compact]}
      >
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t('project_sessions_pending')}
        </Text>
      </View>
    )
  }

  const forbidden = state === 'forbidden'
  const offline = state === 'offline'
  const empty = state === 'empty'
  const titleKey = forbidden
    ? 'project_sessions_permission_title'
    : offline
      ? compact
        ? 'project_sessions_cached_offline_title'
        : 'project_sessions_offline_title'
      : empty
        ? 'project_sessions_empty_title'
        : 'project_sessions_load_failed_title'
  const bodyKey = forbidden
    ? 'project_sessions_permission_body'
    : offline
      ? compact
        ? 'project_sessions_cached_offline_body'
        : 'project_sessions_offline_body'
      : empty
        ? 'project_sessions_empty_body'
        : compact
          ? 'project_sessions_cached_load_failed_body'
          : 'project_sessions_load_failed_body'

  return (
    <View
      testID={`project-sessions-${state}`}
      accessibilityRole={state === 'error' ? 'alert' : undefined}
      style={[
        styles.notice,
        compact && styles.compact,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Ionicons
        name={
          forbidden
            ? 'lock-closed-outline'
            : offline
              ? 'cloud-offline-outline'
              : empty
                ? 'chatbubbles-outline'
                : 'warning-outline'
        }
        size={compact ? 20 : 28}
        color={forbidden || state === 'error' ? colors.error : colors.textTertiary}
      />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{t(titleKey)}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t(bodyKey)}</Text>
      </View>
      {forbidden && onRepair ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('start_new_project')}
          onPress={onRepair}
          style={({ pressed }) => [
            styles.retry,
            { backgroundColor: colors.surfaceHover, opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <Text style={[styles.retryText, { color: colors.brand }]}>
            {t('start_new_project')}
          </Text>
        </Pressable>
      ) : !forbidden && !empty ? (
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
    minHeight: 128,
    margin: 16,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  unframed: { borderWidth: 0, backgroundColor: 'transparent' },
  compact: {
    minHeight: 0,
    marginVertical: 8,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingVertical: 12,
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: {
    minHeight: 44,
    minWidth: 64,
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  retryText: { fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
})
