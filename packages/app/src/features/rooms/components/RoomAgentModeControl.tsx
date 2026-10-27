// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/commit-room-agent-mode.test.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import BottomSheet from '../../../components/BottomSheet'
import Ionicons from '@expo/vector-icons/Ionicons'
import { ActionSheetIOS, ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { RoomActivationMode } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { useAuthStore } from '../../../config/auth'
import { useParticipationActionGuard } from '../AgentParticipationMutationBoundary'
import { commitRoomAgentMode } from '../commitRoomAgentMode'
import { roomAccountClient } from '../roomAccountClient'
import { publishRoomRelayEvent } from '../roomEvents'
import { publishAgentRefreshEvent } from '../../agents/agentEvents'
import type { RoomAgentSettingsData } from '../useRoomAgentSettings'
import { RoomAgentStatusLabel } from './RoomAgentStatusLabel'
import { roomActivationModeToParticipation } from './roomAgentStatusPresentation'

const MODES: RoomActivationMode[] = ['auto_follow', 'mention_only', 'paused']
export function RoomAgentModeControl({ data, disabled, onUpdated, onBusyChange }: {
  data: RoomAgentSettingsData; disabled: boolean; onUpdated: () => Promise<void>; onBusyChange: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const [choosing, setChoosing] = useState(false)
  const { colors } = useTheme()
  const { setBusy: setBoundaryBusy } = useParticipationActionGuard()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const mode = data.member.ownBinding?.activationMode ?? data.binding.activationMode
  const [savingMode, setSavingMode] = useState<RoomActivationMode | null>(null)
  const [savedMode, setSavedMode] = useState<{ source: RoomActivationMode; value: RoomActivationMode } | null>(null)
  useEffect(() => setSavedMode(null), [mode])
  const displayedMode = savedMode?.source === mode ? savedMode.value : mode
  const displayedParticipation = roomActivationModeToParticipation(displayedMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { setBoundaryBusy(busy); return () => setBoundaryBusy(false) }, [busy, setBoundaryBusy])
  const apply = useCallback(async (desired: RoomActivationMode) => {
    if (inFlight.current || disabled || !accountId || desired === displayedMode) return false
    inFlight.current = true; setBusy(true); setSavingMode(desired); onBusyChange(true); setError(null)
    try {
      const changed = await commitRoomAgentMode({
        accountId, roomId: data.room.id, memberId: data.member.id, agentIdentityId: data.agent.id,
        sessionId: data.session.id, original: displayedMode, desired,
      }, {
        accountId: () => useAuthStore.getState().user?.id,
        read: () => roomAccountClient.listMembers(data.room.id),
        update: (activationMode) => roomAccountClient.updateAgentMode(data.room.id, data.member.id, { activationMode }),
      })
      if (!alive.current || useAuthStore.getState().user?.id !== accountId) return false
      if (changed) {
        const event = { type: 'event' as const, event: 'room.membership.updated', payload: {
          event: 'room.membership.updated', roomId: data.room.id, entityId: data.member.id,
        } }
        publishRoomRelayEvent(event); publishAgentRefreshEvent(event)
      }
      setSavedMode({ source: mode, value: desired })
      await onUpdated()
      return true
    } catch (cause) {
      if (alive.current && useAuthStore.getState().user?.id === accountId) {
        if (cause instanceof Error && cause.message === 'agent_mode_conflict') {
          setSavedMode(null); setError(t('agent_mode_conflict')); await onUpdated()
        } else setError(t('spaces_agent_mode_update_failed'))
      }
      return false
    } finally {
      inFlight.current = false
      if (alive.current) { setBusy(false); setSavingMode(null); onBusyChange(false) }
    }
  }, [accountId, data, disabled, displayedMode, mode, onBusyChange, onUpdated, t])
  return <View testID="room-agent-mode-control">
    <Pressable accessibilityRole="button" testID="agent-mode-picker" disabled={disabled || busy}
      accessibilityLabel={`${t('agent_mode_label')}, ${t(`spaces_agent_mode_${displayedMode}`)}`}
      onPress={() => {
        if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({
          title: t('agent_mode_label'),
          options: [...MODES.map(value => `${value === displayedMode ? '✓ ' : ''}${t(`spaces_agent_mode_${value}`)}`), t('cancel')],
          cancelButtonIndex: MODES.length,
        }, index => { if (index < MODES.length) void apply(MODES[index]) })
        else setChoosing(true)
      }} style={styles.picker}>
      <Text style={[mobileTypography.body, { color: colors.text }]}>{t('agent_mode_label')}</Text>
      <RoomAgentStatusLabel participation={displayedParticipation} style={styles.currentMode} />
      {busy ? <ActivityIndicator /> : <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
    </Pressable>
    <BottomSheet isOpen={choosing} onClose={() => setChoosing(false)} title={t('agent_mode_label')}>
      <View style={styles.options} accessibilityRole="radiogroup">
        {MODES.map((option) => {
          const selected = displayedMode === option
          return <Pressable key={option} testID={`agent-mode-option-${option}`} accessibilityRole="radio"
            accessibilityLabel={t(`spaces_agent_mode_${option}`)} accessibilityState={{ checked: selected, disabled: disabled || busy }}
            disabled={disabled || busy} onPress={() => { setChoosing(false); void apply(option) }} style={({ pressed }) => [styles.option, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.surfaceHover }]}>
            <View style={styles.selectionMark} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {selected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
            </View>
            <Text style={[styles.optionText, { color: selected ? colors.brand : colors.text }]}>{t(`spaces_agent_mode_${option}`)}</Text>
            {savingMode === option ? <ActivityIndicator color={colors.brand} /> : null}
          </Pressable>
        })}
      </View>
    </BottomSheet>
    {error ? <Text accessibilityRole="alert" style={[styles.note, { color: colors.error }]}>{error}</Text> : null}
  </View>
}
const styles = StyleSheet.create({
  picker: { minHeight: 52, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12 },
  currentMode: { flex: 1, justifyContent: 'flex-end' },
  label: { fontSize: 13, lineHeight: 19, ...(Platform.OS !== 'web' && mobileTypography.sectionTitle) }, options: { width: '100%' },
  option: { minHeight: 48, paddingVertical: 12, paddingLeft: 12, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  selectionMark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, fontSize: 15, lineHeight: 22, textAlign: 'left', ...(Platform.OS !== 'web' && mobileTypography.body) }, note: { fontSize: 13, lineHeight: 19, paddingTop: 8 },
})
