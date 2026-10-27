// @arch docs/features/agent-workspaces.md
// @test ../../../__tests__/room-agent-selection.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActionSheetIOS,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { type AgentWorkspace, type RoomActivationMode } from '@shennian/wire'
import { RelayConnectionError, useMachinesStore, useSessionsStore } from '@shennian/shared'
import { useTranslation } from 'react-i18next'
import { AppPageHeader, HeaderIconButton } from '../../../components/ConnectedAppPageHeader'
import { agentAccountClient } from '../../agents/agentAccountClient'
import { roomAccountClient } from '../roomAccountClient'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { useTheme } from '../../../hooks/useTheme'
import { useAuthStore } from '../../../config/auth'
import { RoomIdentityAvatar } from '../components/RoomIdentityAvatar'
import {
  getAddedRoomAgentIds,
  isExpectedManagedRoomBinding,
  toggleRoomAgentSelection,
  submitRoomAgentSelection,
} from '../roomAgentSelection'
import type { RoomMemberView } from '../types'
import { useRelayConnectivitySnapshot } from '../../../hooks/useAppConnectivityStatus'
import { mobileTypography } from '../../../theme/mobileTypography'
import BottomSheet from '../../../components/BottomSheet'

const WORK_MODES: RoomActivationMode[] = ['auto_follow', 'mention_only', 'paused']

export default function AddRoomAgentRoute() {
  const { roomId = '', createdAgentId = '', selectedAgentIds = '', returnTo = '' } = useLocalSearchParams<{
    roomId: string
    createdAgentId?: string
    selectedAgentIds?: string
    returnTo?: string
  }>()
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const upsert = useSessionsStore((s) => s.upsertSession)
  const machines = useMachinesStore((state) => state.machines)
  const user = useAuthStore((state) => state.user)
  const [agents, setAgents] = useState<AgentWorkspace[]>([])
  const [members, setMembers] = useState<RoomMemberView[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<
    | { kind: 'load' }
    | { kind: 'add'; agentId: string }
    | { kind: 'connectivity'; agentId: string }
    | null
  >(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activationModes, setActivationModes] = useState<Record<string, RoomActivationMode>>({})
  const [choosingModeAgentId, setChoosingModeAgentId] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<string[]>([])
  const addLock = useRef(false)
  const assignmentIntentIds = useRef(new Map<string, string>())
  const relayConnectivity = useRelayConnectivitySnapshot()

  useEffect(() => {
    if (relayConnectivity?.phase === 'connected') {
      setError((current) => (current?.kind === 'connectivity' ? null : current))
    }
  }, [relayConnectivity?.phase])

  const reportError = (scope: 'load' | 'add', reason: unknown) => {
    if (__DEV__) console.warn(`[room-agent-add] ${scope} failed`, reason)
  }

  const loadAgents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [agentData, memberData] = await Promise.all([
        agentAccountClient.listAgents(),
        roomAccountClient.listMembers(roomId),
      ])
      setAgents(agentData)
      setMembers(memberData)
      if (selectedAgentIds) {
        const requested = new Set(selectedAgentIds.split(',').filter(Boolean))
        const selectable = agentData.filter((agent) => requested.has(agent.id)
          && !getAddedRoomAgentIds(agentData, memberData, roomId, []).has(agent.id))
        setSelectedIds(selectable.map((agent) => agent.id))
      }
      if (
        createdAgentId &&
        agentData.some((agent) => agent.id === createdAgentId) &&
        !getAddedRoomAgentIds(agentData, memberData, roomId, []).has(createdAgentId)
      ) {
        setSelectedIds((ids) => (ids.includes(createdAgentId) ? ids : [...ids, createdAgentId]))
      }
    } catch (reason) {
      reportError('load', reason)
      setError({ kind: 'load' })
    } finally {
      setLoading(false)
    }
  }, [createdAgentId, roomId, selectedAgentIds])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  const alreadyAddedIds = getAddedRoomAgentIds(agents, members, roomId, addedIds)
  const pendingAgents = agents.filter(
    (agent) => selectedIds.includes(agent.id) && !alreadyAddedIds.has(agent.id),
  )
  const add = async (agent: AgentWorkspace) => {
    setBusy(agent.id)
    setError(null)
    const assignmentIntentId =
      assignmentIntentIds.current.get(agent.id) ??
      `${roomId}:${agent.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    assignmentIntentIds.current.set(agent.id, assignmentIntentId)
    const activationMode = activationModes[agent.id] ?? 'auto_follow'
    try {
      const latestMemberData = await roomAccountClient.listMembers(roomId)
      setMembers(latestMemberData)
      // Another client or a timed-out attempt may already have completed this binding.
      if (getAddedRoomAgentIds([], latestMemberData, roomId, []).has(agent.id)) {
        setAddedIds((ids) => [...ids, agent.id])
        setSelectedIds((ids) => ids.filter((id) => id !== agent.id))
        assignmentIntentIds.current.delete(agent.id)
        return true
      }
      const session = await agentAccountClient.createRoomSession(agent.id, assignmentIntentId)
      upsert(session)
      accountRuntime.persistSession(session).catch(() => {})

      if (accountRuntime.getConnectivitySnapshot()?.phase !== 'connected') {
        void accountRuntime.reconnect('manual')
        throw new Error('relay_unavailable')
      }
      const originMachine = machines.find((machine) => machine.id === session.machineId)
      if (!originMachine?.daemonInstallationId) throw new Error('machine_identity_unavailable')
      const bindResponse = await accountRuntime.requestMachine(
        session.machineId,
        'room.agent.bind-managed',
        {
          roomId,
          agentIdentityId: agent.id,
          nianSessionId: session.id,
          assignmentIntentId,
          agentType: session.agentType,
          activationMode,
        },
        { connectTimeoutMs: 15_000, responseTimeoutMs: 120_000 },
      )
      if (!bindResponse?.ok) {
        throw new Error(bindResponse?.error ?? 'managed_agent_binding_failed')
      }
      if (
        !isExpectedManagedRoomBinding(bindResponse.payload, {
          roomId,
          agentIdentityId: agent.id,
          nianSessionId: session.id,
          activationMode,
        })
      ) {
        throw new Error('managed_agent_binding_incomplete')
      }

      assignmentIntentIds.current.delete(agent.id)
      setAddedIds((ids) => [...ids, agent.id])
      setSelectedIds((ids) => ids.filter((id) => id !== agent.id))
      return true
    } catch (reason) {
      reportError('add', reason)
      const connectivityUnavailable =
        reason instanceof RelayConnectionError ||
        accountRuntime.getConnectivitySnapshot()?.phase !== 'connected'
      setError({ kind: connectivityUnavailable ? 'connectivity' : 'add', agentId: agent.id })
      return false
    }
  }
  const submit = async () => {
    if (addLock.current) return
    if (!pendingAgents.length || loading || error?.kind === 'load') return
    addLock.current = true
    try {
      const complete = await submitRoomAgentSelection(pendingAgents, add)
      if (complete) {
        if (returnTo === 'details') router.replace({ pathname: '/(main)/spaces/details', params: { roomId } })
        else if (selectedAgentIds) router.replace({ pathname: '/(main)/room-workspace', params: { roomId } })
        else if (router.canGoBack()) router.back()
        else router.replace({ pathname: '/(main)/spaces/details', params: { roomId } })
      }
    } finally {
      setBusy(null)
      addLock.current = false
    }
  }

  const toggle = (agent: AgentWorkspace) => {
    if (addLock.current || alreadyAddedIds.has(agent.id)) return
    if (!agent.description.trim()) {
      router.navigate(`/(main)/agents/${agent.id}/settings`)
      return
    }
    setSelectedIds((ids) => toggleRoomAgentSelection(ids, agent.id, alreadyAddedIds))
    if (!selectedIds.includes(agent.id)) {
      setActivationModes((modes) => ({ ...modes, [agent.id]: 'auto_follow' }))
    }
    setError(null)
  }
  const chooseMode = (agentId: string, mode: RoomActivationMode) => {
    setActivationModes((modes) => ({ ...modes, [agentId]: mode }))
    setChoosingModeAgentId(null)
    setError(null)
  }
  const openModePicker = (agent: AgentWorkspace) => {
    if (busy !== null) return
    const currentMode = activationModes[agent.id] ?? 'auto_follow'
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `${agent.displayName} · ${t('spaces_agent_work_mode')}`,
          options: [
            ...WORK_MODES.map(
              (mode) => `${mode === currentMode ? '✓ ' : ''}${t(`spaces_agent_mode_${mode}`)}`,
            ),
            t('cancel'),
          ],
          cancelButtonIndex: WORK_MODES.length,
        },
        (index) => {
          if (index < WORK_MODES.length) chooseMode(agent.id, WORK_MODES[index])
        },
      )
      return
    }
    setChoosingModeAgentId(agent.id)
  }
  const choosingModeAgent = agents.find((agent) => agent.id === choosingModeAgentId) ?? null
  return (
    <SafeAreaView style={[s.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <AppPageHeader
        title={t('spaces_add_agent')}
        showsConnectivityStatus
        onBack={() => {
          if (!addLock.current) router.back()
        }}
        trailing={
          <HeaderIconButton
            icon="add"
            label={t('agents_create')}
            testID="room-create-agent"
            onPress={() => {
              if (addLock.current) return
              router.navigate({
                pathname: '/(main)/agents/new',
                params: { returnTo: 'room-agent-add', roomId },
              })
            }}
          />
        }
      />
      <ScrollView contentContainerStyle={s.content}>
        {loading ? <ActivityIndicator color={colors.brand} /> : null}
        {!loading &&
          error?.kind !== 'load' &&
          agents.map((agent) => {
            const already = alreadyAddedIds.has(agent.id)
            const selected = selectedIds.includes(agent.id)
            const activationMode = activationModes[agent.id] ?? 'auto_follow'
            return (
              <View key={agent.id}>
                <Pressable
                  testID={`room-agent-choice-${agent.id}`}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${agent.displayName}, ${t(already ? 'agents_room_existing' : selected ? 'agents_room_selected' : 'agents_room_select')}`}
                  accessibilityState={{
                    checked: already || selected,
                    disabled: already || busy !== null,
                  }}
                  disabled={already || busy !== null}
                  onPress={() => toggle(agent)}
                  style={({ pressed }) => [
                    s.row,
                    {
                      backgroundColor: pressed ? colors.surfaceHover : colors.bg,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <View style={s.avatar}>
                    <RoomIdentityAvatar
                      name={agent.displayName}
                      avatar={agent.avatar}
                      agent
                      ownerName={user?.name}
                      ownerAvatar={user?.avatar}
                      size={44}
                    />
                  </View>
                  <View style={s.titleRow}>
                    <Text style={[s.agentName, { color: colors.text }]} numberOfLines={1}>
                      {agent.displayName}
                    </Text>
                    {already ? (
                      <Text style={[s.existingLabel, { color: colors.textSecondary }]}>
                        {t('agents_room_existing')}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.choiceIcon}>
                    {busy === agent.id ? (
                      <ActivityIndicator color={colors.brand} />
                    ) : (
                      <Ionicons
                        name={already || selected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={
                          already
                            ? colors.textTertiary
                            : selected
                              ? colors.brand
                              : colors.textTertiary
                        }
                      />
                    )}
                  </View>
                </Pressable>
                {selected ? (
                  <Pressable
                    testID={`room-agent-work-mode-${agent.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('spaces_agent_work_mode')}, ${t(`spaces_agent_mode_${activationMode}`)}`}
                    disabled={busy !== null}
                    onPress={() => openModePicker(agent)}
                    style={({ pressed }) => [
                      s.modeRow,
                      {
                        borderBottomColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceHover : colors.bg,
                      },
                    ]}
                  >
                    <Text style={[s.modeLabel, { color: colors.text }]}>
                      {t('spaces_agent_work_mode')}
                    </Text>
                    <Text style={[s.modeValue, { color: colors.textSecondary }]} numberOfLines={1}>
                      {t(`spaces_agent_mode_${activationMode}`)}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </View>
            )
          })}
        {!loading && error?.kind !== 'load' && agents.length === 0 ? (
          <Text style={[s.empty, { color: colors.textSecondary }]}>
            {t('agents_room_add_empty')}
          </Text>
        ) : null}
        {error ? (
          <View
            testID="room-add-agent-error"
            style={[s.errorBanner, { backgroundColor: `${colors.error}10` }]}
          >
            <Text style={[s.errorText, { color: colors.error }]}>
              {t(
                error.kind === 'load'
                  ? 'spaces_agents_load_failed'
                  : error.kind === 'connectivity'
                    ? 'relay_agent_init_unavailable'
                    : 'spaces_add_agent_failed',
              )}
            </Text>
            <Pressable
              testID="room-add-agent-retry"
              disabled={busy !== null}
              accessibilityRole="button"
              onPress={() => {
                if (error.kind === 'load') {
                  void loadAgents()
                  return
                }
                if (error.kind === 'connectivity') {
                  void accountRuntime.reconnect('manual')
                  return
                }
                void submit()
              }}
            >
              <Text style={[s.retryText, { color: colors.brand }]}>
                {t(error.kind === 'connectivity' ? 'reconnect_action' : 'retry')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      <View style={[s.footer, { borderTopColor: colors.border }]}>
        <Text
          testID="room-add-agent-risk-note"
          style={[
            s.riskNote,
            { color: Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary },
          ]}
        >
          {t('agents_room_risk_note')}
        </Text>
        <Pressable
          testID="room-add-agents-submit"
          accessibilityRole="button"
          accessibilityState={{
            disabled: !pendingAgents.length || loading || busy !== null || error?.kind === 'load',
            busy: busy !== null,
          }}
          disabled={!pendingAgents.length || loading || busy !== null || error?.kind === 'load'}
          onPress={() => void submit()}
          style={[
            s.submit,
            {
              backgroundColor: colors.brand,
              opacity:
                !pendingAgents.length || loading || busy !== null || error?.kind === 'load'
                  ? 0.4
                  : 1,
            },
          ]}
        >
          {busy !== null ? <ActivityIndicator color={colors.bg} /> : null}
          <Text style={[s.submitText, { color: colors.bg }]}>
            {pendingAgents.length
              ? t('agents_room_add_selected', { count: pendingAgents.length })
              : t('agents_room_select_prompt')}
          </Text>
        </Pressable>
      </View>
      <BottomSheet
        isOpen={Boolean(choosingModeAgent)}
        onClose={() => setChoosingModeAgentId(null)}
        title={
          choosingModeAgent
            ? `${choosingModeAgent.displayName} · ${t('spaces_agent_work_mode')}`
            : t('spaces_agent_work_mode')
        }
        preferDialogOnWeb
        avoidKeyboard={false}
      >
        {choosingModeAgent ? (
          <View accessibilityRole="radiogroup" style={s.modeOptions}>
            {WORK_MODES.map((mode, index) => {
              const modeSelected = (activationModes[choosingModeAgent.id] ?? 'auto_follow') === mode
              return (
                <Pressable
                  key={mode}
                  testID={`room-agent-work-mode-${choosingModeAgent.id}-${mode}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: modeSelected, disabled: busy !== null }}
                  disabled={busy !== null}
                  onPress={() => chooseMode(choosingModeAgent.id, mode)}
                  style={({ pressed }) => [
                    s.modeOption,
                    index < WORK_MODES.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                    pressed && { backgroundColor: colors.surfaceHover },
                  ]}
                >
                  <View style={s.modeSelectionMark}>
                    {modeSelected ? (
                      <Ionicons name="checkmark" size={20} color={colors.brand} />
                    ) : null}
                  </View>
                  <Text
                    style={[s.modeOptionText, { color: modeSelected ? colors.brand : colors.text }]}
                  >
                    {t(`spaces_agent_mode_${mode}`)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        ) : null}
      </BottomSheet>
    </SafeAreaView>
  )
}
const s = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 28 },
  choiceIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  riskNote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 10,
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  submit: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  row: {
    minHeight: 68,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  agentName: { flex: 1, ...mobileTypography.listTitle },
  existingLabel: { flexShrink: 0, ...mobileTypography.secondary },
  modeRow: {
    minHeight: 52,
    paddingLeft: 72,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modeLabel: { flex: 1, ...mobileTypography.body },
  modeValue: { maxWidth: '45%', ...mobileTypography.secondary },
  modeOptions: { width: '100%' },
  modeOption: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modeSelectionMark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  modeOptionText: { flex: 1, ...mobileTypography.body },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { textAlign: 'center', padding: 28 },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  retryText: { fontSize: 13, fontWeight: '600' },
})
