// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/agent-participation-navigation.test.ts
import { useCallback, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { getAgentDisplayName, getSessionLiveActivity, useSessionsStore } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import { ConversationSchedules } from '../../schedules/ConversationSchedules'
import { AgentOverview } from '../../agents/AgentOverview'
import { useRoomAgentSettings } from '../useRoomAgentSettings'
import { useRoomAgentParticipationActions } from '../useRoomAgentParticipationActions'
import { RoomAgentModeControl } from './RoomAgentModeControl'
import { useParticipationActionGuard } from '../AgentParticipationMutationBoundary'
import { mobileTypography } from '../../../theme/mobileTypography'

export type RoomAgentParticipationProps = {
  roomId: string
  agentIdentityId: string
  showOverview?: boolean
  onEdit?: (agentIdentityId: string) => void
  onEnterRoom?: (session: NianSession) => void
  onRemoved?: () => void
  onUpdated?: () => void
  onRestarted?: (previousSessionId: string, replacement: NianSession) => void
}

/** Shared relationship controls inside the canonical full-page Agent detail. */
export function RoomAgentParticipation(props: RoomAgentParticipationProps) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return (
    <ParticipationContent
      key={`${accountId}:${props.roomId}:${props.agentIdentityId}`}
      {...props}
      accountId={accountId}
    />
  )
}
function ParticipationContent({
  roomId,
  agentIdentityId,
  showOverview = true,
  onEdit,
  onEnterRoom,
  onRemoved,
  onUpdated,
  onRestarted,
  accountId,
}: RoomAgentParticipationProps & { accountId: string | null }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { data, failed, refresh } = useRoomAgentSettings(roomId, agentIdentityId, accountId)
  const { request } = useParticipationActionGuard()
  const [showRuntime, setShowRuntime] = useState(false)
  const [modeSaving, setModeSaving] = useState(false)
  const canManage = Boolean(
    data &&
    !failed &&
    data.member.ownerUserId === accountId &&
    (data.session.canManage ?? data.session.userId === accountId) &&
    data.room.status === 'active' &&
    (data.binding.status === 'active' || data.binding.status === 'paused'),
  )
  const liveSession = useSessionsStore((state) => data
    ? state.sessions.find((session) => session.id === data.session.id)
    : undefined)
  const hasActiveTask = Boolean(data && getSessionLiveActivity(liveSession ?? data.session))
  const { busy, requestStop, requestRestart, requestRemove } = useRoomAgentParticipationActions({
    data,
    accountId,
    canManage: canManage && !modeSaving,
    refresh,
    onRemoved,
    onRestarted,
  })
  const updated = useCallback(async () => { await refresh(); onUpdated?.() }, [refresh, onUpdated])
  if (!data)
    return (
      <View testID="room-agent-participation-loading" style={styles.loading}>
        {failed ? (
          <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.retry}>
            <Text style={[styles.notice, { color: colors.error }]}>
              {t('agent_participation_load_failed')}
            </Text>
            <Text style={{ color: colors.brand }}>{t('retry')}</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={colors.brand} />
        )}
      </View>
    )
  const currentModel =
    data.session.modelSource === 'agent' ? data.session.agentDefaultModelId : data.session.modelId
  const runtimeDifferent =
    data.session.agentType !== data.agent.runtimeAdapter ||
    data.session.workDir !== data.agent.workDir ||
    data.session.machineId !== data.agent.machineId ||
    (data.session.sessionMode ?? 'standard') !== data.agent.sessionMode ||
    Boolean(currentModel && currentModel !== data.agent.modelId)
  return (
    <View testID="room-agent-participation" style={styles.root}>
      {showOverview ? (
        <AgentOverview
          compact
          agent={data.agent}
          onEdit={() => {
            if (onEdit) onEdit(agentIdentityId)
            else
              router.navigate({
                pathname: '/(main)/agents/[agentId]/settings',
                params: { agentId: agentIdentityId, returnAfterSave: '1' },
              })
          }}
        />
      ) : null}
      <View style={[styles.section, !showOverview && styles.inlineSection, { backgroundColor: colors.groupedSurface }]}>
        {showOverview ? (
          <View style={styles.heading}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('agent_participation_group_settings')}
            </Text>
            <Text style={[styles.roomName, { color: colors.textSecondary }]} numberOfLines={2}>
              {data.room.name}
            </Text>
          </View>
        ) : null}
        {failed ? (
          <Pressable onPress={() => void refresh()} style={styles.retry}>
            <Text accessibilityRole="alert" style={[styles.notice, { color: colors.error }]}>
              {t('agent_participation_load_failed')} · {t('retry')}
            </Text>
          </Pressable>
        ) : null}
        <RoomAgentModeControl key={data.session.id} data={data} disabled={!canManage || Boolean(busy)}
          onUpdated={updated} onBusyChange={setModeSaving} />
        {runtimeDifferent ? (
          <>
            <ParticipationAction
              testID="room-agent-current-runtime"
              label={t('agent_participation_current_runtime')}
              expanded={showRuntime}
              onPress={() => setShowRuntime(!showRuntime)}
            />
            {showRuntime ? (
              <View style={styles.runtime}>
                <Text style={[styles.notice, { color: colors.textSecondary }]}>
                  {t('agent_participation_runtime_note')}
                </Text>
                <Text style={[styles.notice, { color: colors.textSecondary }]}>
                  {getAgentDisplayName(data.session.agentType)} ·{' '}
                  {currentModel || t('agents_default_model')}
                </Text>
                <Text style={[styles.notice, { color: colors.textSecondary }]}>
                  {data.session.workDir}
                </Text>
                <Text style={[styles.notice, { color: colors.textSecondary }]}>
                  {t(
                    data.session.sessionMode === 'manager'
                      ? 'session_mode_manager'
                      : 'session_mode_standard',
                  )}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
      {data.member.ownerUserId === accountId ? <ConversationSchedules sessionId={data.session.id} /> : null}
        <View testID="room-agent-stacked-actions" style={styles.actions}>
          {onEnterRoom ? <Pressable testID="agent-participation-enter-room" accessibilityRole="button"
            disabled={failed || Boolean(busy) || modeSaving} onPress={() => request(() => onEnterRoom(data.session))}
            style={({ pressed }) => [styles.actionButton, { borderBottomColor: colors.border, backgroundColor: colors.groupedSurface }, pressed && styles.pressed, (failed || busy || modeSaving) && styles.disabled]}>
            <Text style={[styles.buttonText, { color: colors.brand }]}>{t('agent_participation_enter_room')}</Text>
          </Pressable> : null}
          {hasActiveTask ? <Pressable testID="room-agent-stop-task" accessibilityRole="button"
            disabled={!canManage || Boolean(busy) || modeSaving} onPress={() => request(requestStop)}
            style={({ pressed }) => [styles.actionButton, { borderBottomColor: colors.border, backgroundColor: colors.groupedSurface }, pressed && styles.pressed, (!canManage || busy || modeSaving) && styles.disabled]}>
            {busy === 'stop' ? <ActivityIndicator color={colors.error} /> : <Text style={[styles.buttonText, { color: colors.error }]}>{t('agent_task_stop_action')}</Text>}
          </Pressable> : null}
          <Pressable testID="room-agent-restart" accessibilityRole="button" disabled={!canManage || Boolean(busy) || modeSaving}
            onPress={() => request(requestRestart)} style={({ pressed }) => [styles.actionButton, { borderBottomColor: colors.border, backgroundColor: colors.groupedSurface }, pressed && styles.pressed, (!canManage || busy || modeSaving) && styles.disabled]}>
            <Text style={[styles.buttonText, { color: colors.text }]}>{t(busy === 'restart' ? 'session_restart_busy' : 'agent_participation_restart_short')}</Text>
          </Pressable>
          <Pressable testID="room-agent-leave" accessibilityRole="button" onPress={() => request(requestRemove)}
            disabled={!canManage || Boolean(busy) || modeSaving} style={({ pressed }) => [styles.actionButton, styles.leaveButton, { borderBottomColor: colors.border, backgroundColor: colors.groupedSurface }, pressed && styles.pressed, (!canManage || busy || modeSaving) && styles.disabled]}>
            {busy === 'remove' ? <ActivityIndicator color={colors.error} /> : <Text style={[styles.buttonText, { color: colors.error }]}>{t('agent_participation_leave_short')}</Text>}
          </Pressable>
        </View>
    </View>
  )
}
export function ParticipationAction({
  testID,
  label,
  value,
  disabled,
  expanded,
  onPress,
}: {
  testID: string
  label: string
  value?: string
  disabled?: boolean
  expanded?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{
        disabled: Boolean(disabled),
        ...(expanded === undefined ? {} : { expanded }),
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.surfaceHover },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      {value ? <Text style={[styles.value, { color: colors.textSecondary }]}>{value}</Text> : null}
      <Ionicons
        name={expanded === undefined ? 'chevron-forward' : expanded ? 'chevron-up' : 'chevron-down'}
        size={18}
        color={colors.textSecondary}
      />
    </Pressable>
  )
}
const styles = StyleSheet.create({
  root: { width: '100%' },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  section: { marginTop: 16, paddingHorizontal: 16, borderRadius: 12 },
  inlineSection: { marginTop: 0, paddingTop: 0, paddingBottom: 0 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.sectionTitle) },
  roomName: { flexShrink: 1, textAlign: 'right', fontSize: 13, lineHeight: 19, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1, fontSize: 15, lineHeight: 22, ...(Platform.OS !== 'web' && mobileTypography.body) },
  value: { maxWidth: '45%', flexShrink: 1, textAlign: 'right', fontSize: 13, lineHeight: 19, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  actions: { marginTop: 24, marginBottom: 24, gap: 24 },
  actionButton: { borderRadius: 10, minHeight: 52, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontSize: 15, lineHeight: 22, textAlign: 'left', ...(Platform.OS !== 'web' && mobileTypography.body) },
  leaveButton: { borderBottomWidth: 0 },
  pressed: { opacity: 0.6 },
  notice: { fontSize: 13, lineHeight: 19, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  runtime: { paddingVertical: 12, gap: 8 },
  retry: { minHeight: 44, paddingVertical: 12, gap: 8 },
  disabled: { opacity: 0.5 },
})
