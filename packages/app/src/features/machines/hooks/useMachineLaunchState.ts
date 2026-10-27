// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { getAgentDisplayName, hasCapability, useSessionsStore } from '@shennian/shared'
import {
  filterAvailableAgentTypes,
  type AgentType,
  type Machine,
  type SessionMode,
} from '@shennian/wire'
import { useAuthStore } from '../../../config/auth'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { getLastLaunch, getLastPreferredModel, saveLastLaunch } from '../../../utils/launchStorage'
import { getMachineAgentModels, resolveModelId } from '../../../utils/models'
import { getDirLabel, resolveInitialLaunchAgent } from '../utils/launch'
import { buildSessionLaunchPayload } from '../utils/sessionLaunchPayload'
import { machineAccountClient } from '../machineAccountClient'

type UseMachineLaunchStateOptions = {
  machine: Machine
  homeLabel: string
  includeModelSelection?: boolean
  allowManagerMode?: boolean
  initialWorkDir?: string
  initialAgentType?: AgentType
  initialModelId?: string | null
  onLaunchError?: (message: string) => void
  onLaunched?: () => void
}

export function useMachineLaunchState({
  machine,
  homeLabel,
  includeModelSelection = false,
  allowManagerMode = false,
  initialWorkDir,
  initialAgentType,
  initialModelId,
  onLaunchError,
  onLaunched,
}: UseMachineLaunchStateOptions) {
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const initialLaunch = getLastLaunch(machine.id)
  const agentList = useMemo<AgentType[]>(() => {
    const availableAgents = filterAvailableAgentTypes(machine.agentList).filter(
      (agent) => agent !== 'pi',
    )
    return availableAgents.length > 0 ? availableAgents : ['codex']
  }, [machine.agentList, user])
  const initialAgent = resolveInitialLaunchAgent({
    agentList,
    initialAgentType,
    lastAgentType: initialLaunch?.agentType,
  })
  const agentDisplayNames = useMemo(
    () => new Map((machine.agents ?? []).map((agent) => [agent.type, agent.display?.name])),
    [machine.agents],
  )
  const getAgentLabel = useCallback(
    (agentType: AgentType) => getAgentDisplayName(agentType, agentDisplayNames.get(agentType)),
    [agentDisplayNames],
  )
  const upsertSession = useSessionsStore((store) => store.upsertSession)
  const [selectedAgent, setSelectedAgent] = useState<AgentType>(initialAgent)
  useEffect(() => {
    if (!agentList.includes(selectedAgent)) setSelectedAgent(agentList[0]!)
  }, [agentList, selectedAgent])
  const supportsManagerMode = useMemo(
    () =>
      allowManagerMode &&
      hasCapability(user, 'manager_agent') &&
      Boolean(machine.agents?.find((agent) => agent.type === selectedAgent)?.supportsManagerMode),
    [allowManagerMode, machine.agents, selectedAgent, user],
  )
  const [sessionMode, setSessionMode] = useState<SessionMode>(() =>
    allowManagerMode && initialLaunch?.sessionMode === 'manager' ? 'manager' : 'standard',
  )
  const [workDir, setWorkDir] = useState(initialWorkDir || initialLaunch?.workDir || '~')
  const [browseOpen, setBrowseOpen] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')

  const getSavedModelId = useCallback(
    (agentType: AgentType) => {
      return (
        getLastPreferredModel(machine.id, agentType) ??
        (initialLaunch?.agentType === agentType ? (initialLaunch.modelId ?? null) : null)
      )
    },
    [initialLaunch?.agentType, initialLaunch?.modelId, machine.id],
  )

  const availableModels = useMemo(
    () => (includeModelSelection ? getMachineAgentModels(machine, selectedAgent) : []),
    [includeModelSelection, machine, selectedAgent],
  )

  const [selectedModel, setSelectedModel] = useState<string | undefined>(() => {
    if (!includeModelSelection) return undefined
    return resolveModelId(
      getMachineAgentModels(machine, initialAgent),
      initialModelId ?? getSavedModelId(initialAgent),
    )
  })

  useEffect(() => {
    if (sessionMode === 'manager' && !supportsManagerMode) setSessionMode('standard')
  }, [sessionMode, supportsManagerMode])

  useEffect(() => {
    if (!includeModelSelection) return
    const nextModelId = resolveModelId(availableModels, getSavedModelId(selectedAgent))
    setSelectedModel((currentModel) => (currentModel === nextModelId ? currentModel : nextModelId))
  }, [availableModels, getSavedModelId, includeModelSelection, selectedAgent])

  const persistLaunch = useCallback(
    (agentType: AgentType, nextDir: string, modelId?: string | null) => {
      saveLastLaunch(machine.id, {
        agentType,
        workDir: nextDir,
        ...(modelId !== undefined ? { modelId } : {}),
      })
    },
    [machine.id],
  )

  const handleAgentSelect = useCallback(
    (agentType: AgentType) => {
      setSelectedAgent(agentType)

      if (!includeModelSelection) {
        persistLaunch(agentType, workDir)
        return
      }

      const nextModelId = resolveModelId(
        getMachineAgentModels(machine, agentType),
        getSavedModelId(agentType),
      )
      setSelectedModel(nextModelId)
      persistLaunch(agentType, workDir, nextModelId ?? null)
    },
    [getSavedModelId, includeModelSelection, machine, persistLaunch, workDir],
  )

  const handleSessionModeSelect = useCallback(
    (mode: SessionMode) => {
      if (mode === 'manager' && !supportsManagerMode) return
      setSessionMode(mode)
      saveLastLaunch(machine.id, {
        agentType: selectedAgent,
        workDir,
        modelId: includeModelSelection ? (selectedModel ?? null) : undefined,
        sessionMode: mode,
      })
    },
    [includeModelSelection, machine.id, selectedAgent, selectedModel, supportsManagerMode, workDir],
  )

  const handleModelSelect = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId)
      persistLaunch(selectedAgent, workDir, modelId)
    },
    [persistLaunch, selectedAgent, workDir],
  )

  const handleDirSelect = useCallback(
    (path: string) => {
      setWorkDir(path)
      persistLaunch(
        selectedAgent,
        path,
        includeModelSelection ? (selectedModel ?? null) : undefined,
      )
      setBrowseOpen(false)
    },
    [includeModelSelection, persistLaunch, selectedAgent, selectedModel],
  )

  const handleLaunch = useCallback(async () => {
    const finalDir = workDir.trim()
    if (!finalDir) return

    setLaunching(true)
    setError('')

    try {
      const sessionPayload = buildSessionLaunchPayload({
        machineId: machine.id,
        agentType: selectedAgent,
        workDir: finalDir,
        sessionMode,
        modelId: includeModelSelection ? selectedModel : undefined,
      })

      const createdSession = await machineAccountClient.createSession(sessionPayload)

      const session = {
        ...createdSession,
        machineName: createdSession.machineName?.trim() ? createdSession.machineName : machine.name,
      }

      saveLastLaunch(machine.id, {
        agentType: selectedAgent,
        workDir: finalDir,
        modelId: includeModelSelection ? (selectedModel ?? null) : undefined,
        sessionMode,
        managerDefaultWorkerAgentType: null,
        managerDefaultWorkerModelId: null,
      })
      await accountRuntime.persistSession(session)
      upsertSession(session)
      onLaunched?.()
      router.navigate(`/(main)/chat/${session.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      onLaunchError?.(message)
    } finally {
      setLaunching(false)
    }
  }, [
    includeModelSelection,
    machine.id,
    machine.name,
    onLaunchError,
    onLaunched,
    router,
    selectedAgent,
    selectedModel,
    sessionMode,
    upsertSession,
    workDir,
  ])

  return {
    agentList,
    getAgentLabel,
    availableModels,
    browseOpen,
    dirLabel: getDirLabel(workDir, homeLabel),
    error,
    handleAgentSelect,
    handleDirSelect,
    handleLaunch,
    handleModelSelect,
    handleSessionModeSelect,
    launching,
    selectedAgent,
    selectedModel,
    sessionMode,
    supportsManagerMode,
    setBrowseOpen,
    setError,
    setWorkDir,
    workDir,
  }
}
