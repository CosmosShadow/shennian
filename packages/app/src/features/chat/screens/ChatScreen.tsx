import { visibleAfterStewardClear } from '../../steward/stewardDisplay'
import { chatKeyboardVerticalOffset } from '../utils/chatKeyboardGeometry'
import type { StewardPageContext } from '../../steward/contextualSteward'
import { useComposerFileHandoff, type ComposerFiles } from '../../steward/useComposerFileHandoff'
// @arch docs/architecture/app/modular-features.md#聊天-feature
// @arch docs/architecture/app/chat-composer-keyboard.md
// @arch docs/architecture/app/chat-draft-storage.md
// @arch docs/architecture/app/chat-voice-draft.md
// @test src/__tests__/chat-screen-utils.test.ts
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useIsFocused } from '@react-navigation/native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  type ChatMessage,
  getAgentDisplayName,
  getSessionLiveActivity,
  useChatStore,
  useMachinesStore,
  useSessionsStore,
  useSheetsStore,
} from '@shennian/shared'
import { useAuthStore } from '../../../config/auth'
import { type AcpSessionOptions, type AgentType, type NianSession } from '@shennian/wire'
import { useChatScrollState } from '../hooks/useChatScrollState'
import { useChatMobileDrawer } from '../hooks/useChatMobileDrawer'
import { useChatAutoInstall } from '../hooks/useChatAutoInstall'
import { ConversationSettingsSheet } from '../components/ConversationSettingsSheet'
import { ModelSelectorSheet, type ChatWebViewHandle } from '../../../components/chat'
import { useAccountMachine } from '../../account-runtime/useAccountMachine'
import { sessionAccountClient } from '../../sessions/sessionAccountClient'
import { useGoBack } from '../../../hooks/useGoBack'
import { useTheme } from '../../../hooks/useTheme'
import { useAppIsActive } from '../../../hooks/useAppIsActive'
import { getMachineAgentModels, normalizeModelId, normalizeModelInfos, resolveModel } from '../../../utils/models'
import { normalizeDisplayText } from '../../../components/headEllipsis'
import { useChatSessionActions } from '../hooks/useChatSessionActions'
import { useChatAttachmentPreviews } from '../hooks/useChatAttachmentPreviews'
import { useChatSendController } from '../hooks/useChatSendController'
import { useChatSessionHistory } from '../hooks/useChatSessionHistory'
import { useChatUploads } from '../hooks/useChatUploads'
import { useVoiceDraft } from '../hooks/useVoiceDraft'
import { ChatComposer } from '../components/ChatComposer'
import { QueuedMessagePanel } from '../components/QueuedMessagePanel'
import { ChatScreenColumn } from './ChatScreenColumn'
import { ChatHeader } from '../components/ChatHeader'
import { DeleteSessionModal } from '../components/DeleteSessionModal'
import { RenameSessionModal } from '../components/RenameSessionModal'
import { SessionDetailsModal } from '../components/SessionDetailsModal'
import { AgentCapabilityPickerSheet } from '../components/AgentCapabilityPickerSheet'
import { hasSendableComposerContent, resolveComposerInputChange } from '../utils/composerInput'
import { isInstallableBuiltinAgentType } from '../../machines/utils/launch'
import { ChatFileDrawerHost } from '../components/ChatFileDrawerHost'
import { visibleStewardMessages, withStewardIntro, withStewardSwitchMarks } from '../../steward/stewardModel'
import { useStewardInspiration } from '../../steward/useStewardInspiration'
import { StewardConversationColumn } from '../../steward/components/StewardConversationColumn'
import { useComposerDraft } from '../../steward/useComposerDraft'
import { shouldDisableChatVoiceInput } from '../utils/screen'
import { canOpenWorkerSession } from '../utils/workerSessionLink'
import { getOfficialRoomLinkNavigationTarget } from '../../rooms/roomNavigationTarget'
import { type ChatScrollPosition } from '../utils/scrollPositionStorage'
import { styles } from './ChatScreen.styles'
import { DownloadFeedback } from '../../../components/DownloadFeedback'
import { useToast } from '../../../hooks/useToast'
import { useAgentCapabilities } from '../hooks/useAgentCapabilities'
import { useChatComposerActions } from '../hooks/useChatComposerActions'
import { useComposerBottomInset } from '../hooks/useComposerBottomInset'
import { useChatPreviewActions } from '../hooks/useChatPreviewActions'
import { useReasoningEffortPreference } from '../hooks/useReasoningEffortPreference'
import { useChatToolDetails } from '../hooks/useChatToolDetails'
import { chatSendFailureKey } from '../utils/sendFailure'
import { useChatSessionContext } from '../hooks/useChatSessionContext'
import { useChatScreenActions } from '../hooks/useChatScreenActions'
import { useChatSessionProjection } from '../hooks/useChatSessionProjection'
import type { PublicAvatar } from '../../rooms/types'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { ensureImageAttachmentPreview } from '../utils/attachmentPreview'
import { isChatScreenActive, RoomWorkspaceActivityContext } from '../../rooms/RoomWorkspaceActivityContext'
export default function ChatScreen({
  sessionIdOverride,
  workspaceRoomId,
  workspaceAgentIdentityId,
  workspaceAgentName,
  workspaceAgentAvatar,
  workspaceAgentOwnerAvatar,
  workspaceAgentOwnerName,
  workspaceInitialScrollPosition,
  onWorkspaceScrollPositionChange,
  embedded = false,
  hideHeader = false,
  stewardMode = false, stewardInspirationEnabled = true,
  stewardHeader,
  stewardPlaceholder,
  stewardIntro,
  stewardSession,
  stewardDisplayFloor = 0,
  stewardPrelude,
  stewardSwitches,
  stewardShowModel = true,
  stewardShowEffort = true,
  stewardConversationView = false,
  stewardName,
  onStewardMessagesPresented,
  stewardContent,
  composerDraft, composerOnly = false, messageContext,
  initialComposerText, composerFiles, onComposerFilesAccepted,
}: {
  sessionIdOverride?: string
  workspaceRoomId?: string
  workspaceAgentIdentityId?: string
  workspaceAgentName?: string
  workspaceAgentAvatar?: PublicAvatar | null
  workspaceAgentOwnerAvatar?: PublicAvatar | null
  workspaceAgentOwnerName?: string | null
  workspaceInitialScrollPosition?: ChatScrollPosition | null
  onWorkspaceScrollPositionChange?: (position: ChatScrollPosition) => void
  embedded?: boolean
  hideHeader?: boolean
  /** Message-style steward conversation: only the user's messages and `steward_say` are shown. */
  stewardMode?: boolean
  stewardInspirationEnabled?: boolean
  stewardHeader?: ReactNode
  stewardPlaceholder?: string
  /** Shown as the steward's first message while the conversation is still empty. */
  stewardIntro?: string
  /** The steward keeps its conversations outside the ordinary sessions store. */
  stewardSession?: NianSession
  /** Device-local presentation cutoff; never alters Agent input or stored messages. */
  stewardDisplayFloor?: number
  /** Earlier steward conversations and the rules between them, shown above this one. */
  stewardPrelude?: ChatMessage[]
  /** Rules for tool/model switches made inside the open steward conversation. */
  stewardSwitches?: ChatMessage[]
  /** The user may hide the composer's model / reasoning controls. */
  stewardShowModel?: boolean
  stewardShowEffort?: boolean
  /** Renders the steward's kept messages as an ordinary conversation instead of the technical transcript. */
  stewardConversationView?: boolean
  stewardName?: string
  /** Personal module content shares the steward conversation and its real composer. */
  stewardContent?: ReactNode
  composerOnly?: boolean; messageContext?: StewardPageContext
  composerDraft?: { id: number; text: string }
  composerFiles?: ComposerFiles; onComposerFilesAccepted?: () => void
  initialComposerText?: string
  /** Called only after this machine's steward conversation has actually painted. */
  onStewardMessagesPresented?: () => void
} = {}) {
  const routeParams = useLocalSearchParams<{
    sessionId: string
    installAgent?: string
  }>()
  const { installAgent } = routeParams
  const sessionId = sessionIdOverride || routeParams.sessionId
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const goBack = useGoBack()
  const { colors, isDark } = useTheme()
  const routeFocused = useIsFocused()
  const workspaceActive = useContext(RoomWorkspaceActivityContext)
  const appIsActive = useAppIsActive()
  const voiceActive = appIsActive && isChatScreenActive(routeFocused, workspaceActive, embedded)
  const { toast, showToast, hideToast } = useToast()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const composerBottomInset = useComposerBottomInset(insets.bottom)
  const useKeyboardControllerAvoider =
    !embedded && (Platform.OS === 'ios' || Platform.OS === 'android')
  const keyboardAvoidingBehavior = Platform.OS === 'android' ? 'height' : 'padding'
  const [input, setInput, restoreComposerInput] = useComposerDraft(composerDraft, initialComposerText)
  const [inputFocused, setInputFocused] = useState(false)
  const [showConversationSettings, setShowConversationSettings] = useState(false)
  const [showComposerMenu, setShowComposerMenu] = useState(false)
  const [screenshotBusy, setScreenshotBusy] = useState(false)
  const [scrollCommand, setScrollCommand] = useState<{
    action: 'top' | 'bottom'
    id: number
  } | null>(null)
  const textInputRef = useRef<import('react-native').TextInput>(null)
  const chatWebViewRef = useRef<ChatWebViewHandle>(null)
  const [filePreviewRefreshToken, setFilePreviewRefreshToken] = useState(0)
  const [sidePreviewRequest, setSidePreviewRequest] = useState<{
    id: number
    path: string
    name: string
    kind?: 'folder'
    line?: number
    endLine?: number
  } | null>(null)
  const [acpSessionOptions, setAcpSessionOptions] = useState<AcpSessionOptions | null>(null)
  const sessions = useSessionsStore((store) => store.sessions)
  const upsertSession = useSessionsStore((store) => store.upsertSession)
  const indexedSession = stewardSession?.id === sessionId
    ? stewardSession
    : sessions.find((item) => item.id === sessionId)
  const {
    effectiveAgentIdentityId,
    linkedRoomBinding,
    managedAgentProfile,
    managedAgentProfileState,
    roomSessionState,
    session,
  } = useChatSessionContext({
    indexedSession,
    sessionId,
    upsertSession,
    workspaceAgentIdentityId,
    workspaceRoomId,
  })
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const canManageSession =
    !!session && (session.canManage ?? (!!currentUserId && session.userId === currentUserId))
  const readOnlySession = !!session && !canManageSession
  const handleWorkerSessionPress = useCallback(
    async (workerSessionId: string) => {
      if (!session || !currentUserId) return
      try {
        const worker = await sessionAccountClient.getSession(workerSessionId)
        const authorized = canOpenWorkerSession(session, worker, currentUserId)
        if (!authorized) throw new Error('worker_session_forbidden')
        await accountRuntime.persistSession(worker)
        router.navigate({ pathname: '/(main)/chat/[sessionId]', params: { sessionId: worker.id } })
      } catch {
        showToast(t('worker_session_unavailable', '无法打开这个 Agent 对话'), 'error')
      }
    },
    [currentUserId, router, session, showToast, t],
  )
  const handleOfficialRoomLinkPress = useCallback((url: string) => {
    const target = getOfficialRoomLinkNavigationTarget({
      url,
      platform: Platform.OS,
      desktopControlSurface: false,
    })
    if (!target) return false
    router.navigate(target as never)
    return true
  }, [router])
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
  const sessionListProjection = useChatSessionProjection(sessions, workDir)
  const agentLabel = getAgentDisplayName(agentType)
  const machines = useMachinesStore((store) => store.machines)
  const machine = machines.find((item) => item.id === machineId)
  const machineName = machine?.name ?? session?.machineName ?? ''
  const machineOffline = machine?.online === false
  const availableModels = useMemo(() => {
    const detected = getMachineAgentModels(machine, agentType)
    if (!agentType.startsWith('acp:') || !acpSessionOptions) return detected
    if (acpSessionOptions.models.length) return normalizeModelInfos(acpSessionOptions.models)
    if (!acpSessionOptions.modes.length) return detected
    return [
      {
        id: normalizeModelId(session?.modelId) ?? 'agent-default',
        name: normalizeDisplayText(session?.modelId) || t('agents_default_model'),
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
    () =>
      availableModels.map((model) => ({
        ...model,
        name: model.name,
      })),
    [agentType, availableModels, t],
  )
  const configuredModelId = normalizeModelId(session?.modelSource === 'agent' ? session.agentDefaultModelId : session?.modelId)
  const currentModelLabel = [currentModel?.name, currentModel?.id, configuredModelId]
    .map(normalizeDisplayText).find(Boolean) || (effectiveAgentIdentityId ? t('agents_default_model') : '')
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
  const {
    canShowReasoningEffort,
    effectiveReasoningEffort,
    reasoningEfforts,
    currentReasoningLabel,
    setPreferredReasoningEffort,
  } = useReasoningEffortPreference({
    sessionId,
    agentType,
    currentModel,
    t,
  })
  const isManagerSession = session?.sessionMode === 'manager' || agentType === 'manager'
  const canShowModelControl = availableModels.length > 0
  const canOpenModelSelector = canShowModelControl && !isManagerSession
  const messages = useChatStore((store) => store.messages)
  const hydratedMessages = useChatAttachmentPreviews(messages, machineId)
  const runPhase = useChatStore((store) => store.runPhase)
  const chatSessionId = useChatStore((store) => store.sessionId)
  const isTyping = useChatStore((store) => store.isTyping)
  const currentRunId = useChatStore((store) => store.currentRunId)
  const chatLoading = useChatStore((store) => store.loading)
  const addMessage = useChatStore((store) => store.addMessage)
  const setMessages = useChatStore((store) => store.setMessages)
  const hasMoreMessages = useChatStore((store) => store.hasMore)
  const prependMessages = useChatStore((store) => store.prependMessages)
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
  const { mobileDrawerProgress, mobileDrawerVisible } = useChatMobileDrawer(fileDrawerOpen)
  const {
    loadingOlder,
    loadOlderMessages,
    pendingPresentationToken,
    acknowledgeLatestSnapshotPresented,
  } = useChatSessionHistory({
    sessionId,
    session,
    skipReadCommit: stewardConversationView,
    loadBody: !composerOnly,
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
  const { showScrollBtn, initialScrollPosition, handleScrollState } = useChatScrollState({
    sessionId, workspaceInitialScrollPosition, onWorkspaceScrollPositionChange,
    chatLoading, hasMoreMessages, loadOlderMessages, loadingOlder,
  })
  const {
    uploadTasks, uploadSelectedFiles,
    pendingAttachments,
    isUploading,
    cancelUpload,
    handleAttachWeb,
    handleAttachFolderWeb,
    handlePasteWeb,
    handleAttachNativeFile,
    handleAttachNativeMedia,
    handleTakeNativePhoto,
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
  // The scoped history client owns body events; this relay handles controls and activity.
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
  // The steward hides the Agent's working text and tool activity; the transcript keeps them.
  const visibleMessages = useMemo(
    () => (stewardMode
      ? visibleAfterStewardClear(withStewardIntro(
          [
            ...(stewardPrelude ?? []),
            ...withStewardSwitchMarks(
              visibleStewardMessages(hydratedMessagesWithToolDetails),
              stewardSwitches ?? [],
            ),
          ],
          stewardIntro,
          Date.parse(stewardSession?.createdAt ?? '') || undefined,
        ), stewardDisplayFloor)
      : hydratedMessagesWithToolDetails),
    [stewardDisplayFloor, hydratedMessagesWithToolDetails, stewardIntro, stewardMode, stewardPrelude, stewardSwitches, stewardSession?.createdAt],
  )
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
  const activeExternalChannel = session?.externalChannel ?? null
  const voice = useVoiceDraft({
    sessionId,
    active: voiceActive,
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
    input, messageContext,
    isTyping,
    isUploading,
    machineId,
    messages,
    pendingAttachments,
    relayState,
    replacePendingAttachments,
    sessionAgentSessionId: session?.agentSessionId,
    sessionId,
    setInput: restoreComposerInput,
    startPendingRun,
    clearPendingRun,
    clearPendingAttachments,
    addMessage,
    onMessageSubmitted: () => chatWebViewRef.current?.scrollToBottom(),
    onSendRejected: (error) => showToast(t(chatSendFailureKey(error)), 'error'),
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
      const decision = resolveComposerInputChange({
        nextValue,
        pendingClearedValue: pendingClearedInputRef.current,
      })
      if (decision === 'ignore-stale-replay') return
      if (decision === 'keep-clear-guard') {
        setInput('')
        return
      }
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
  useComposerFileHandoff(composerFiles, uploadSelectedFiles, onComposerFilesAccepted)
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
  useChatAutoInstall({ sessionId, session, autoInstallAgent, readOnlySession, relayState,
    isTyping, isSending, isUploading, voicePhase: voice.phase, messages, handleSend })
  const canOpenConversationSettings = !readOnlySession && !effectiveAgentIdentityId && !isManagerSession && !stewardMode
    && (agentType === 'codex' || canShowReasoningEffort)
  const { openInspiration, inspirationUi } = useStewardInspiration({
    enabled: stewardMode && stewardInspirationEnabled, accountId: currentUserId ?? '', input, attachments: pendingAttachments.length,
    sending: isSending, uploading: isUploading, editing: Boolean(editingQueueMessageId), voicePhase: voice.phase,
    ready: canManageSession && !chatLoading, closeMenu: () => setShowComposerMenu(false),
    send: handleSend, showError: message => showToast(message, 'error'),
  })
  const { composerContextMenu, toolbarActions } = useChatComposerActions({
    stewardMode, onInspiration: stewardInspirationEnabled ? openInspiration : undefined,
    canOpenConversationSettings,
    openConversationSettings: () => { Keyboard.dismiss(); setShowComposerMenu(false); setShowConversationSettings(true) },
    colors,
    t,
    canShowModelControl: canShowModelControl && (!stewardMode || stewardShowModel),
    canOpenModelSelector,
    currentModelLabel,
    canShowReasoningEffort: canShowReasoningEffort && (!stewardMode || stewardShowEffort),
    effectiveReasoningEffort,
    currentReasoningLabel,
    reasoningEfforts,
    setPreferredReasoningEffort,
    showModelSelector,
    setShowComposerMenu,
    showComposerMenu,
    fileDrawerOpen,
    isDesktop: false,
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
    handleAttachNativeFile,
    handleAttachNativeMedia,
    handleTakeNativePhoto,
  })
  const openFileDrawerFromDetails = useCallback(() => {
    if (machineOffline) {
      showToast(t('machine_offline_error'), 'error')
      return
    }
    setShowSessionDetails(false)
    openFileDrawer()
  }, [machineOffline, openFileDrawer, setShowSessionDetails, showToast, t])
  const openSideFilePreview = useCallback(
    (params: Record<string, string>) => {
      if (!params.path) return
      setShowSessionDetails(false)
      openFileDrawer()
      const line = Number(params.line)
      const endLine = Number(params.endLine)
      setSidePreviewRequest({
        id: Date.now(),
        path: params.path,
        name: params.name || params.path.split(/[\\/]/).pop() || params.path,
        ...(params.kind === 'folder' ? { kind: 'folder' as const } : {}),
        ...(Number.isInteger(line) && line > 0 ? { line } : {}),
        ...(Number.isInteger(endLine) && endLine > 0 ? { endLine } : {}),
      })
    },
    [openFileDrawer, setShowSessionDetails],
  )
  const { handleSaveImage, openAttachmentPreview, openUploadPreview } = useChatPreviewActions({
    chatWebViewRef,
    hydratedMessages: visibleMessages,
    machineId,
    preferSidePreview: false,
    onOpenSidePreview: openSideFilePreview,
    router,
    screenshotBusy,
    send,
    sessionId,
    setScreenshotBusy,
    setShowSessionDetails,
    showToast,
    t,
    title,
    workDir,
  })
  const {
    handleComposerSend, handleHoldRelease,
    handleFileSelectionAiAction,
    handleFileSelectionQuoteAction,
    handleInsertRef,
  } = useChatScreenActions({
    editingQueueMessageId,
    handleSend,
    handleSubmitEditQueued,
    input,
    isSending,
    isTyping,
    language: i18n.language,
    machineOffline,
    readOnlySession,
    runPhase,
    setFilePreviewRefreshToken,
    setInput,
    showToast,
    t,
    textInputRef,
    voice,
  })
  const composer = readOnlySession ? (
    <View
      style={[
        styles.readOnlyComposer,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Ionicons name="eye-outline" size={16} color={colors.textSecondary} />
      <Text style={[styles.readOnlyComposerText, { color: colors.textSecondary }]}>
        {t('session_readonly_notice', { name: sessionOwnerName })}
      </Text>
    </View>
  ) : (
    <View>
      {inspirationUi}
      <QueuedMessagePanel
        messages={controllablePending}
        localPendingIds={localPendingIds}
        action={queueAction}
        actionFailed={queueActionFailed}
        onDelete={handleDeleteQueued}
        onPromote={handlePromoteQueued}
        colors={colors}
      />
      <ChatComposer
        stewardMode={stewardMode} onHoldStart={(held) => voice.startRecording(held)}
        onHoldRelease={handleHoldRelease}
        input={input}
        onInputChange={handleInputChange}
        inputFocused={inputFocused}
        setInputFocused={setInputFocused}
        textInputRef={textInputRef}
        isTyping={isTyping}
        isSending={isSending}
        isStopping={isStopping}
        canStop={session?.activity?.canStop}
        hideStopButton={stewardConversationView}
        uploadTasks={uploadTasks}
        onCancelUpload={cancelUpload}
        onPreviewUpload={openUploadPreview}
        onWebPaste={handlePasteWeb}
        canSend={canSend}
        sendDisabledReason={null}
        placeholder={
          stewardMode
            ? stewardPlaceholder
            : workspaceRoomId
            ? t('room_workspace_agent_placeholder', {
                agent: workspaceAgentName || linkedRoomBinding?.agentDisplayName || title,
              })
            : undefined
        }
        editingQueued={Boolean(editingQueueMessageId)}
        onCancelQueuedEdit={handleCancelEditQueued}
        onSend={handleComposerSend}
        onAbort={handleAbort}
        voicePhase={voice.phase}
        onVoiceStart={() => {
          void voice.startRecording()
        }}
        onVoiceStop={(options) => voice.stopRecording(options)}
        onVoiceCancel={() => voice.cancelRecording()}
        voiceDisabled={voiceDisabled || Boolean(editingQueueMessageId)}
        voiceMeterLevel={voice.meterLevel}
        voicePreviewPhase={null}
        contextMenu={composerContextMenu}
        toolbarActions={toolbarActions}
        colors={colors}
        isDark={isDark}
        bottomInset={composerBottomInset}
      />
    </View>
  )
  const chatColumn = composerOnly ? composer : stewardConversationView ? (
    <StewardConversationColumn header={stewardHeader} content={stewardContent} composer={composer}
      messagesProps={{ onResourcePress: openAttachmentPreview, onAttachmentPreviewRequest: handleAttachmentPreviewRequest, messages: visibleMessages,
        stewardName: stewardName ?? title, runPhase, isTyping, presentationToken: pendingPresentationToken,
        active: routeFocused && appIsActive && chatSessionId === sessionId,
        ready: !chatLoading && chatSessionId === sessionId,
        paintKey: `${sessionId}:${session?.bodyRevision ?? 0}:${session?.attentionCount ?? 0}`,
        onConversationPainted: (token) => {
          if (token) acknowledgeLatestSnapshotPresented(token)
          onStewardMessagesPresented?.()
        },
      }}
      menu={Platform.OS !== 'web' && showComposerMenu ? <Pressable style={styles.composerMenuBackdrop} onPress={() => setShowComposerMenu(false)} /> : null}
    />
  ) : (
    <ChatScreenColumn
      chatLoading={chatLoading}
      chatWebViewRef={chatWebViewRef}
      colors={colors}
      composer={composer}
      header={
        stewardHeader ?? (
          <ChatHeader
            sessionId={sessionId}
            goBack={goBack}
            title={title}
            hasTitle={hasTitle}
            colors={colors}
            onOpenTop={() => setScrollCommand({ action: 'top', id: Date.now() })}
            onOpenDetails={() => setShowSessionDetails(true)}
          />
        )
      }
      handleImageLongPress={handleImageLongPress}
      handleResend={handleResend}
      handleSaveImage={handleSaveImage}
      externalChannel={activeExternalChannel}
      hydratedMessages={visibleMessages}
      pendingCardMessages={controllablePending}
      initialScrollPosition={initialScrollPosition}
      isDark={isDark}
      desktopMessages={false}
      isTyping={isTyping}
      loadingOlder={loadingOlder}
      hideHeader={hideHeader}
      machineId={machineId}
      sessionId={sessionId}
      presentationToken={pendingPresentationToken}
      onMessagesPresented={acknowledgeLatestSnapshotPresented}
      onOpenAttachmentPreview={openAttachmentPreview}
      onSessionPress={handleWorkerSessionPress}
      onLinkPress={handleOfficialRoomLinkPress}
      onAttachmentPreviewRequest={handleAttachmentPreviewRequest}
      onToolDetailRequest={handleToolDetailRequest}
      onScrollState={handleScrollState}
      onScrollToBottom={() => setScrollCommand({ action: 'bottom', id: Date.now() })}
      runPhase={runPhase}
      // Keep the active chat and project list on the same run-level counter;
      // transcript records can contain both a call and its imported output.
      activeToolCallCount={session?.activity?.toolCallCount}
      scrollCommand={scrollCommand}
      showScrollBtn={showScrollBtn}
      t={t}
    />
  )
  return (
    <SafeAreaView
      style={[!composerOnly && styles.container, { backgroundColor: colors.bg }]}
      edges={embedded || composerOnly || stewardConversationView ? [] : ['top']}
    >
      {useKeyboardControllerAvoider && !composerOnly ? (
        <KeyboardAvoidingView behavior={keyboardAvoidingBehavior} style={styles.keyboardView}
          keyboardVerticalOffset={chatKeyboardVerticalOffset(stewardConversationView, insets.top)}>
          {chatColumn}
        </KeyboardAvoidingView>
      ) : (
        <View style={composerOnly ? undefined : styles.keyboardView}>{chatColumn}</View>
      )}
      <ChatFileDrawerHost
        isMobileDrawer={true}
        mobileDrawerVisible={mobileDrawerVisible}
        mobileDrawerProgress={mobileDrawerProgress}
        width={width}
        topInset={insets.top}
        bottomInset={insets.bottom}
        colors={colors}
        send={send}
        workDir={workDir}
        previewRequest={sidePreviewRequest}
        onInsertRef={handleInsertRef}
        onSelectionAiAction={handleFileSelectionAiAction}
        onSelectionQuoteAction={handleFileSelectionQuoteAction}
        refreshToken={filePreviewRefreshToken}
        onClose={closeFileDrawer}
      />
      {showConversationSettings && canOpenConversationSettings ? <ConversationSettingsSheet key={sessionId}
        sessionId={sessionId} daemonInstallationId={machine?.daemonInstallationId} isCodex={agentType === 'codex'}
        busy={isTyping || isSending} reasoningEfforts={reasoningEfforts} reasoningEffort={effectiveReasoningEffort}
        onReasoningEffort={setPreferredReasoningEffort} send={send} onClose={() => setShowConversationSettings(false)} /> : null}
      <ModelSelectorSheet
        isOpen={showModelSelector}
        onClose={() => {
          if (!modelSelectorBusy) setShowModelSelector(false)
        }}
        agentLabel={agentLabel}
        models={displayModels}
        effectiveModelId={effectiveModelId}
        selectBusy={modelSelectorBusy}
        onSelectModel={handleModelSelect}
        followsAgentModel={session?.modelSource === 'agent'}
        followAgentDescription={currentModelLabel}
        onFollowAgentModel={effectiveAgentIdentityId ? handleFollowAgentModel : undefined}
        onRefreshModels={handleRefreshModels}
        refreshBusy={modelRefreshBusy}
      />

      <AgentCapabilityPickerSheet
        visible={agentCapabilities.visible}
        colors={colors}
        agentLabel={agentLabel}
        capabilities={agentCapabilities.capabilities}
        loading={agentCapabilities.loading}
        onClose={() => agentCapabilities.setVisible(false)}
        onRefresh={agentCapabilities.refresh}
        onSelect={agentCapabilities.select}
      />

      <SessionDetailsModal
        sessionId={sessionId}
        visible={showSessionDetails}
        onClose={() => setShowSessionDetails(false)}
        agentLabel={agentLabel}
        currentModelLabel={currentModelLabel}
        machineName={machineName}
        workDir={workDir}
        agentIdentityId={effectiveAgentIdentityId}
        roomBinding={linkedRoomBinding}
        agentName={managedAgentProfile?.displayName ?? workspaceAgentName}
        agentDescription={managedAgentProfile?.description}
        agentAvatar={managedAgentProfile?.avatar ?? workspaceAgentAvatar}
        agentOwnerAvatar={workspaceAgentOwnerAvatar}
        agentOwnerName={workspaceAgentOwnerName}
        permissionPolicy={managedAgentProfile?.permissionPolicy}
        sessionMode={session?.sessionMode ?? 'standard'}
        runtimeLoading={managedRuntimeLoading}
        runtimeLoadFailed={managedRuntimeLoadFailed}
        colors={colors}
        canManage={canManageSession}
        onOpenFileBrowser={openFileDrawerFromDetails}
        onRename={openRenameModal}
        onDelete={handleDeletePress}
        onOpenAgentSettings={
          effectiveAgentIdentityId
            ? () => {
                setShowSessionDetails(false)
                router.navigate(`/(main)/agents/${effectiveAgentIdentityId}/settings`)
              }
            : undefined
        }
      />

      <DeleteSessionModal
        visible={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false)
          void handleDeleteSession()
        }}
        colors={colors}
      />

      <RenameSessionModal
        visible={showRenameModal}
        onClose={() => setShowRenameModal(false)}
        renameInput={renameInput}
        setRenameInput={setRenameInput}
        onConfirm={confirmRename}
        renameSaving={renameSaving}
        colors={colors}
      />
      <DownloadFeedback notice={toast} onHide={hideToast} />
    </SafeAreaView>
  )
}
