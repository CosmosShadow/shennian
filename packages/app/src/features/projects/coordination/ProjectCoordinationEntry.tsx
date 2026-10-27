// @arch docs/design/project-coordination-ios.md
// @test src/__tests__/project-coordination.test.ts
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { coordinationCounts, pendingCoordinationQuestions, type CoordinationFilter, type CoordinationSnapshot } from './client'
export function ProjectCoordinationEntry({ state, unavailable = false, filter, onFilter, onOpen, counts }: {
  counts?: { running: number; queued: number; attention: number }; state: CoordinationSnapshot | null; unavailable?: boolean; filter: CoordinationFilter; onFilter: (filter: CoordinationFilter) => void; onOpen: () => void
}) {
  const { colors } = useTheme(), { t } = useTranslation()
  if (!state?.enabled) return null
  const { running, queued, attention } = counts ?? coordinationCounts(state)
  const accent = colors.navigationSelected ?? colors.brand
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={t('coordination_open')} onPress={onOpen}
      style={[styles.entry, { borderBottomColor: colors.border }]} testID="project-coordination-entry">
      <View style={[styles.icon, { backgroundColor: colors.ownMessage }]}><Ionicons name="chatbubbles-outline" size={22} color={accent} /></View>
      <View style={{ flex: 1, gap: 4 }}><Text style={[mobileTypography.sectionTitle, { color: colors.text }]}>{t('coordination_title')}</Text>
        <Text style={[mobileTypography.metadata, { color: colors.textMuted }]}>{state?.enabled ? t('coordination_summary', { running, queued }) : t(unavailable ? 'coordination_unavailable_short' : state ? 'coordination_disabled' : 'coordination_connecting')}</Text></View>
      <Text style={[mobileTypography.secondary, { color: accent }]}>{t(state?.enabled ? state.paused ? 'coordination_paused' : pendingCoordinationQuestions(state).length ? 'coordination_needs_answer_short' : state.managerBusy ? 'coordination_busy_short' : 'coordination_active' : 'coordination_settings')}</Text>
      <Ionicons name="chevron-forward" size={15} color={colors.textTertiary ?? colors.textMuted} />
    </Pressable>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }} contentContainerStyle={styles.filters}>
      {(['all', 'running', 'queued', 'attention'] as const).map(value => <Pressable key={value} accessibilityRole="tab"
        accessibilityState={{ selected: value === filter }} onPress={() => onFilter(value)} style={[styles.filter, { borderBottomColor: value === filter ? accent : 'transparent' }]}>
        <Text style={[mobileTypography.compactAction, { color: value === filter ? accent : colors.textMuted }]}>{t(`coordination_${value}`)}{({ running, queued, attention } as Record<string, number>)[value] ? ` ${({ running, queued, attention } as Record<string, number>)[value]}` : ''}</Text>
      </Pressable>)}
    </ScrollView>
  </View>
}
const styles = StyleSheet.create({ entry: { minHeight: 88, paddingHorizontal: 16, paddingVertical: 16, gap: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, icon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }, filters: { paddingHorizontal: 16, gap: 16, flexGrow: 1, justifyContent: 'space-between' }, filter: { minHeight: 48, paddingHorizontal: 3, justifyContent: 'center', borderBottomWidth: 2 } })
