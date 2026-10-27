// @test src/__tests__/scheduled-tasks-presentation.test.ts
// @arch docs/design/scheduled-tasks-mobile.md
import { StyleSheet, Text, TextInput, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import type { ConversationSchedule } from '@shennian/wire'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { ScheduleExecutionChoice } from './ScheduleExecutionChoice'
import { schedulePromptPreview } from './schedulePresentation'

export function ScheduleEditorFields({
  task,
  machineName,
  prompt,
  onPromptChange,
  time,
  onTimeChange,
  executionMode,
  onExecutionChange,
  busy,
}: {
  task: ConversationSchedule
  machineName?: string
  prompt: string
  onPromptChange: (value: string) => void
  time: string
  onTimeChange: (value: string) => void
  executionMode: 'main' | 'worker'
  onExecutionChange: (value: 'main' | 'worker') => void
  busy: boolean
}) {
  const { t } = useTranslation(),
    { colors } = useTheme()
  const labelStyle = [mobileTypography.secondary, { color: colors.textSecondary }]
  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.groupedSurface }]
  return (
    <View style={styles.fields}>
      <View style={styles.summary}>
        <View style={[styles.icon, { backgroundColor: colors.brandLight }]}>
          <Ionicons name="time-outline" size={24} color={colors.brand} />
        </View>
        <View style={styles.summaryCopy}>
          <Text numberOfLines={2} style={[mobileTypography.listTitle, { color: colors.text }]}>
            {schedulePromptPreview(task.prompt).title}
          </Text>
          <Text style={[mobileTypography.metadata, { color: colors.textMuted }]}>
            {[t(`schedules_state_${task.state}`), machineName].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <View style={styles.group}>
        <View style={styles.labelRow}>
          <Text style={labelStyle}>{t('schedules_time')}</Text>
          <Text style={labelStyle}>{t(`schedules_kind_${task.rule.kind}`)}</Text>
        </View>
        <View style={[styles.timeSurface, { backgroundColor: colors.groupedSurface }]}>
          <TextInput
            accessibilityLabel={t('schedules_time')}
            editable={!busy}
            value={time}
            onChangeText={onTimeChange}
            style={[mobileTypography.body, { color: colors.text, padding: 0 }]}
          />
          <Text style={[mobileTypography.metadata, { color: colors.textMutedOnSurface }]}>
            {t('schedules_timezone')} · {task.timezone}
          </Text>
        </View>
      </View>
      <View style={styles.group}>
        <Text style={labelStyle}>{t('schedules_work')}</Text>
        <TextInput
          accessibilityLabel={t('schedules_work')}
          editable={!busy}
          value={prompt}
          onChangeText={onPromptChange}
          multiline
          scrollEnabled
          style={[inputStyle, styles.prompt]}
        />
      </View>
      {task.scope === 'steward' ? (
        <ScheduleExecutionChoice
          detailed
          value={executionMode}
          onChange={onExecutionChange}
          disabled={busy}
        />
      ) : null}
      {task.last ? (
        <Text style={[mobileTypography.metadata, { color: colors.textMuted }]}>
          {t(`schedules_last_${task.last.state}`)}
        </Text>
      ) : null}
    </View>
  )
}
const styles = StyleSheet.create({
  fields: { gap: 22 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryCopy: { flex: 1, minWidth: 0, gap: 4 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  group: { gap: 8 },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  timeSurface: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  input: { ...mobileTypography.body, padding: 16, borderRadius: 12 },
  prompt: { height: 180, textAlignVertical: 'top' },
})
