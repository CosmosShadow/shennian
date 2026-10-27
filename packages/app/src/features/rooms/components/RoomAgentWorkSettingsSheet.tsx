// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-management-panel.test.ts
// @test src/__tests__/room-agent-mode.test.ts
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { RoomActivationMode } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import BottomSheet from '../../../components/BottomSheet'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import type { RoomMemberView } from '../types'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'
import { roomAccountClient } from '../roomAccountClient'
import { applyRoomAgentMode, canChangeRoomAgentMode } from '../roomAgentMode'
import { publishRoomRelayEvent } from '../roomEvents'
import { publishAgentRefreshEvent } from '../../agents/agentEvents'
import { mobileTypography } from '../../../theme/mobileTypography'
import { getRoomMemberParticipation } from '../roomPresentation'
import { isRoomAgentIdentityDimmed } from './roomAgentStatusPresentation'

const MODES: RoomActivationMode[] = ['auto_follow', 'mention_only', 'paused']

export function RoomAgentWorkSettingsSheet({
  roomId,
  roomName,
  agent,
  visible,
  onClose,
  onAgentUpdated,
  onRequestRemove,
  inline = false,
  loadFailed = false,
  onRetry,
  showIdentity = true,
  disabled = false,
  onBusyChange,
}: {
  showIdentity?: boolean
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  inline?: boolean
  loadFailed?: boolean
  onRetry?: () => void
  roomId: string
  roomName?: string
  agent: RoomMemberView | null
  visible: boolean
  onClose: () => void
  onAgentUpdated: (agent: RoomMemberView) => void
  onRequestRemove?: (agent: RoomMemberView) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const userId = useAuthStore((state) => state.user?.id)
  const [savingMode, setSavingMode] = useState<RoomActivationMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const context = `${userId}:${roomId}:${agent?.id}:${visible}`
  const contextRef = useRef(context)
  contextRef.current = context
  useEffect(() => {
    setError(null)
    setSavingMode(null)
  }, [context])
  const editable = !disabled && canChangeRoomAgentMode(agent, userId)
  const offline = isRoomAgentIdentityDimmed(getRoomMemberParticipation(agent))
  const updateMode = async (activationMode: RoomActivationMode) => {
    if (!agent || !editable || busy.current || agent.ownBinding?.activationMode === activationMode)
      return
    busy.current = true
    onBusyChange?.(true)
    setSavingMode(activationMode)
    setError(null)
    try {
      const result = await roomAccountClient.updateAgentMode(roomId, agent.id, { activationMode })
      if (contextRef.current !== context) return
      onAgentUpdated(applyRoomAgentMode(agent, result))
      const event = {
        type: 'event' as const,
        event: 'room.membership.updated',
        payload: { event: 'room.membership.updated', roomId, entityId: agent.id },
      }
      publishRoomRelayEvent(event)
      publishAgentRefreshEvent(event)
    } catch {
      if (contextRef.current === context) setError(t('spaces_agent_mode_update_failed'))
    } finally {
      busy.current = false
      onBusyChange?.(false)
      if (contextRef.current === context) setSavingMode(null)
    }
  }
  const content = (
    <>
      {agent ? (
        <View testID="room-agent-work-settings">
          {showIdentity ? <View style={styles.identity}>
            <RoomIdentityAvatar
              name={agent.displayAlias}
              avatar={agent.avatar}
              agent
              ownerAvatar={agent.ownerAvatar}
              ownerName={agent.ownerDisplayName}
              size={34}
              offline={offline}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.text }]}>{agent.displayAlias}</Text>
              {roomName ? <Text style={{ color: colors.textSecondary }}>{roomName}</Text> : null}
            </View>
          </View> : null}
          {!editable && !disabled ? (
            <Text style={[styles.notice, { color: colors.textSecondary }]}>
              {t('spaces_agent_mode_binding_unavailable')}
            </Text>
          ) : null}
          <View style={[styles.options, { backgroundColor: colors.surface }]}>
            {MODES.map((mode, index) => {
              const selected = agent.ownBinding?.activationMode === mode
              return (
                <Pressable
                  key={mode}
                  testID={`room-agent-mode-${agent.id}-${mode}`}
                  accessibilityRole="radio"
                  accessibilityLabel={t(`spaces_agent_mode_${mode}`)}
                  accessibilityState={{
                    checked: selected,
                    busy: savingMode === mode,
                    disabled: !editable || Boolean(savingMode),
                  }}
                  disabled={!editable || Boolean(savingMode)}
                  onPress={() => void updateMode(mode)}
                  style={({ pressed }) => [
                    styles.option,
                    index < 2 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                    pressed && { backgroundColor: colors.surfaceHover },
                  ]}
                >
                  <Text style={[styles.optionTitle, { color: colors.text }]}>
                    {t(`spaces_agent_mode_${mode}`)}
                  </Text>
                  {savingMode === mode ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={colors.brand} />
                  ) : (
                    <View style={[styles.unselected, { borderColor: colors.border }]} />
                  )}
                </Pressable>
              )
            })}
          </View>
          {error ? (
            <Text accessibilityRole="alert" style={[styles.notice, { color: colors.error }]}>
              {error}
            </Text>
          ) : null}
          {onRequestRemove && agent.ownerUserId === userId ? (
            <Pressable
              testID={`room-agent-settings-remove-${agent.id}`}
              onPress={() => onRequestRemove(agent)}
              disabled={Boolean(savingMode)}
              style={styles.remove}
            >
              <Text style={{ color: colors.error }}>{t('spaces_remove_own_agent')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : loadFailed ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.remove}>
          <Text style={{ color: colors.error }}>{t('spaces_agent_mode_load_failed')}</Text>
        </Pressable>
      ) : (
        <ActivityIndicator color={colors.brand} />
      )}
    </>
  )
  return inline ? (
    content
  ) : (
    <BottomSheet
      isOpen={visible}
      onClose={onClose}
      title={t('spaces_agent_work_mode')}
      preferDialogOnWeb
      avoidKeyboard={false}
    >
      {content}
    </BottomSheet>
  )
}
const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.listTitle) },
  options: { borderRadius: 12, overflow: 'hidden' },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  optionTitle: { flex: 1, fontSize: 16, lineHeight: 22, ...(Platform.OS !== 'web' && mobileTypography.body) },
  unselected: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
  notice: { marginVertical: 12, fontSize: 14, lineHeight: 20, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  remove: {
    minHeight: 44,
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: 24,
    padding: 8,
  },
})
