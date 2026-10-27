// @test src/__tests__/scheduled-tasks-presentation.test.ts
// @arch docs/design/scheduled-tasks-mobile.md
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { ConversationSchedule } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { schedulePromptPreview } from './schedulePresentation'

export function ScheduleTaskCard({
  task,
  time,
  machineName,
  disabled,
  onPress,
}: {
  task: ConversationSchedule
  time: string
  machineName?: string
  disabled: boolean
  onPress: () => void
}) {
  const { t } = useTranslation(),
    { colors, isDark } = useTheme()
  const { title, excerpt } = schedulePromptPreview(task.prompt)
  const paused = task.state === 'paused'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      accessibilityLabel={`${task.prompt}, ${time}, ${t(`schedules_state_${task.state}`)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed
            ? colors.surfaceHover
            : isDark
              ? colors.groupedSurface
              : colors.groupedBackground,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: colors.brandLight }]}>
          <Ionicons name="time-outline" size={24} color={colors.brand} />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={2} style={[mobileTypography.listTitle, { color: colors.text }]}>
            {title}
          </Text>
          <View style={styles.state}>
            <Ionicons
              name={paused ? 'pause-circle-outline' : 'ellipse'}
              size={paused ? 14 : 6}
              color={paused ? colors.textMutedOnSurface : colors.navigationSelected}
            />
            <Text style={[mobileTypography.metadata, { color: colors.textMutedOnSurface }]}>
              {t(`schedules_state_${task.state}`)}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </View>
      {excerpt ? (
        <Text numberOfLines={2} style={[styles.excerpt, { color: colors.textMutedOnSurface }]}>
          {excerpt}
        </Text>
      ) : null}
      <View style={styles.time}>
        <Ionicons name="time-outline" size={16} color={colors.text} />
        <Text style={[mobileTypography.secondary, { color: colors.text, flex: 1 }]}>{time}</Text>
      </View>
      <Text style={[mobileTypography.metadata, { color: colors.textMutedOnSurface }]}>
        {[t(`schedules_execution_${task.executionMode ?? 'main'}`), machineName]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {task.last ? (
        <View style={[styles.delivery, { borderTopColor: colors.groupedSeparator }]}>
          <Ionicons name="paper-plane-outline" size={14} color={colors.textMutedOnSurface} />
          <Text style={[mobileTypography.metadata, { color: colors.textMutedOnSurface, flex: 1 }]}>
            {t(`schedules_last_${task.last.state}`)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}
const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 16, gap: 6, marginBottom: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  excerpt: { ...mobileTypography.secondary, marginBottom: 8 },
  time: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  delivery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    marginTop: 8,
  },
})
