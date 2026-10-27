// @arch docs/design/project-coordination-ios.md
// @test src/__tests__/project-task-coordination-notice.test.ts
import { Alert, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { formatSessionPreviewForDisplay, useMachinesStore, useSessionsStore } from '@shennian/shared'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { useProjectCoordination } from './useProjectCoordination'
export function ProjectTaskCoordinationNotice({ sessionId, machineId }: { sessionId: string; machineId: string | null }) {
  const session = useSessionsStore(s => s.sessions.find(item => item.id === sessionId))
  const ownerId = useAuthStore(s => s.user?.id)
  const online = useMachinesStore(s => s.machines.find(m => m.id === machineId)?.online === true)
  const { colors } = useTheme(), { t } = useTranslation()
  const { state, request } = useProjectCoordination(machineId ?? '', session?.workDir ?? '', online && session?.userId === ownerId && session?.sessionScope !== 'steward')
  const task = state?.tasks.find(t => t.id === sessionId)
  if (!state?.enabled || !task || !['review', 'waiting', 'queued', 'paused'].includes(task.status) || (task.status === 'waiting' && task.waitingReason !== 'user_confirmation')) return null
  const pending = task.status === 'queued' || task.status === 'paused'
  const result = task.result ? formatSessionPreviewForDisplay(task.result, {
    image: t('session_preview_image'), images: count => t('session_preview_images', { count }),
    file: t('session_preview_file'), files: count => t('session_preview_files', { count }),
  }) : ''
  return <View style={{ padding: 12, gap: 8, borderTopWidth: 0.5, borderTopColor: colors.border }}>
    <Text style={[mobileTypography.secondary, { color: colors.text }]}>{t(pending ? task.status === 'paused' ? 'coordination_task_paused' : 'coordination_task_queued' : task.status === 'review' ? 'coordination_review' : 'coordination_attention')}</Text>
    {pending ? <Text style={[mobileTypography.secondary, { color: colors.textMuted }]}>{state.paused ? t('coordination_project_paused_hint') : t('coordination_task_queue_hint')}</Text> : null}
    {!pending && result ? <Text numberOfLines={3} style={[mobileTypography.secondary, { color: colors.textMuted }]}>{result}</Text> : null}
    {((task.status === 'waiting' && task.waitingReason === 'user_confirmation') || (pending && (state.automatic === false || task.status === 'paused'))) ? <Pressable disabled={pending && state.paused} accessibilityRole="button" accessibilityLabel={t(pending ? 'coordination_run_task' : 'coordination_confirm_result')} style={{ minHeight: 44, justifyContent: 'center' }} onPress={async () => {
      try { await request({ command: 'task', taskId: sessionId, taskAction: pending ? 'run' : 'complete' }) }
      catch { Alert.alert(t('coordination_error')) }
    }}><Text style={[mobileTypography.compactAction, { color: colors.brand }]}>{t(pending ? 'coordination_run_task' : 'coordination_confirm_result')}</Text></Pressable> : null}
  </View>
}
