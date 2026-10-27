// @arch docs/features/agent-workspaces.md
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-room-agent-add-ui.test.ts
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { usePreventRemove } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspace, RoomActivationMode } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import type { RoomDetailView, RoomMemberView } from '../rooms/types'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { addDesktopRoomAgents, createDesktopRoomAgentAddRegistry } from './desktopRoomAgentAdd'
import { desktopAgentPort } from './desktopAgentPort'
import { desktopRoomManagementClient } from '../desktop-rooms/desktopRoomManagementClient'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

const operations = createDesktopRoomAgentAddRegistry({
  execute: addDesktopRoomAgents,
  operationId: () => crypto.randomUUID(),
})
operations.setAccount(useAuthStore.getState().user?.id ?? null)
useAuthStore.subscribe((next, previous) => {
  if (next.user?.id !== previous.user?.id) operations.setAccount(next.user?.id ?? null)
})

export default function DesktopRoomAgentAddScreen() {
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const { roomId = '', createdAgentId = '' } = useLocalSearchParams<{
    roomId?: string
    createdAgentId?: string
  }>()
  return accountId && roomId ? (
    <Content
      key={`${accountId}:${roomId}`}
      accountId={accountId}
      roomId={roomId}
      createdAgentId={createdAgentId}
    />
  ) : null
}
function Content({
  accountId,
  roomId,
  createdAgentId,
}: {
  accountId: string
  roomId: string
  createdAgentId: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const alive = useRef(false)
  const readEpoch = useRef(0)
  const [agents, setAgents] = useState<AgentWorkspace[]>([])
  const [members, setMembers] = useState<RoomMemberView[]>([])
  const [room, setRoom] = useState<RoomDetailView | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<Record<string, RoomActivationMode>>({})
  const isCurrent = useCallback(
    () => alive.current && useAuthStore.getState().user?.id === accountId,
    [accountId],
  )
  const actor = useMemo(() => operations.get(accountId, roomId), [accountId, roomId])
  const state = useSyncExternalStore(actor.subscribe, actor.snapshot, actor.snapshot)
  const finished = state.result?.pendingAgentIds.length === 0
  const effectiveSelected = state.locked
    ? Object.fromEntries(
        actor.selection().map((agent) => [agent.agentIdentityId, agent.activationMode]),
      )
    : selected
  useEffect(() => {
    alive.current = true
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id) {
        alive.current = false
        readEpoch.current++
      }
    })
    return () => {
      alive.current = false
      readEpoch.current++
      unsubscribe()
    }
  }, [actor])
  const refresh = useCallback(async () => {
    const epoch = ++readEpoch.current
    setLoading(true)
    setFailed(false)
    try {
      const [list, detail, people] = await Promise.all([
        desktopAgentPort.listAgents(),
        desktopRoomManagementClient.getRoom(roomId),
        desktopRoomManagementClient.listMembers(roomId),
      ])
      if (!isCurrent() || readEpoch.current !== epoch) return
      setAgents(list)
      setRoom(detail.room)
      setMembers(people)
      if (createdAgentId && list.some((agent) => agent.id === createdAgentId))
        setSelected((current) => ({
          ...current,
          [createdAgentId]: current[createdAgentId] ?? 'auto_follow',
        }))
    } catch {
      if (isCurrent() && readEpoch.current === epoch) setFailed(true)
    } finally {
      if (isCurrent() && readEpoch.current === epoch) setLoading(false)
    }
  }, [roomId, createdAgentId, isCurrent])
  useFocusEffect(
    useCallback(() => {
      void refresh()
      return () => {
        readEpoch.current++
      }
    }, [refresh]),
  )
  const back = () => {
    if (!state.busy) router.back()
  }
  useKeyboardShortcut({ key: 'escape', allowEditable: true }, true, back)
  usePreventRemove(state.busy, () => {})
  useEffect(() => {
    if (finished && !state.busy && isCurrent()) {
      if (router.canGoBack()) router.back()
      else router.replace({ pathname: '/(main)/spaces/details', params: { roomId } })
      actor.releaseCompleted()
    }
  }, [finished, state.busy, isCurrent, router, roomId, actor])
  const completed = new Set(state.result?.completed.map((item) => item.agentIdentityId) ?? [])
  const existing = new Set(
    members
      .filter((member) => member.principalType === 'agent' && member.agentIdentityId)
      .map((member) => member.agentIdentityId!),
  )
  const pending = Object.keys(effectiveSelected).filter(
    (id) => !existing.has(id) && !completed.has(id),
  )
  const toggle = (agent: AgentWorkspace) => {
    if (state.locked || failed || loading || existing.has(agent.id)) return
    if (!agent.description.trim()) {
      router.navigate({
        pathname: '/(main)/agents/[agentId]/settings',
        params: { agentId: agent.id, returnAfterSave: '1' },
      })
      return
    }
    setSelected((current) => {
      const next = { ...current }
      if (next[agent.id]) delete next[agent.id]
      else next[agent.id] = 'auto_follow'
      return next
    })
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="desktop-room-agent-add">
      <View
        style={{
          padding: 24,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <DesktopMachineAction label={t('back')} disabled={state.busy} onPress={back} />
        <Text
          accessibilityRole="header"
          style={{ flex: 1, color: colors.text, ...desktopTypography.windowTitle }}
        >
          {t('spaces_add_agent')}
        </Text>
        <DesktopMachineAction
          label={t('agents_create')}
          disabled={state.busy || state.locked}
          onPress={() =>
            router.navigate({
              pathname: '/(main)/agents/new',
              params: { returnTo: 'room-agent-add', roomId },
            })
          }
        />
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: 24,
          maxWidth: 1040,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {loading ? (
          <ActivityIndicator accessibilityLabel={t('loading')} color={colors.brand} />
        ) : null}
        {failed ? (
          <View>
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {t('spaces_agents_load_failed')}
            </Text>
            <DesktopMachineAction
              label={t('retry')}
              disabled={state.busy}
              onPress={() => void refresh()}
            />
          </View>
        ) : null}
        {agents.map((agent) => {
          const added = existing.has(agent.id) || completed.has(agent.id)
          const checked = added || Boolean(effectiveSelected[agent.id])
          return (
            <View
              key={agent.id}
              style={{
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Selection
                label={agent.displayName}
                checked={checked}
                disabled={added || state.locked || failed || loading}
                onPress={() => toggle(agent)}
              >
                <RoomIdentityAvatar
                  name={agent.displayName}
                  avatar={agent.avatar}
                  ownerAvatar={user?.avatar}
                  ownerName={user?.name}
                  agent
                  size={40}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 16 }}>{agent.displayName}</Text>
                  {added || agent.description ? (
                    <Text style={{ color: colors.textSecondary }}>
                      {added ? t('agents_room_existing') : agent.description}
                    </Text>
                  ) : null}
                </View>
              </Selection>
              {!added && effectiveSelected[agent.id] ? (
                <View
                  accessibilityRole="radiogroup"
                  style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
                >
                  {(['auto_follow', 'mention_only', 'paused'] as const).map((mode) => (
                    <Selection
                      key={mode}
                      radio
                      label={t(`spaces_agent_mode_${mode}`)}
                      checked={effectiveSelected[agent.id] === mode}
                      disabled={state.locked || loading || failed}
                      onPress={() => setSelected((current) => ({ ...current, [agent.id]: mode }))}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          )
        })}
        {!loading && !failed && !agents.length ? (
          <Text style={{ color: colors.textSecondary }}>{t('agents_room_add_empty')}</Text>
        ) : null}
        {state.error ? (
          <View>
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {t(
                state.error === 'room_agent_projection_pending'
                  ? 'room_agent_projection_pending'
                  : state.result?.failure?.recovery === 'retry'
                    ? 'spaces_manage_action_failed'
                    : 'room_agent_result_unknown',
              )}
            </Text>
            <DesktopMachineAction
              label={t('retry')}
              disabled={state.busy || state.result?.failure?.recovery === 'blocked'}
              onPress={() => void actor.retry()}
            />
          </View>
        ) : null}
      </ScrollView>
      <View style={{ padding: 24, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Text style={{ color: colors.textSecondary }}>{t('agents_room_risk_note')}</Text>
        <DesktopMachineAction
          label={t(pending.length ? 'agents_room_add_selected' : 'agents_room_select_prompt', {
            count: pending.length,
          })}
          disabled={state.busy || state.locked || failed || loading || !pending.length}
          onPress={() =>
            void actor.submit(
              roomId,
              pending.map((agentIdentityId) => ({
                agentIdentityId,
                activationMode: selected[agentIdentityId]!,
              })),
            )
          }
        />
        {state.busy ? (
          <ActivityIndicator accessibilityLabel={t('loading')} color={colors.brand} />
        ) : null}
      </View>
    </View>
  )
}
function Selection({
  label,
  checked,
  disabled,
  radio = false,
  onPress,
  children,
}: {
  label: string
  checked: boolean
  disabled: boolean
  radio?: boolean
  onPress(): void
  children?: import('react').ReactNode
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: focused ? colors.brand : colors.bg,
        backgroundColor: pressed || (checked && !disabled) ? colors.surfaceHover : colors.bg,
        opacity: disabled ? 0.6 : 1,
      })}
    >
      {children ?? <Text style={{ color: colors.text }}>{label}</Text>}
      <Text style={{ color: disabled ? colors.textSecondary : colors.brand }}>
        {checked ? '✓' : '○'}
      </Text>
    </Pressable>
  )
}
