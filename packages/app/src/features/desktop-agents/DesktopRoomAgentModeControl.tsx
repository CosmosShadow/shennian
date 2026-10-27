// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-room-agent-controller.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import type { RoomActivationMode } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useParticipationActionGuard } from '../rooms/AgentParticipationMutationBoundary'
import type { RoomAgentSettingsData } from '../rooms/useRoomAgentSettings'
import { setDesktopRoomAgentMode } from './desktopRoomAgentClient'
import { createDesktopRoomAgentModeController } from './desktopRoomAgentController'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { RoomAgentStatusLabel } from '../rooms/components/RoomAgentStatusLabel'
import { roomActivationModeToParticipation } from '../rooms/components/roomAgentStatusPresentation'

const modes: RoomActivationMode[] = ['auto_follow', 'mention_only', 'paused']
export function DesktopRoomAgentModeControl({ data, disabled, onUpdated, onBusyChange, manageBoundary = true }: {
  data: RoomAgentSettingsData; disabled: boolean; onUpdated(): Promise<void>; onBusyChange(busy: boolean): void; manageBoundary?: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore(state => state.user?.id)
  const { setBusy: setBoundaryBusy } = useParticipationActionGuard()
  const pickerRef = useRef<View>(null)
  const [choosing, setChoosing] = useState(false)
  const [saving, setSaving] = useState<RoomActivationMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Do not optimistically replace the radio value. It comes from the main relation read.
  const mode = data.member.ownBinding?.activationMode ?? data.binding.activationMode
  const participation = roomActivationModeToParticipation(mode)
  const actor = useMemo(() => createDesktopRoomAgentModeController({
    isCurrent: () => Boolean(accountId) && useAuthStore.getState().user?.id === accountId,
    save: setDesktopRoomAgentMode,
  }), [accountId, data.room.id, data.member.id, data.session.id, data.agent.id])
  useEffect(() => {
    actor.start(); setSaving(null); setError(null)
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id) actor.stop()
    })
    return () => { actor.stop(); unsubscribe() }
  }, [actor])
  useEffect(() => {
    if (!manageBoundary) return
    setBoundaryBusy(saving !== null)
    return () => setBoundaryBusy(false)
  }, [manageBoundary, saving, setBoundaryBusy])
  const apply = (desired: RoomActivationMode) => {
    if (disabled) return
    void actor.apply({ roomId: data.room.id, agentIdentityId: data.agent.id, memberId: data.member.id,
      sessionId: data.session.id, original: mode, desired }, {
      busy(value) { setSaving(value ? desired : null); onBusyChange(value); if (value) setError(null) },
      async committed() { await onUpdated() },
      async failed(cause) {
        setError(cause instanceof Error && cause.message === 'agent_mode_conflict'
          ? t('agent_mode_conflict') : t('spaces_agent_mode_update_failed'))
        // Re-read authoritative state even when the write result is uncertain; never resend here.
        await onUpdated()
      },
    })
  }
  return <View testID="room-agent-mode-control" style={styles.root}>
    <Pressable ref={pickerRef} testID="agent-mode-picker" accessibilityRole="button"
      accessibilityLabel={`${t('agent_mode_label')}, ${t(`spaces_agent_mode_${mode}`)}`}
      accessibilityState={{ disabled: disabled || saving !== null, busy: saving !== null }}
      disabled={disabled || saving !== null} onPress={() => setChoosing(true)}
      style={({ pressed }) => [styles.picker, pressed && { backgroundColor: colors.surfaceHover }]}>
      <Text style={[styles.pickerLabel, { color: colors.text }]}>{t('agent_mode_label')}</Text>
      <RoomAgentStatusLabel participation={participation} style={styles.currentMode} />
      {saving ? <ActivityIndicator color={colors.brand} />
        : <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
    </Pressable>
    {choosing ? <DesktopDialog title={t('agent_mode_label')} onClose={() => setChoosing(false)} returnFocusRef={pickerRef}>
      <View accessibilityRole="radiogroup">
        {modes.map(option => <Pressable key={option} testID={`agent-mode-option-${option}`} accessibilityRole="radio"
          accessibilityLabel={t(`spaces_agent_mode_${option}`)}
          accessibilityState={{ checked: mode === option, disabled: disabled || saving !== null, busy: saving === option }}
          disabled={disabled || saving !== null} onPress={() => { setChoosing(false); apply(option) }}
          style={({ pressed }) => [styles.option, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.surfaceHover }]}>
          <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {mode === option ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
          </View>
          <Text style={[styles.text, { color: mode === option ? colors.brand : colors.text }]}>{t(`spaces_agent_mode_${option}`)}</Text>
          {saving === option ? <ActivityIndicator color={colors.brand} /> : null}
        </Pressable>)}
      </View>
    </DesktopDialog> : null}
    {error ? <Text accessibilityRole="alert" style={[styles.label, { color: colors.error }]}>{error}</Text> : null}
  </View>
}
const styles = StyleSheet.create({
  root: { width: '100%' },
  picker: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickerLabel: { flex: 1, fontSize: 16, lineHeight: 22 },
  currentMode: { justifyContent: 'flex-end' },
  label: { fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 10 },
  option: { minHeight: 48, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  mark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: 15, lineHeight: 22 },
})
