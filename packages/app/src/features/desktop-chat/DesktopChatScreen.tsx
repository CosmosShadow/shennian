// @arch docs/architecture/app/modular-features.md#聊天-feature
// @arch docs/architecture/app/chat-composer-keyboard.md
// @arch docs/architecture/app/chat-draft-storage.md
// @arch docs/architecture/app/chat-voice-draft.md
// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @test src/__tests__/desktop-chat-controller.test.ts

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Keyboard } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getSessionLiveActivity, useChatStore, useSheetsStore } from '@shennian/shared'
import type { ChatWebViewHandle } from '../../components/chat'
import { useAccountMachine } from '../account-runtime/useAccountMachine'
import { useTheme } from '../../hooks/useTheme'
import { useChatSessionActions } from '../chat/hooks/useChatSessionActions'
import { useChatAttachmentPreviews } from '../chat/hooks/useChatAttachmentPreviews'
import { useChatSendController } from '../chat/hooks/useChatSendController'
import { useChatSessionHistory } from '../chat/hooks/useChatSessionHistory'
import { useChatUploads } from '../chat/hooks/useChatUploads'
import { useVoiceDraft } from '../chat/hooks/useVoiceDraft'
import { hasSendableComposerContent } from '../chat/utils/composerInput'
import { buildAgentInstallPrompt, isInstallableBuiltinAgentType } from '../machines/utils/launch'
import { shouldDisableChatVoiceInput } from '../chat/utils/screen'
import { canOpenWorkerSession } from '../chat/utils/workerSessionLink'
import { useToast } from '../../hooks/useToast'
import { useAgentCapabilities } from '../chat/hooks/useAgentCapabilities'
import { useChatComposerActions } from '../chat/hooks/useChatComposerActions'
import { useComposerBottomInset } from '../chat/hooks/useComposerBottomInset'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { ensureImageAttachmentPreview } from '../chat/utils/attachmentPreview'
import {
  useRelayConnectivityFeedbackStatus,
  useRelayConnectivitySnapshot,
} from '../../hooks/useAppConnectivityStatus'
import { useChatToolDetails } from '../chat/hooks/useChatToolDetails'
import { useDesktopChatContext } from './useDesktopChatContext'
import { desktopChatDataPort } from './desktopChatDataPort'
import { useDesktopChatScrollState } from './useDesktopChatScrollState'
import { useDesktopChatConnectivityActions } from './useDesktopChatConnectivityActions'
import { useDesktopChatFileActions } from './useDesktopChatFileActions'
import { useDesktopChatShortcuts } from './useDesktopChatShortcuts'
import type { DesktopChatScreenProps } from './DesktopChatScreen.types'
import { DesktopChatScreenView } from './DesktopChatScreenView'
import { readDesktopChatHistory } from './desktopChatHistory'
import { DesktopWorkerNavigation } from './DesktopWorkerNavigation'
import { getOfficialRoomLinkNavigationTarget } from '../rooms/roomNavigationTarget'

export function useDesktopChatScreenModel({
  sessionIdOverride,
  workspaceRoomId,
  workspaceAgentIdentityId,
  workspaceAgentName,
  workspaceAgentAvatar,
  workspaceAgentOwnerAvatar,
  workspaceAgentOwnerName,
  workspaceInitialScrollPosition,
  onWorkspaceScrollPositionChange,
  onOpenWorkerSession,
  embedded = false,
  hideHeader = false,
}: DesktopChatScreenProps = {}) {
  const routeParams = useLocalSearchParams<{
    sessionId: string
    installAgent?: string
  }>()
  const { installAgent } = routeParams
  const sessionId = sessionIdOverride || routeParams.sessionId
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const { colors, isDark } = useTheme()
  const { toast, showToast, hideToast } = useToast()
  const insets = useSafeAreaInsets()
  const composerBottomInset = useComposerBottomInset(insets.bottom)
  const [input, setInput] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [showComposerMenu, setShowComposerMenu] = useState(false)
  const textInputRef = useRef<import('react-native').TextInput>(null)
  const chatWebViewRef = useRef<ChatWebViewHandle>(null)
  const relayConnectivity = useRelayConnectivitySnapshot()
  const relayFeedbackStatus = useRelayConnectivityFeedbackStatus(relayConnectivity)
  const currentRunId = useChatStore((store) => store.currentRunId)
  const {
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
  } = useDesktopChatContext({
    currentRunId,
    sessionId,
    t,
    workspaceAgentIdentityId,
    workspaceRoomId,
  })
  const {
    canShowReasoningEffort,
    effectiveReasoningEffort,
    reasoningEfforts,
    currentReasoningLabel,
    setPreferredReasoningEffort,
  } = reasoning
  const messages = useChatStore((store) => store.messages)
  const hydratedMessages = useChatAttachmentPreviews(messages, machineId)
  const runPhase = useChatStore((store) => store.runPhase)
  const chatSessionId = useChatStore((store) => store.sessionId)
  const isTyping = useChatStore((store) => store.isTyping)
  const chatLoading = useChatStore((store) => store.loading)
  const addMessage = useChatStore((store) => store.addMessage)
  const setMessages = useChatStore((store) => store.setMessages)
  const hasMoreMessages = useChatStore((store) => store.hasMore)
  const prependMessages = useChatStore((store) => store.prependMessages)
  const setHasMore = useChatStore((store) => store.setHasMore)
  const updateMessageStatus = useChatStore((store) => store.updateMessageStatus)
  const updateMessageError = useChatStore((store) => store.updateMessageError)
  const startPendingRun = useChatStore((store) => store.startPendingRun)
  const clearPendingRun = useChatStore((store) => store.clearPendingRun)
  const clear = useChatStore((store) => store.clear)
  const setSessionIdFn = useChatStore((store) => store.setSessionId)
  const setChatLoading = useChatStore((store) => store.setLoading)
  const openFileDrawer = useSheetsStore((store) => store.openFileDrawer)
  const closeFileDrawer = useSheetsStore((store) => store.closeFileDrawer)
  const fileDrawerOpen = useSheetsStore((store) => store.fileDrawerOpen)

  const {
    loadingOlder,
    loadOlderMessages,
    pendingPresentationToken,
    acknowledgeLatestSnapshotPresented,
  } = useChatSessionHistory({
    readLocalHistory: readDesktopChatHistory,
    sessionId,
    session,
    messages,
    chatSessionId,
    isTyping,
    chatLoading,
    clear,
    closeFileDrawer,
    setSessionId: setSessionIdFn,
    setMessages,
    setChatLoading,
    setHasMore,
    prependMessages,
    workspaceOwnsRouteActivity: embedded && Boolean(workspaceRoomId),
  })

  useEffect(() => {
    if (!session) return
    const chatState = useChatStore.getState()
    if (chatState.sessionId !== sessionId) return

    // Room Workspace mounts the Agent conversation before its exact session index
    // request necessarily finishes. Reconcile again when that projection arrives so
    // a run already started from the group keeps its Stop control after switching in.
    chatState.restoreRunPhase(getSessionLiveActivity(session))
  }, [session?.activity, sessionId])

  const {
    handleScrollState,
    initialScrollPosition,
    scrollCommand,
    setScrollCommand,
    showScrollBtn,
  } = useDesktopChatScrollState({
    chatLoading,
    currentUserId,
    hasMoreMessages,
    loadOlderMessages,
    loadingOlder,
    onWorkspaceScrollPositionChange,
    sessionId,
    workspaceInitialScrollPosition,
  })

  const {
    uploadTasks,
    pendingAttachments,
    isUploading,
    cancelUpload,
    handleAttachWeb,
    handleAttachFolderWeb,
    handlePasteWeb,
    replacePendingAttachments,
    clearPendingAttachments,
  } = useChatUploads({ machineId, workDir, enabled: Boolean(session) })

  const {
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
    openRenameModal,
    confirmRename,
    handleDeletePress,
    handleDeleteSession,
    handleModelSelect,
    handleFollowAgentModel,
    handleRefreshModels,
    handleRefreshSession,
  } = useChatSessionActions({
    sessionId,
    session,
    machineId,
    daemonInstallationId: machine?.daemonInstallationId,
    workDir,
    agentType,
    t,
    upsertSession,
    router,
  })

  const openModelSelector = useCallback(() => {
    if (!canOpenModelSelector) return
    textInputRef.current?.blur()
    Keyboard.dismiss()
    setShowModelSelector(true)
  }, [canOpenModelSelector, setShowModelSelector])

  // Personal body events are consumed only by the scoped history client.
  // This relay handle remains for controls, tool detail and run activity.
  const relay = useAccountMachine(machineId)
  const relayState = relay.state
  const send = relay.send

  const { hydratedMessagesWithToolDetails, handleToolDetailRequest } = useChatToolDetails({
    daemonInstallationId: machine?.daemonInstallationId,
    machineId,
    machineOffline,
    messages: hydratedMessages,
    relayState,
    send,
    sessionId,
  })

  const handleAttachmentPreviewRequest = useCallback(
    async (request: { path: string; name?: string; mimeType?: string }) => {
      if (!machineId || !request.path) return null
      return ensureImageAttachmentPreview(machineId, {
        path: request.path,
        mimeType: request.mimeType || 'image/png',
      })
    },
    [machineId],
  )

  const openingWorkerRef = useRef(false)
  const handleWorkerSessionPress = useCallback(
    async (workerSessionId: string) => {
      if (!session || !currentUserId || openingWorkerRef.current) return
      openingWorkerRef.current = true
      try {
        const worker = await desktopChatDataPort.getSession(workerSessionId)
        const authorized = canOpenWorkerSession(session, worker, currentUserId)
        if (!authorized) throw new Error('worker_session_forbidden')
        await accountRuntime.persistSession(worker)
        if (onOpenWorkerSession) onOpenWorkerSession(worker.id, worker.title || worker.id)
        else
          router.navigate({
            pathname: '/(main)/chat/[sessionId]',
            params: { sessionId: worker.id },
          })
      } catch {
        showToast(t('worker_session_unavailable', '无法打开这个 Agent 对话'), 'error')
      } finally {
        openingWorkerRef.current = false
      }
    },
    [currentUserId, onOpenWorkerSession, router, session, showToast, t],
  )
  const handleOfficialRoomLinkPress = useCallback((url: string) => {
    const target = getOfficialRoomLinkNavigationTarget({
      url,
      platform: 'web',
      desktopControlSurface: true,
    })
    if (!target) return false
    router.navigate(target as never)
    return true
  }, [router])

  const voice = useVoiceDraft({
    sessionId,
    currentDraft: input,
    onListeningTextChange: (nextText) => {
      pendingClearedInputRef.current = null
      setInput(nextText)
    },
    onDraftReady: (result) => {
      pendingClearedInputRef.current = null
      setInput(result.draft)
      chatWebViewRef.current?.scrollToBottom()
    },
  })
  const {
    handleAbort,
    handleResend,
    handleImageLongPress,
    handleSend,
    handleCancelEditQueued,
    handleSubmitEditQueued,
    handleDeleteQueued,
    handlePromoteQueued,
    controllablePending,
    localPendingIds,
    queueAction,
    queueActionFailed,
    editingQueueMessageId,
    isSending,
    isStopping,
    pendingClearedInputRef,
  } = useChatSendController({
    agentType,
    sessionMode: session?.sessionMode ?? 'standard',
    currentRunId,
    input,
    isTyping,
    isUploading,
    machineId,
    messages,
    pendingAttachments,
    relayState,
    replacePendingAttachments,
    sessionAgentSessionId: session?.agentSessionId,
    sessionId,
    setInput,
    startPendingRun,
    clearPendingRun,
    clearPendingAttachments,
    addMessage,
    onMessageSubmitted: () => chatWebViewRef.current?.scrollToBottom(),
    updateMessageStatus,
    updateMessageError,
    send,
    textInputRef: textInputRef as RefObject<{
      clear?: () => void
      focus?: () => void
    } | null>,
    voicePhase: voice.phase,
    workDir,
    modelId: effectiveModelId,
    systemPrompt: session?.agentSystemPrompt ?? null,
    managerDefaultWorkerAgentType: session?.managerDefaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: session?.managerDefaultWorkerModelId ?? null,
    reasoningEffort: effectiveReasoningEffort,
    sessionListProjection,
    externalChannel: null,
  })
  const handleInputChange = useCallback(
    (nextValue: string) => {
      if (voice.phase === 'refining') void voice.cancelRecording()
      pendingClearedInputRef.current = null
      setInput(nextValue)
    },
    [pendingClearedInputRef, voice],
  )
  const agentCapabilities = useAgentCapabilities({
    agentType,
    machineId,
    relayState,
    send,
    showToast,
    t,
    machineOffline,
    setShowComposerMenu,
    workDir,
    setInput,
    textInputRef: textInputRef as RefObject<{ focus?: () => void } | null>,
  })
  const voiceDisabled = shouldDisableChatVoiceInput({
    sessionId,
    readOnlySession,
    machineOffline,
    relayState,
    isSending,
  })
  const canSend =
    canManageSession && !isUploading && hasSendableComposerContent(input, pendingAttachments.length)
  // An embedded Room agent surface must never inherit a stale route-level
  // installAgent parameter and navigate the whole workspace back to /chat.
  const autoInstallAgent =
    !embedded && installAgent && isInstallableBuiltinAgentType(installAgent) ? installAgent : null
  const autoInstallHandledRef = useRef<string | null>(null)

  useEffect(() => {
    if (!inputFocused) return
    pendingClearedInputRef.current = null
  }, [inputFocused])

  useEffect(() => {
    if (inputFocused) setShowComposerMenu(false)
  }, [inputFocused])

  useEffect(() => {
    if (showModelSelector || fileDrawerOpen) setShowComposerMenu(false)
  }, [fileDrawerOpen, showModelSelector])

  useEffect(() => {
    if (!sessionId || !session || !autoInstallAgent || readOnlySession) return

    const installKey = `${sessionId}:${autoInstallAgent}`
    if (autoInstallHandledRef.current === installKey) return
    if (
      relayState !== 'connected' ||
      isTyping ||
      isSending ||
      isUploading ||
      voice.phase !== 'idle'
    )
      return

    autoInstallHandledRef.current = installKey

    if (messages.some((message) => message.role === 'user')) {
      router.replace(`/(main)/chat/${sessionId}`)
      return
    }

    void handleSend({
      textOverride: buildAgentInstallPrompt(autoInstallAgent),
      bypassVoicePhaseGuard: true,
    })
    router.replace(`/(main)/chat/${sessionId}`)
  }, [
    autoInstallAgent,
    handleSend,
    isSending,
    isTyping,
    isUploading,
    messages,
    relayState,
    readOnlySession,
    router,
    session,
    sessionId,
    voice.phase,
  ])

  const { composerContextMenu, toolbarActions } = useChatComposerActions({
    colors,
    t,
    canShowModelControl: false,
    canOpenModelSelector: false,
    currentModelLabel,
    canShowReasoningEffort,
    effectiveReasoningEffort,
    currentReasoningLabel,
    reasoningEfforts,
    setPreferredReasoningEffort,
    showModelSelector,
    setShowComposerMenu,
    showComposerMenu,
    fileDrawerOpen,
    isDesktop: true,
    isUploading,
    modelSelectorBusy,
    machineOffline,
    showToast,
    openFileDrawer,
    openModelSelector,
    openAgentCapabilities: agentCapabilities.open,
    canShowAgentCapabilities: agentCapabilities.supported && !readOnlySession,
    handleAttachWeb,
    handleAttachFolderWeb,
  })

  const handleComposerSend = useCallback(async () => {
    if (readOnlySession) {
      showToast(t('session_readonly_toast'), 'info')
      return
    }
    if (editingQueueMessageId) {
      const updated = await handleSubmitEditQueued()
      if (!updated) showToast(t('msg_edit_queued_failed'), 'error')
      return
    }
    if (voice.phase === 'listening') {
      const result = await voice.stopRecording({ skipRefine: true })
      if (!result) return
      await handleSend({
        textOverride: result.draft,
        bypassVoicePhaseGuard: true,
      })
      return
    }
    if (voice.phase === 'refining') {
      const visibleDraft = input
      await voice.cancelRecording()
      await handleSend({ textOverride: visibleDraft, bypassVoicePhaseGuard: true })
      return
    }
    await handleSend()
  }, [
    editingQueueMessageId,
    handleSend,
    handleSubmitEditQueued,
    input,
    machineOffline,
    relayState,
    readOnlySession,
    showToast,
    t,
    voice,
  ])

  const fileActions = useDesktopChatFileActions({
    chatWebViewRef,
    handleSend,
    hydratedMessages: hydratedMessagesWithToolDetails,
    i18nLanguage: i18n.language,
    isSending,
    isTyping,
    machineId,
    machineOffline,
    openFileDrawer,
    readOnlySession,
    router,
    runPhase,
    send,
    sessionId,
    setInput,
    setShowSessionDetails,
    showToast,
    t,
    textInputRef,
    title,
    workDir,
  })
  const {
    filePreviewRefreshRevision,
    handleCopyCurrentMessage,
    handleFileSelectionAiAction,
    handleFileSelectionQuoteAction,
    handleInsertRef,
    handleSaveImage,
    openAttachmentPreview,
    openFileDrawerFromDetails,
    openUploadPreview,
    sidePreviewRequest,
  } = fileActions

  useDesktopChatShortcuts({
    copyCurrentMessage: handleCopyCurrentMessage,
    focusRef: textInputRef,
    onFocused: setInputFocused,
    refreshSession: handleRefreshSession,
    sessionId,
    showToast,
    t,
  })

  const { handleOpenAgentSettings } = useDesktopChatConnectivityActions({
    effectiveAgentIdentityId,
    machineId,
    machineOffline,
    relayFeedbackStatus,
    router,
    setShowSessionDetails,
    t,
  })

  return {
    screen: {
      directSessionLoading,
      retrySession,
      colors,
      embedded,
      fileDrawerOpen,
      hideHeader,
      isDark,
      toast,
      hideToast,
      workspaceAgentAvatar,
      workspaceAgentName,
      workspaceAgentOwnerAvatar,
      workspaceAgentOwnerName,
    },
    composer: {
      input,
      handleInputChange,
      inputFocused,
      setInputFocused,
      textInputRef,
      isTyping,
      isSending,
      isStopping,
      session,
      uploadTasks,
      cancelUpload,
      openUploadPreview,
      handlePasteWeb,
      canSend,
      machineOffline,
      relayFeedbackStatus,
      relayState,
      workspaceRoomId,
      linkedRoomBinding,
      title,
      editingQueueMessageId,
      handleCancelEditQueued,
      handleComposerSend,
      handleAbort,
      handleDeleteQueued,
      handlePromoteQueued,
      controllablePending,
      localPendingIds,
      queueAction,
      queueActionFailed,
      voice,
      voiceDisabled,
      composerContextMenu,
      toolbarActions,
      canShowModelControl,
      canOpenModelSelector,
      currentModelLabel,
      canShowReasoningEffort,
      effectiveReasoningEffort,
      currentReasoningLabel,
      reasoningEfforts,
      setPreferredReasoningEffort,
      composerBottomInset,
      readOnlySession,
      sessionOwnerName,
    },
    conversation: {
      chatLoading,
      chatWebViewRef,
      hasTitle,
      agentLabel,
      machineName,
      workDir,
      handleImageLongPress,
      handleResend,
      handleSaveImage,
      hydratedMessagesWithToolDetails,
      initialScrollPosition,
      loadingOlder,
      machineId,
      sessionId,
      pendingPresentationToken,
      acknowledgeLatestSnapshotPresented,
      openAttachmentPreview,
      handleAttachmentPreviewRequest,
      handleWorkerSessionPress,
      handleOfficialRoomLinkPress,
      handleToolDetailRequest,
      handleScrollState,
      setScrollCommand,
      runPhase,
      scrollCommand,
      showScrollBtn,
    },
    workspace: {
      sidePreviewRequest,
      handleInsertRef,
      handleFileSelectionAiAction,
      handleFileSelectionQuoteAction,
      filePreviewRefreshRevision,
      closeFileDrawer,
    },
    overlays: {
      showModelSelector,
      setShowModelSelector,
      modelSelectorBusy,
      displayModels,
      effectiveModelId,
      handleModelSelect,
      currentModelLabel,
      effectiveAgentIdentityId,
      handleFollowAgentModel,
      handleRefreshModels,
      modelRefreshBusy,
      agentCapabilities,
      showSessionDetails,
      setShowSessionDetails,
      managedAgentProfile,
      managedRuntimeLoading,
      managedRuntimeLoadFailed,
      canManageSession,
      openFileDrawerFromDetails,
      openRenameModal,
      handleDeletePress,
      showDeleteConfirm,
      setShowDeleteConfirm,
      handleDeleteSession,
      showRenameModal,
      setShowRenameModal,
      renameInput,
      setRenameInput,
      confirmRename,
      renameSaving,
      handleOpenAgentSettings,
    },
    t,
  }
}

function DesktopChatContent(props: DesktopChatScreenProps) {
  const model = useDesktopChatScreenModel(props)
  return <DesktopChatScreenView controller={model} />
}

export default function DesktopChatScreen(props: DesktopChatScreenProps = {}) {
  const route = useLocalSearchParams<{ sessionId: string }>()
  return (
    <DesktopWorkerNavigation
      key={props.sessionIdOverride || route.sessionId}
      sourceKey={props.sessionIdOverride || route.sessionId}
      renderSource={(openWorker) => (
        <DesktopChatContent {...props} onOpenWorkerSession={openWorker} />
      )}
      renderWorker={(sessionId) => (
        <DesktopChatContent sessionIdOverride={sessionId} embedded hideHeader />
      )}
    />
  )
}
