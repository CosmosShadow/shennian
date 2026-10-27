// @arch docs/design/project-coordination-ios.md
// @test src/__tests__/project-coordination.test.ts
import type { ReactNode } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import type { CoordinationSnapshot } from './client'

function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const { colors } = useTheme()
  return <View style={styles.group}>
    {title ? <Text style={[styles.caption, mobileTypography.metadata, { color: colors.textMuted }]}>{title}</Text> : null}
    <View style={[styles.card, { backgroundColor: colors.groupedSurface ?? colors.bg }]}>{children}</View>
    {footer ? <Text style={[styles.caption, mobileTypography.metadata, { color: colors.textMuted }]}>{footer}</Text> : null}
  </View>
}

function Row({ label, value, onPress, children, last = false, disabled = false }: { label: string; value?: string; onPress?: () => void; children?: ReactNode; last?: boolean; disabled?: boolean }) {
  const { colors } = useTheme()
  const content = <>
    <Text style={[mobileTypography.body, styles.label, { color: colors.text, flex: value ? undefined : 1 }]}>{label}</Text>
    {value ? <Text numberOfLines={1} style={[mobileTypography.secondary, styles.value, { color: colors.textMuted }]}>{value}</Text> : null}
    {children}
    {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary ?? colors.textMuted} /> : null}
  </>
  const rowStyle = [styles.row, { borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.groupedSeparator ?? colors.border, opacity: disabled ? 0.45 : 1 }]
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [rowStyle, pressed && { backgroundColor: colors.surfaceHover }]}>{content}</Pressable>
    : <View style={rowStyle}>{content}</View>
}

export function ProjectCoordinationSettings({ state, unavailable, loading = false, status, onConfigure, onInstructions, onRecent }: {
  state: CoordinationSnapshot | null; unavailable: boolean; loading?: boolean; status: string
  onConfigure: (patch: Record<string, unknown>) => void; onInstructions: () => void; onRecent: () => void
}) {
  const { colors } = useTheme(), { t } = useTranslation()
  const accent = colors.navigationSelected ?? colors.brand
  const chooseMode = () => Alert.alert(t('coordination_mode'), t('coordination_mode_hint'), [
    ...(['serial', 'research_parallel', 'parallel'] as const).map(mode => ({ text: `${state?.mode === mode ? '✓ ' : ''}${t(`coordination_${mode}`)}`, onPress: () => onConfigure({ mode }) })),
    { text: t('cancel'), style: 'cancel' },
  ])
  return <View style={styles.content}>
    <Group footer={state && !state.enabled ? t('coordination_enable_hint') : undefined}>
      <Row label={t('coordination_title')}>
        {loading ? <ActivityIndicator accessibilityLabel={t('coordination_connecting')} testID="coordination-enabled-loading" color={colors.textMuted} /> : <Switch accessibilityLabel={t('coordination_enabled')} disabled={unavailable} value={Boolean(state?.enabled)} onValueChange={enabled => {
          if (!enabled) Alert.alert(t('coordination_disable_title'), t('coordination_disable_hint'), [{ text: t('cancel'), style: 'cancel' }, { text: t('confirm'), onPress: () => onConfigure({ enabled: false }) }])
          else onConfigure({ enabled: true })
        }} />}
      </Row>
      <Row label={t('coordination_current_status')} last value={status} />
    </Group>
    {state?.enabled ? <Group footer={t('coordination_pause_hint')}>
      <Pressable accessibilityRole="button" style={styles.action} disabled={unavailable} onPress={() => onConfigure({ paused: !state.paused })}>
        <Text style={[mobileTypography.body, { color: accent }]}>{t(state.paused ? 'coordination_resume' : 'coordination_pause')}</Text>
      </Pressable>
    </Group> : null}
    <Group title={t('coordination_execution')}>
      <Row label={t('coordination_mode')} value={state ? t(`coordination_${state.mode}`) : '—'} onPress={chooseMode} disabled={unavailable} />
      <Row label={t('coordination_next_task')} last value={state ? t(state.automatic ? 'coordination_auto' : 'coordination_manual') : '—'} disabled={unavailable}
        onPress={() => Alert.alert(t('coordination_next_task'), '', [
          { text: t('coordination_auto'), onPress: () => onConfigure({ automatic: true }) },
          { text: t('coordination_manual'), onPress: () => onConfigure({ automatic: false }) },
          { text: t('cancel'), style: 'cancel' },
        ])} />
    </Group>
    <Group title={t('coordination_work_style')} footer={t('coordination_model_hint')}>
      <Row label={t('coordination_instructions')} value={t('coordination_view_edit')} onPress={onInstructions} disabled={unavailable} />
      <Row label={t('coordination_recent')} last onPress={onRecent} disabled={unavailable} />
    </Group>
  </View>
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 24, gap: 24 },
  group: { gap: 8 }, card: { borderRadius: 12, overflow: 'hidden' },
  caption: { paddingHorizontal: 16, lineHeight: 19 },
  row: { minHeight: 56, marginLeft: 16, paddingRight: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { flexShrink: 0 }, value: { flex: 1, textAlign: 'right', minWidth: 0 },
  action: { minHeight: 56, paddingHorizontal: 16, justifyContent: 'center' },
})
