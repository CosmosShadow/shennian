// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-room-agent-participation.test.ts
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { getAgentDisplayName, getSessionLiveActivity, useSessionsStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { ConversationSchedules } from '../schedules/ConversationSchedules'
import { AgentOverview } from '../agents/AgentOverview'
import type { RoomAgentParticipationProps } from '../rooms/components/RoomAgentParticipation'
import { useParticipationActionGuard } from '../rooms/AgentParticipationMutationBoundary'
import { useDesktopRoomAgentSettings } from './useDesktopRoomAgentSettings'
import { DesktopRoomAgentModeControl } from './DesktopRoomAgentModeControl'
import { DesktopRoomAgentConfirmDialog } from './DesktopRoomAgentConfirmDialog'
import { useDesktopRoomAgentActions } from './useDesktopRoomAgentActions'
import { desktopParticipationManageable, desktopParticipationRuntime } from './desktopRoomAgentPresentation'

/** Desktop relationship view: reads authoritative main results and issues fixed domain actions only. */
export function DesktopRoomAgentParticipation(props: RoomAgentParticipationProps & { onOpenWork?: (sessionId: string) => void }) {
  const accountId = useAuthStore(state => state.user?.id ?? null)
  return <Participation key={`${accountId}:${props.roomId}:${props.agentIdentityId}`} {...props} accountId={accountId} />
}
function Participation({ roomId, agentIdentityId, accountId, showOverview = true, onEdit, onEnterRoom,
  onOpenWork, onRemoved, onUpdated, onRestarted }: RoomAgentParticipationProps & { accountId: string | null; onOpenWork?: (sessionId: string) => void }) {
  const { t, i18n } = useTranslation(); const { colors } = useTheme(); const router = useRouter()
  const { request, setBusy: setBoundaryBusy } = useParticipationActionGuard()
  const { data, failed, refresh } = useDesktopRoomAgentSettings(roomId, agentIdentityId, accountId)
  const [runtimeOpen, setRuntimeOpen] = useState(false)
  const [modeSaving, setModeSaving] = useState(false)
  const restartRef = useRef<View>(null)
  const stopRef = useRef<View>(null)
  const removeRef = useRef<View>(null)
  const canManage = desktopParticipationManageable(data, failed, accountId)
  const actions = useDesktopRoomAgentActions({ data, accountId, canManage: canManage && !modeSaving, refresh, onRemoved, onRestarted })
  const liveSession = useSessionsStore(state => data ? state.sessions.find(session => session.id === data.session.id) : undefined)
  const hasActiveTask = Boolean(data && getSessionLiveActivity(liveSession ?? data.session))
  const updated = useCallback(async () => { await refresh(); onUpdated?.() }, [refresh, onUpdated])
  const navigationBusy = modeSaving || Boolean(actions.busy)
  // This relationship owns one aggregate navigation lock, including when the old relation vanishes.
  useEffect(() => {
    setBoundaryBusy(navigationBusy)
    return () => setBoundaryBusy(false)
  }, [navigationBusy, setBoundaryBusy])
  const actionError = !actions.error ? null : actions.error === 'room_agent_session_running' ? t('session_restart_running')
    : actions.error === 'room_agent_machine_offline' ? t('session_restart_offline')
    : actions.error === 'room_agent_no_active_task' ? t('agent_task_stop_not_running')
    : actions.error === 'agent_stop_failed' ? t('agent_task_stop_failed')
    : actions.error === 'room_agent_projection_pending' ? t('room_agent_projection_pending')
    : actions.blocked ? t('room_agent_result_unknown') : t('spaces_manage_action_failed')
  const actionFeedback = actionError ? <View testID="desktop-room-agent-action-feedback">
    <Text accessibilityRole="alert" style={{ color: colors.error }}>{actionError}</Text>
    <Action label={t('retry')} disabled={navigationBusy} onPress={() => void actions.reconcile()} />
  </View> : null
  if (!data) return <View testID="desktop-room-agent-participation-loading" style={styles.loading}>
    {actionFeedback}
    {!actions.error && failed ? <><Text accessibilityRole="alert" style={{ color: colors.error }}>{t('agent_participation_load_failed')}</Text>
      <Action label={t('retry')} disabled={navigationBusy} onPress={() => void refresh()} /></> : null}
    {(!failed && !actions.error) || actions.busy ? <ActivityIndicator accessibilityLabel={t('loading')} color={colors.brand} /> : null}
  </View>
  const runtime = desktopParticipationRuntime(data)
  const disabled = !canManage || Boolean(actions.busy) || actions.blocked || modeSaving
  return <View testID="desktop-room-agent-participation" style={styles.root}>
    {showOverview ? <AgentOverview compact agent={data.agent} onEdit={() => request(() => {
      if (onEdit) onEdit(agentIdentityId)
      else router.navigate({ pathname: '/(main)/agents/[agentId]/settings', params: { agentId: agentIdentityId, returnAfterSave: '1' } })
    })} /> : null}
    <View style={[styles.section, showOverview && styles.afterOverview, { backgroundColor: colors.groupedSurface }]}>
      {failed ? <View><Text accessibilityRole="alert" style={{ color: colors.error }}>{t('agent_participation_load_failed')}</Text>
        <Action label={t('retry')} onPress={() => void refresh()} /></View> : null}
      <DesktopRoomAgentModeControl key={data.session.id} data={data} manageBoundary={false} disabled={!canManage || Boolean(actions.busy) || actions.blocked} onUpdated={updated} onBusyChange={setModeSaving} />
      {actionFeedback}
      {runtime.different ? <View>
        <Action testID="desktop-room-agent-current-runtime" label={t('agent_participation_current_runtime')} expanded={runtimeOpen} onPress={() => setRuntimeOpen(value => !value)} />
        {runtimeOpen ? <View style={styles.runtime}>
          <Text style={{ color: colors.textSecondary }}>{t('agent_participation_runtime_note')}</Text>
          <Text selectable style={{ color: colors.text }}>{getAgentDisplayName(data.session.agentType)} · {runtime.model || t('agents_default_model')}</Text>
          <Text selectable style={{ color: colors.text }}>{data.session.workDir}</Text>
          <Text style={{ color: colors.textSecondary }}>{t(data.session.sessionMode === 'manager' ? 'session_mode_manager' : 'session_mode_standard')}</Text>
        </View> : null}
      </View> : null}
    </View>
    {data.member.ownerUserId === accountId ? <ConversationSchedules sessionId={data.session.id} /> : null}
    <View testID="desktop-room-agent-stacked-actions" style={styles.actions}>
      {onOpenWork ? <Action testID="desktop-room-agent-open-work"
        label={i18n.language.startsWith('zh') ? '打开内部工作对话' : 'Open internal work conversation'}
        disabled={failed || navigationBusy} onPress={() => onOpenWork(data.session.id)} /> : null}
      {onEnterRoom ? <Action label={t('agent_participation_enter_room')} disabled={failed || Boolean(actions.busy) || modeSaving} onPress={() => request(() => onEnterRoom(data.session))} /> : null}
      {hasActiveTask ? <Action actionRef={stopRef} testID="desktop-room-agent-stop-task" label={t('agent_task_stop_action')}
        destructive disabled={disabled} busy={actions.busy === 'stop'} onPress={() => request(actions.requestStop)} /> : null}
      <Action actionRef={restartRef} testID="desktop-room-agent-restart" label={t(actions.busy === 'restart' ? 'session_restart_busy' : 'agent_participation_restart_short')}
        disabled={disabled} busy={actions.busy === 'restart'} onPress={() => request(actions.requestRestart)} />
      <Action actionRef={removeRef} testID="desktop-room-agent-leave" label={t('agent_participation_leave_short')} destructive disabled={disabled} busy={actions.busy === 'remove'} onPress={() => request(actions.requestRemove)} />
    </View>
    <DesktopRoomAgentConfirmDialog
      visible={Boolean(actions.confirmation)}
      title={actions.confirmation?.action === 'stop'
        ? t('agent_task_stop_confirm_title')
        : actions.confirmation?.action === 'restart'
        ? t('session_restart_confirm_title', { agent: actions.confirmation.agentName })
        : t('spaces_agent_remove_confirm_title', { name: actions.confirmation?.agentName ?? '' })}
      body={actions.confirmation?.action === 'stop' ? t('agent_task_stop_confirm')
        : actions.confirmation?.action === 'restart' ? t('session_restart_confirm') : undefined}
      confirmLabel={t(actions.confirmation?.action === 'stop' ? 'agent_task_stop_action'
        : actions.confirmation?.action === 'restart' ? 'session_restart_confirm_action' : 'agent_participation_leave_short')}
      cancelLabel={t('cancel')}
      destructive={actions.confirmation?.action === 'remove' || actions.confirmation?.action === 'stop'}
      returnFocusRef={actions.confirmation?.action === 'remove' ? removeRef
        : actions.confirmation?.action === 'stop' ? stopRef : restartRef}
      onCancel={actions.cancelRequestedAction}
      onConfirm={actions.confirmRequestedAction}
    />
  </View>
}
function Action({ actionRef, testID, label, disabled = false, busy = false, destructive = false, expanded, onPress }: {
  actionRef?: RefObject<View | null>; testID?: string; label: string; disabled?: boolean; busy?: boolean; destructive?: boolean; expanded?: boolean; onPress(): void
}) {
  const { colors } = useTheme(); const [focused, setFocused] = useState(false)
  return <Pressable ref={actionRef} testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy, expanded }}
    disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.action, { borderColor: focused ? colors.brand : 'transparent', backgroundColor: pressed ? colors.surfaceHover : colors.groupedSurface, opacity: disabled ? 0.5 : 1 }]}>
    <Text style={[styles.actionText, { color: destructive ? colors.error : colors.text }]}>{label}</Text>
    {busy ? <ActivityIndicator color={destructive ? colors.error : colors.brand} /> : null}
    {expanded !== undefined ? <Text accessibilityElementsHidden style={{ color: colors.textSecondary }}>{expanded ? '−' : '+'}</Text> : null}
  </Pressable>
}
const styles = StyleSheet.create({
  root: { width: '100%' }, loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 12 },
  section: { borderRadius: 10, overflow: 'hidden' },
  afterOverview: { marginTop: 24 },
  runtime: { gap: 8, padding: 16 },
  actions: { gap: 24 },
  action: { minHeight: 58, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionText: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
})
