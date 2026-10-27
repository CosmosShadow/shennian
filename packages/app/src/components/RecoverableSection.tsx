// @arch docs/architecture/app/render-resilience.md
// @test src/__tests__/render-resilience.test.ts
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../hooks/useTheme'
import { reportLog } from '../config/log'
import { RenderErrorBoundary } from './RenderErrorBoundary'

type Scope = 'screen' | 'composer' | 'timeline' | 'header' | 'overlays' | 'message'
function RecoveryActions({ children, onLeave, autoLeaveAfterMs }: {
  children: (leave?: () => void) => ReactNode; onLeave?: () => void; autoLeaveAfterMs?: number
}) {
  const left = useRef(false)
  const leave = useCallback(() => {
    if (left.current) return
    left.current = true
    onLeave?.()
  }, [onLeave])
  useEffect(() => {
    if (!onLeave || autoLeaveAfterMs === undefined) return
    const timer = setTimeout(leave, autoLeaveAfterMs)
    return () => clearTimeout(timer)
  }, [autoLeaveAfterMs, leave, onLeave])
  return children(onLeave ? leave : undefined)
}

export function RecoverableSection({ children, scope, resetKey, resetToken, onLeave, fill = false, autoLeaveAfterMs }: {
  children?: ReactNode; scope: Scope; resetKey?: string; resetToken?: unknown; onLeave?: () => void; fill?: boolean; autoLeaveAfterMs?: number
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  return (
    <RenderErrorBoundary resetKey={resetKey} resetToken={resetToken} onError={() => {
      // No error.message, props, route params or user content in remote diagnostics.
      reportLog({ level: 'error', errorMessage: 'Local render failure', metadata: { scope } })
    }} fallback={(retry) => (
      <RecoveryActions onLeave={onLeave} autoLeaveAfterMs={autoLeaveAfterMs}>{(leave) => (
      <View testID={`render-fallback-${scope}`} style={[styles.card, fill && styles.fill,
        { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t('render_failure_title')}</Text>
        <Text style={{ color: colors.textSecondary }}>{t(autoLeaveAfterMs === undefined ? 'render_failure_body' : 'render_failure_auto_leave', { seconds: (autoLeaveAfterMs ?? 0) / 1000 })}</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
            <Text style={{ color: colors.brand }}>{t('render_failure_retry')}</Text>
          </Pressable>
          {leave ? <Pressable accessibilityRole="button" onPress={leave} style={styles.button}>
            <Text style={{ color: colors.brand }}>{t('render_failure_leave')}</Text>
          </Pressable> : null}
        </View>
      </View>
      )}</RecoveryActions>
    )}>{children}</RenderErrorBoundary>
  )
}
const styles = StyleSheet.create({
  card: { padding: 16, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  fill: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
})
