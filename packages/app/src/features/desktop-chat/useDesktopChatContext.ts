// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/desktop-chat-controller.test.ts

import { useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import {
  filterManagerSubstrateSessions,
  getAgentDisplayName,
  useMachinesStore,
  useSessionsStore,
} from '@shennian/shared'
import type { AcpSessionOptions, AgentType, AgentWorkspace, NianSession } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { getMachineAgentModels, resolveModel } from '../../utils/models'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { useReasoningEffortPreference } from '../chat/hooks/useReasoningEffortPreference'
import { desktopAgentPort } from '../desktop-agents/desktopAgentPort'
import { desktopChatDataPort } from './desktopChatDataPort'
import { resolveDesktopModelControl } from './desktopChatContextControlState'
import type { LinkedRoomBindingView } from '../rooms/types'

export function useDesktopChatContext({
  currentRunId,
  sessionId,
  t,
  workspaceAgentIdentityId,
  workspaceRoomId,
}: {
  currentRunId: string | null
  sessionId: string
  t: TFunction
  workspaceAgentIdentityId?: string
  workspaceRoomId?: string
}) {
  const [linkedRoomBinding, setLinkedRoomBinding] = useState<LinkedRoomBindingView | null>(null)
  const [managedAgentProfile, setManagedAgentProfile] = useState<AgentWorkspace | null>(null)
  const [managedAgentProfileState, setManagedAgentProfileState] = useState<
    'idle' | 'loading' | 'ready' | 'failed'
  >('idle')
  const [roomSessionState, setRoomSessionState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    'idle',
  )
  const [acpSessionOptions, setAcpSessionOptions] = useState<AcpSessionOptions | null>(null)
  const sessions = useSessionsStore((store) => store.sessions)
  const upsertSession = useSessionsStore((store) => store.upsertSession)
  const indexedSession = sessions.find((item) => item.id === sessionId)
  const [directSessionLoading, setDirectSessionLoading] = useState(true)
  const [sessionRetry, setSessionRetry] = useState(0)
  const retrySession = () => setSessionRetry(value => value + 1)
  const [directSession, setDirectSession] = useState<NianSession | null>(null)
  const session = indexedSession ?? (directSession?.id === sessionId ? directSession : undefined)
  const effectiveAgentIdentityId = session?.agentIdentityId || workspaceAgentIdentityId

  useEffect(() => {
    if (indexedSession) {
      setDirectSession(null)
      setDirectSessionLoading(false)
      return
    }
    let active = true
    setDirectSessionLoading(true)
    void desktopChatDataPort.getSession(sessionId)
      .then((loaded) => {
        if (active) { setDirectSession(loaded); setDirectSessionLoading(false) }
      })
      .catch(() => {
        if (active) { setDirectSession(null); setDirectSessionLoading(false) }
      })
    return () => {
      active = false
    }
  }, [indexedSession, sessionId, sessionRetry])

  useEffect(() => {
    if (!workspaceRoomId) {
      setRoomSessionState('ready')
      return
    }
    let active = true
    setRoomSessionState('loading')
    void desktopChatDataPort
      .getSession(sessionId)
      .then((roomSession) => {
        if (!active) return
        if (workspaceAgentIdentityId && roomSession.agentIdentityId !== workspaceAgentIdentityId) {
          setRoomSessionState('failed')
          return
        }
        upsertSession(roomSession)
        setRoomSessionState('ready')
      })
      .catch(() => {
        if (active) setRoomSessionState('failed')
      })
    return () => {
      active = false
    }
  }, [sessionId, upsertSession, workspaceAgentIdentityId, workspaceRoomId])

  useEffect(() => {
    let active = true
    const agentIdentityId = effectiveAgentIdentityId
    setManagedAgentProfile(null)
    setManagedAgentProfileState(agentIdentityId ? 'loading' : 'ready')
    if (!agentIdentityId)
      return () => {
        active = false
      }
    void desktopAgentPort
      .getAgent(agentIdentityId)
      .then((agent) => {
        if (!active) return
        setManagedAgentProfile(agent)
        setManagedAgentProfileState('ready')
      })
      .catch(() => {
        if (active) setManagedAgentProfileState('failed')
      })
    return () => {
      active = false
    }
  }, [effectiveAgentIdentityId])

  useEffect(() => {
    let active = true
    setLinkedRoomBinding(null)
    void desktopChatDataPort
      .getRoomBinding(sessionId)
      .then((binding) => {
        if (active) setLinkedRoomBinding(binding)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [sessionId])

  const currentUserId = useAuthStore((store) => store.user?.id ?? null)
  const canManageSession =
    !!session && (session.canManage ?? (!!currentUserId && session.userId === currentUserId))
  const readOnlySession = !!session && !canManageSession
  const sessionOwnerName =
    session?.ownerName ||
    session?.ownerPhone ||
    session?.ownerEmail ||
    t('organization_member_unnamed')
  const machineId = session?.machineId ?? null
  const agentType: AgentType =
    (session?.agentType as AgentType | undefined) ??
    managedAgentProfile?.runtimeAdapter ??
    (effectiveAgentIdentityId ? 'codex' : 'claude')
  const managedConversationTitle = effectiveAgentIdentityId
    ? [linkedRoomBinding?.agentDisplayName, linkedRoomBinding?.room.name]
        .filter(Boolean)
        .join(' · ')
    : ''
  const hasTitle = Boolean(managedConversationTitle || session?.title)
  const title = managedConversationTitle || session?.title || t('untitled_conversation')
  const workDir = session?.workDir ?? ''
  const sessionListProjection = useMemo(
    () =>
      filterManagerSubstrateSessions(sessions)
        .filter((item) => item.workDir === workDir && item.agentType !== 'manager')
        .slice(0, 80)
        .map((item) => ({
          id: item.id,
          machineId: item.machineId,
          userId: item.userId,
          agentType: item.agentType,
          agentSessionId: item.agentSessionId,
          modelId: item.modelId,
          managerDefaultWorkerAgentType: item.managerDefaultWorkerAgentType,
          managerDefaultWorkerModelId: item.managerDefaultWorkerModelId,
          title: item.title,
          status: item.status,
          workDir: item.workDir,
          lastMessagePreview: item.lastMessagePreview,
          lastActivityAt: item.lastActivityAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          deletedAt: item.deletedAt,
          machineName: item.machineName,
          ownerName: item.ownerName,
          ownerPhone: item.ownerPhone,
          ownerEmail: item.ownerEmail,
          canManage: item.canManage,
          sharedMachineSession: item.sharedMachineSession,
          activity: item.activity,
          externalChannel: item.externalChannel,
        })),
    [sessions, workDir],
  )
  const agentLabel = getAgentDisplayName(agentType)
  const machines = useMachinesStore((store) => store.machines)
  const machine = machines.find((item) => item.id === machineId)
  const machineName = machine?.name ?? session?.machineName ?? ''
  const machineOffline = machine?.online === false
  const availableModels = useMemo(() => {
    const detected = getMachineAgentModels(machine, agentType)
    if (!agentType.startsWith('acp:') || !acpSessionOptions) return detected
    if (acpSessionOptions.models.length) return acpSessionOptions.models
    if (!acpSessionOptions.modes.length) return detected
    return [
      {
        id: session?.modelId ?? 'agent-default',
        name: session?.modelId ?? t('agents_default_model'),
        isDefault: true,
        supportedReasoningEfforts: acpSessionOptions.modes,
      },
    ]
  }, [acpSessionOptions, agentType, machine, session?.modelId, t])
  const currentModel = useMemo(
    () =>
      resolveModel(
        availableModels,
        session?.modelSource === 'agent' ? session.agentDefaultModelId : session?.modelId,
      ),
    [availableModels, session?.agentDefaultModelId, session?.modelId, session?.modelSource],
  )
  const displayModels = useMemo(
    () => availableModels.map((model) => ({ ...model, name: model.name })),
    [availableModels],
  )
  const configuredModelId =
    session?.modelSource === 'agent' ? session.agentDefaultModelId : session?.modelId
  const currentModelLabel = currentModel
    ? currentModel.name
    : (configuredModelId ?? (effectiveAgentIdentityId ? t('agents_default_model') : ''))
  const managedRuntimeLoading = Boolean(
    effectiveAgentIdentityId &&
    (managedAgentProfileState === 'idle' ||
      managedAgentProfileState === 'loading' ||
      (workspaceRoomId && (roomSessionState === 'idle' || roomSessionState === 'loading'))),
  )
  const managedRuntimeLoadFailed = Boolean(
    effectiveAgentIdentityId &&
    (managedAgentProfileState === 'failed' || (workspaceRoomId && roomSessionState === 'failed')),
  )
  const effectiveModelId = currentModel?.id ?? configuredModelId ?? undefined
  const reasoning = useReasoningEffortPreference({ sessionId, agentType, currentModel, t })
  const isManagerSession = session?.sessionMode === 'manager' || agentType === 'manager'
  const { visible: canShowModelControl, canSwitch: canOpenModelSelector } = resolveDesktopModelControl({
    modelCount: availableModels.length,
    configuredModelId,
    canFollowAgentModel: Boolean(effectiveAgentIdentityId),
    manager: isManagerSession,
  })

  useEffect(() => {
    if (!agentType.startsWith('acp:') || !machineId || !sessionId || currentRunId) return
    let cancelled = false
    void accountRuntime
      .requestMachine(
        machineId,
        'agent.session-options.get',
        { agentType, sessionId },
        { connectTimeoutMs: 8_000, responseTimeoutMs: 15_000 },
      )
      .then((response) => {
        if (cancelled || !response?.ok || !response.payload) return
        const payload = response.payload as AcpSessionOptions
        if (Array.isArray(payload.models) && Array.isArray(payload.modes))
          setAcpSessionOptions(payload)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agentType, currentRunId, machineId, sessionId])

  return {
    directSessionLoading,
    retrySession,
    agentLabel,
    agentType,
    canManageSession,
    canOpenModelSelector,
    canShowModelControl,
    currentModelLabel,
    currentUserId,
    displayModels,
    effectiveAgentIdentityId,
    effectiveModelId,
    hasTitle,
    linkedRoomBinding,
    machine,
    machineId,
    machineName,
    machineOffline,
    managedAgentProfile,
    managedRuntimeLoadFailed,
    managedRuntimeLoading,
    readOnlySession,
    reasoning,
    session,
    sessionListProjection,
    sessionOwnerName,
    title,
    upsertSession,
    workDir,
  }
}
