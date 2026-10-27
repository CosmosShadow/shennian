// @arch docs/architecture/app/modular-features.md#聊天-feature

import { useCallback, useState } from 'react'
import { Alert, Platform } from 'react-native'
import { isSessionPinned, hasSessionUnread } from '@shennian/shared'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type AgentType,
  type NianSession,
} from '@shennian/wire'
import { sessionAccountClient } from '../../sessions/sessionAccountClient'
import { useAuthStore } from '../../../config/auth'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { saveLastLaunch } from '../../../utils/launchStorage'
import { removeChatDraft } from '../utils/draftStorage'
import { removeChatOutboundSession } from '../utils/outboundStorage'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'

type Options = {
  sessionId: string
  session: NianSession | undefined
  machineId: string | null
  daemonInstallationId: string | null | undefined
  workDir: string
  agentType: AgentType
  t: (key: string) => string
  upsertSession: (session: NianSession) => void
  router: { replace: (href: string) => void }
}

export function useChatSessionActions({
  sessionId,
  session,
  machineId,
  daemonInstallationId,
  workDir,
  agentType,
  t,
  upsertSession,
  router,
}: Options) {
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const [showSessionDetails, setShowSessionDetails] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [modelSelectorBusy, setModelSelectorBusy] = useState(false)
  const [modelRefreshBusy, setModelRefreshBusy] = useState(false)
  const [sessionRefreshBusy, setSessionRefreshBusy] = useState(false)
  const networkStatus = useNetworkStatus()

  const openRenameModal = useCallback(() => {
    setShowSessionDetails(false)
    setRenameInput(session?.title ?? '')
    setShowRenameModal(true)
  }, [session?.title])

  const confirmRename = useCallback(async () => {
    const trimmed = renameInput.trim()
    if (!trimmed || !sessionId) {
      setShowRenameModal(false)
      return
    }
    setRenameSaving(true)
    try {
      if (session?.localCreationState === 'draft') {
        await accountRuntime.persistSession({ ...session, title: trimmed })
      } else {
        await sessionAccountClient.updateSession(sessionId, { title: trimmed })
      }
      if (session) upsertSession({ ...session, title: trimmed })
      setShowRenameModal(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      Alert.alert(t('rename_failed'), message)
    } finally {
      setRenameSaving(false)
    }
  }, [renameInput, session, sessionId, t, upsertSession])

  const handleDeleteSession = useCallback(async () => {
    if (!sessionId) return
    if (networkStatus === 'offline' && session?.localCreationState !== 'draft') {
      Alert.alert(t('delete_session_failed'), t('delete_session_offline'))
      return
    }
    try {
      await accountRuntime.deleteSession(sessionId, 'auto')
      removeChatDraft(accountId, sessionId)
      removeChatOutboundSession(accountId, sessionId)
      router.replace('/(main)')
    } catch (err) {
      const isForbidden =
        err instanceof Error && 'status' in err && (err as { status?: number }).status === 403
      const message = isForbidden
        ? t('delete_session_forbidden')
        : err instanceof Error
          ? err.message
          : String(err)
      Alert.alert(t('delete_session_failed'), message)
    }
  }, [accountId, networkStatus, router, session, sessionId, t])

  const handleDeletePress = useCallback(() => {
    setShowSessionDetails(false)
    if (Platform.OS === 'web') {
      setShowDeleteConfirm(true)
      return
    }
    Alert.alert(t('delete_session'), t('confirm_delete_session'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm_delete_session_action'),
        style: 'destructive',
        onPress: () => void handleDeleteSession(),
      },
    ])
  }, [handleDeleteSession, t])

  const rememberLaunchConfig = useCallback(
    (nextAgentType: AgentType, nextModelId?: string | null) => {
      if (!machineId) return
      saveLastLaunch(machineId, {
        agentType: nextAgentType,
        workDir,
        modelId: nextModelId ?? null,
      })
    },
    [machineId, workDir],
  )

  const handleModelSelect = useCallback(
    async (modelId: string) => {
      if (!sessionId || !session || modelSelectorBusy) return
      if (session.sessionMode === 'manager' || agentType === 'manager') {
        setShowModelSelector(false)
        return
      }
      if (session.modelId === modelId) {
        setShowModelSelector(false)
        return
      }

      const previousModelId = session.modelId ?? null
      const nextSession: NianSession = {
        ...session,
        modelId,
        modelSource: 'session',
        updatedAt: new Date().toISOString(),
      }

      setModelSelectorBusy(true)
      setShowModelSelector(false)
      upsertSession(nextSession)
      rememberLaunchConfig(agentType, modelId)

      try {
        if (session.localCreationState === 'draft') {
          await accountRuntime.persistSession(nextSession)
        } else {
          await sessionAccountClient.updateSession(sessionId, { modelId, modelSource: 'session' })
        }
      } catch (err) {
        upsertSession({ ...nextSession, modelId: previousModelId })
        Alert.alert(t('model_switch_failed'), err instanceof Error ? err.message : String(err))
      } finally {
        setModelSelectorBusy(false)
      }
    },
    [agentType, modelSelectorBusy, rememberLaunchConfig, session, sessionId, t, upsertSession],
  )

  const handleFollowAgentModel = useCallback(async () => {
    if (!sessionId || !session?.agentIdentityId || modelSelectorBusy) return
    if (session.modelSource === 'agent') {
      setShowModelSelector(false)
      return
    }
    const previousSource = session.modelSource ?? 'session'
    const nextSession: NianSession = {
      ...session,
      modelSource: 'agent',
      updatedAt: new Date().toISOString(),
    }
    setModelSelectorBusy(true)
    setShowModelSelector(false)
    upsertSession(nextSession)
    try {
      await sessionAccountClient.updateSession(sessionId, { modelSource: 'agent' })
    } catch (err) {
      upsertSession({ ...nextSession, modelSource: previousSource })
      Alert.alert(t('model_switch_failed'), err instanceof Error ? err.message : String(err))
    } finally {
      setModelSelectorBusy(false)
    }
  }, [modelSelectorBusy, session, sessionId, t, upsertSession])

  const handleRefreshModels = useCallback(async () => {
    if (!machineId || modelRefreshBusy || modelSelectorBusy) return
    setModelRefreshBusy(true)
    try {
      await accountRuntime.requestMachine(
        machineId,
        'models.refresh',
        {},
        { connectTimeoutMs: 15_000, responseTimeoutMs: 120_000 },
      )
    } catch (err) {
      Alert.alert(t('model_refresh_failed'), err instanceof Error ? err.message : String(err))
    } finally {
      setModelRefreshBusy(false)
    }
  }, [machineId, modelRefreshBusy, modelSelectorBusy, t])

  const handleRefreshSession = useCallback(async (): Promise<'full' | 'cloud'> => {
    if (!sessionId || sessionRefreshBusy) return 'cloud'
    setShowSessionDetails(false)
    setSessionRefreshBusy(true)
    let remoteScanned = false
    try {
      if (machineId && daemonInstallationId) {
        try {
          await accountRuntime.requestMachine(
            machineId,
            'session.refresh',
            {
                protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
                dataEpoch: SESSION_SYNC_DATA_EPOCH,
                daemonInstallationId,
                sessionId,
                agentType: session?.agentType,
                agentSessionId: session?.agentSessionId ?? null,
                workDir: session?.workDir,
            },
            { connectTimeoutMs: 5_000, responseTimeoutMs: 90_000 },
          )
          remoteScanned = true
        } catch {
          remoteScanned = false
        }
      }

      return remoteScanned ? 'full' : 'cloud'
    } finally {
      setSessionRefreshBusy(false)
    }
  }, [daemonInstallationId, machineId, session, sessionId, sessionRefreshBusy])

  const isPinned = session ? isSessionPinned(session) : false
  const sessionHasUnread = session ? hasSessionUnread(session) : false

  const handleTogglePin = useCallback(() => {
    setShowSessionDetails(false)
    accountRuntime
      .updateSessionUserState(sessionId, { pinned: !isPinned })
      .catch(() => {})
  }, [sessionId, isPinned])

  const handleToggleUnread = useCallback(() => {
    setShowSessionDetails(false)
    if (sessionHasUnread) {
      accountRuntime
        .markSessionRead(sessionId, new Date().toISOString())
        .catch(() => {})
      return
    }
    accountRuntime
      .updateSessionUserState(sessionId, { manualUnread: true })
      .catch(() => {})
  }, [sessionId, sessionHasUnread])

  return {
    showSessionDetails,
    setShowSessionDetails,
    showRenameModal,
    setShowRenameModal,
    renameInput,
    setRenameInput,
    renameSaving,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showModelSelector,
    setShowModelSelector,
    modelSelectorBusy,
    modelRefreshBusy,
    sessionRefreshBusy,
    isPinned,
    sessionHasUnread,
    openRenameModal,
    confirmRename,
    handleDeletePress,
    handleDeleteSession,
    handleTogglePin,
    handleToggleUnread,
    handleModelSelect,
    handleFollowAgentModel,
    handleRefreshModels,
    handleRefreshSession,
  }
}
