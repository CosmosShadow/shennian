// @arch docs/architecture/launch-config.md
// @arch docs/features/desktop-personal-session-navigation.md
// @test ../../__tests__/desktop-session-launch.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { getAgentDisplayName } from '@shennian/shared'
import {
  filterAvailableAgentTypes,
  type AgentType,
  type Machine,
  type ModelInfo,
} from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { getLastLaunch, getLastPreferredModel, saveLastLaunch } from '../../utils/launchStorage'
import { getMachineAgentModels, isDefaultModel } from '../../utils/models'
import { useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import {
  desktopAccountActions,
  getDesktopAccountRuntimeState,
  useDesktopAccountSync,
} from '../desktop-control/useDesktopAccountSync'
import { resolveInitialLaunchAgent } from '../machines/utils/launch'
import { buildSessionLaunchPayload } from '../machines/utils/sessionLaunchPayload'
import { createDesktopLaunchSubmission } from './desktopSessionLaunch'
import type { MachineListSurfaceState } from '../machines/services/machineListState'
import { useDesktopControlState } from '../desktop-control/hooks/useDesktopControlState'

export function selectDesktopLaunchModel(
  models: ModelInfo[],
  explicit: string | null | undefined,
  saved: string | null,
): string | null {
  const preferred = explicit === undefined ? saved : explicit
  if (preferred === null) return null
  const model = models.find((value) => value.id === preferred)
  return model && !isDefaultModel(model) ? model.id : null
}

export function useDesktopProjectLaunchState(options: {
  machine: Machine
  workDir: string
  initialAgentType?: AgentType
  initialModelId?: string | null
  inventorySurface?: MachineListSurfaceState
  onLaunched(): void
}) {
  const { machine, workDir, initialAgentType, initialModelId } = options
  const router = useRouter()
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const accountId = user?.id
  const runtime = useDesktopAccountSync()
  const relay = useRelayConnectivitySnapshot()
  const desktop = useDesktopControlState()
  const agentList = useMemo<AgentType[]>(
    () => filterAvailableAgentTypes(machine.agentList).filter((agent) => agent !== 'pi'),
    [machine.agentList],
  )
  const [selectedAgent, setAgent] = useState<AgentType>(() =>
    resolveInitialLaunchAgent({
      agentList,
      initialAgentType,
      lastAgentType: getLastLaunch(machine.id)?.agentType,
    }),
  )
  const availableModels = useMemo(
    () => getMachineAgentModels(machine, selectedAgent),
    [machine, selectedAgent],
  )
  const [selectedModel, setModel] = useState<string | null>(() =>
    selectDesktopLaunchModel(
      getMachineAgentModels(machine, selectedAgent),
      initialModelId,
      getLastPreferredModel(machine.id, selectedAgent),
    ),
  )
  const [launching, setLaunching] = useState(false)
  const [refreshingTools, setRefreshingTools] = useState(false)
  const [error, setError] = useState('')
  const current = useRef({ machine, onLaunched: options.onLaunched, selectedAgent })
  current.current = { machine, onLaunched: options.onLaunched, selectedAgent }
  const scope = useMemo(() => ({ active: false, pending: false }), [accountId, machine.id, workDir])
  const isCurrent = () =>
    scope.active && Boolean(accountId) && useAuthStore.getState().user?.id === accountId
  const submission = useMemo(
    () =>
      createDesktopLaunchSubmission({
        isCurrent: () =>
          scope.active && Boolean(accountId) && useAuthStore.getState().user?.id === accountId,
        create: (input) => desktopAccountActions.createSession(input),
        onCommitted: (session, input) => {
          saveLastLaunch(input.machineId, {
            agentType: input.agentType,
            workDir: input.workDir,
            modelId: input.modelId ?? null,
            sessionMode: input.sessionMode,
          })
          current.current.onLaunched()
          router.navigate(`/(main)/chat/${session.id}`)
        },
      }),
    [scope, accountId, router],
  )
  useEffect(() => {
    scope.active = true
    return () => {
      scope.active = false
    }
  }, [scope, submission])
  useEffect(() => {
    if (agentList.includes(selectedAgent) || !agentList[0]) return
    const nextAgent = agentList[0]
    setAgent(nextAgent)
    setModel(
      selectDesktopLaunchModel(
        getMachineAgentModels(machine, nextAgent),
        initialModelId,
        getLastPreferredModel(machine.id, nextAgent),
      ),
    )
  }, [agentList, initialModelId, machine, selectedAgent])
  // A projection refresh may invalidate a choice, but never restores an old saved preference over user input.
  useEffect(() => {
    if (selectedModel !== null && !availableModels.some((model) => model.id === selectedModel))
      setModel(null)
  }, [availableModels, selectedModel])
  const remember = (agentType: AgentType, modelId: string | null) => {
    if (!isCurrent()) return
    saveLastLaunch(machine.id, { agentType, workDir, modelId, sessionMode: 'standard' })
  }
  const localClientMissing =
    desktop.connectorSource?.kind === 'missing' && desktop.status?.machineId === machine.id
  const canLaunch = Boolean(
    !localClientMissing &&
    accountId &&
    runtime.accountId === accountId &&
    runtime.bootstrapped &&
    runtime.status?.phase === 'ready' &&
    machine.online &&
    !machine.remoteAccessDisabledAt &&
    agentList.includes(selectedAgent) &&
    workDir.trim(),
  )
  const blockedReason = relay?.phase === 'blocked' ? relay.reason : null
  const availabilityKey =
    canLaunch || error
      ? null
      : localClientMissing
        ? 'desktop_client_missing_body'
        : agentList.length === 0
          ? 'device_auth_no_agents'
          : !machine.online
            ? 'machine_offline_error'
            : machine.remoteAccessDisabledAt
              ? 'agents_validation_runtime_unavailable'
              : blockedReason === 'version_unsupported'
                ? 'relay_version_unsupported'
                : blockedReason === 'auth_required' || blockedReason === 'permission_revoked'
                  ? 'machines_permission_body'
                  : options.inventorySurface === 'error'
                    ? 'machines_cached_load_failed_body'
                    : options.inventorySurface === 'offline'
                      ? 'machines_cached_offline_body'
                      : runtime.status?.phase === 'offline'
                        ? 'machine_offline_error'
                        : 'connecting'
  const handleLaunch = async () => {
    if (!isCurrent() || scope.pending) return
    if (localClientMissing) {
      setError(t('desktop_client_missing_body'))
      return
    }
    const state = getDesktopAccountRuntimeState()
    const latest = current.current
    if (
      state.accountId !== accountId ||
      state.status?.phase !== 'ready' ||
      !latest.machine.online ||
      latest.machine.remoteAccessDisabledAt ||
      !filterAvailableAgentTypes(latest.machine.agentList).includes(selectedAgent)
    ) {
      setError(t('machine_offline_error'))
      return
    }
    scope.pending = true
    setLaunching(true)
    setError('')
    try {
      await submission.submit(
        buildSessionLaunchPayload({
          machineId: machine.id,
          agentType: selectedAgent,
          workDir,
          modelId: selectedModel,
          sessionMode: 'standard',
        }),
      )
    } catch {
      if (isCurrent()) setError(t('error_unknown'))
    } finally {
      scope.pending = false
      if (isCurrent()) setLaunching(false)
    }
  }
  const handleRefreshTools = async () => {
    if (!isCurrent() || scope.pending || !machine.online || machine.remoteAccessDisabledAt) return
    scope.pending = true
    setRefreshingTools(true)
    setError('')
    try {
      await desktopAccountActions.requestMachineOperation(
        'machine.agents.refresh',
        machine.id,
        {},
        { connectTimeoutMs: 15_000, responseTimeoutMs: 120_000 },
      )
    } catch {
      if (isCurrent()) setError(t('error_unknown'))
    } finally {
      scope.pending = false
      if (isCurrent()) setRefreshingTools(false)
    }
  }
  return {
    agentList,
    availableModels,
    selectedAgent,
    selectedModel,
    launching,
    refreshingTools,
    error,
    canLaunch,
    availabilityKey,
    getAgentLabel: (agent: AgentType) =>
      getAgentDisplayName(
        agent,
        machine.agents?.find((value) => value.type === agent)?.display?.name,
      ),
    handleAgentSelect: (agent: AgentType) => {
      if (launching || !isCurrent() || !agentList.includes(agent)) return
      const model = selectDesktopLaunchModel(
        getMachineAgentModels(machine, agent),
        undefined,
        getLastPreferredModel(machine.id, agent),
      )
      setAgent(agent)
      setModel(model)
      remember(agent, model)
    },
    handleModelSelect: (model: string | null) => {
      if (
        launching ||
        !isCurrent() ||
        (model !== null && !availableModels.some((value) => value.id === model))
      )
        return
      setModel(model)
      remember(selectedAgent, model)
    },
    handleRefreshTools,
    handleLaunch,
  }
}
