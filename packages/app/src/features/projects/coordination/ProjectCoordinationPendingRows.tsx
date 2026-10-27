// @arch docs/design/project-coordination-ios.md
// @test src/__tests__/project-coordination.test.ts
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { formatSessionPreviewForDisplay } from '@shennian/shared'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { pendingCoordinationQuestions, taskMatchesFilter, type CoordinationSnapshot, type CoordinationFilter } from './client'
export function ProjectCoordinationPendingRows({ state, sessions, filter, onManager, onTask }: {
  state: CoordinationSnapshot; sessions: Array<{ id: string }>; filter: CoordinationFilter; onManager: () => void; onTask: (id: string) => void
}) {
  const { colors } = useTheme(), { t } = useTranslation()
  const title = (value: string) => formatSessionPreviewForDisplay(value, { image: t('session_preview_image'), images: () => t('session_preview_image'), file: t('session_preview_file'), files: () => t('session_preview_file') })
  const row = { padding: 16, minHeight: 64, gap: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border }
  return <View>
    {['all', 'attention'].includes(filter) ? pendingCoordinationQuestions(state).map(question => <Pressable key={question.id} accessibilityRole="button" style={row} onPress={onManager}>
      <Text style={[mobileTypography.compactAction, { color: colors.brand }]}>{t('coordination_question_title')} ›</Text>
      <Text style={[mobileTypography.body, { color: colors.text }]} numberOfLines={3}>{question.question}</Text>
    </Pressable>) : null}
    {state.tasks.filter(task => !sessions.some(session => session.id === task.id) && taskMatchesFilter(task, filter)).map(task => <Pressable key={task.id} accessibilityRole="button" onPress={() => onTask(task.id)} style={row}>
      <Text numberOfLines={2} style={[mobileTypography.body, { color: colors.text }]}>{title(task.title)}</Text>
      <Text style={[mobileTypography.secondary, { color: colors.textMuted }]}>{t(task.status === 'review' ? 'coordination_review' : task.status === 'waiting' ? 'coordination_attention' : `coordination_${task.status}`)} ›</Text>
    </Pressable>)}
  </View>
}
