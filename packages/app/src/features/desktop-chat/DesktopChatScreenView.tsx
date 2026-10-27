import { DesktopContextMenu, useDesktopContextMenu } from '../desktop-shell/DesktopContextMenu'
// @arch docs/architecture/app/modular-features.md#聊天-feature
// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @test src/__tests__/desktop-chat-controller.test.ts

import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useState } from 'react'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { ConversationSchedules } from '../schedules/ConversationSchedules'
import { canShowSessionSchedules } from '../schedules/scheduleVisibility'
import { useHasActiveSchedules } from '../schedules/useHasActiveSchedules'
import Ionicons from '@expo/vector-icons/Ionicons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Toast } from '../../components'
import { DesktopChatComposer } from './DesktopChatComposer'
import { QueuedMessagePanel } from '../chat/components/QueuedMessagePanel'
import { ChatScreenColumn } from '../chat/screens/ChatScreenColumn'
import { DesktopPersonalChatHeader } from './DesktopPersonalChatHeader'
import { DeleteSessionModal } from '../chat/components/DeleteSessionModal'
import { RenameSessionModal } from '../chat/components/RenameSessionModal'
import { AgentCapabilityPickerSheet } from '../chat/components/AgentCapabilityPickerSheet'
import { styles } from '../chat/screens/ChatScreen.styles'
import { DesktopChatWorkspace } from './DesktopChatWorkspace'
import { DesktopChatFileWorkspace } from './DesktopChatFileWorkspace'
import { DesktopChatContextControls } from './DesktopChatContextControls'
import type { useDesktopChatScreenModel } from './DesktopChatScreen'

export function DesktopChatScreenView({
  controller,
}: {
  controller: ReturnType<typeof useDesktopChatScreenModel>
}) {
  const contextMenu = useDesktopContextMenu()
  const [schedulesOpen, setSchedulesOpen] = useState(false)
  const { screen, composer: composerState, conversation, workspace, overlays, t } = controller
  const {
    colors,
    embedded,
    fileDrawerOpen,
    hideHeader,
    isDark,
    toast,
    hideToast,
  } = screen
  const {
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
    handleDeleteQueued,
    handlePromoteQueued,
    controllablePending,
    localPendingIds,
    queueAction,
    queueActionFailed,
  } = composerState
  const {
    chatLoading,
    chatWebViewRef,
    hasTitle,
    agentLabel,
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
    handleToolDetailRequest,
    handleScrollState,
    setScrollCommand,
    runPhase,
    scrollCommand,
    showScrollBtn,
  } = conversation
  const {
    sidePreviewRequest,
    handleInsertRef,
    handleFileSelectionAiAction,
    handleFileSelectionQuoteAction,
    filePreviewRefreshRevision,
    closeFileDrawer,
  } = workspace
  const {
    showModelSelector,
    setShowModelSelector,
    modelSelectorBusy,
    displayModels,
    effectiveModelId,
    handleModelSelect,
    effectiveAgentIdentityId,
    handleFollowAgentModel,
    handleRefreshModels,
    modelRefreshBusy,
    agentCapabilities,
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
  } = overlays
  const canManageSessionSchedules = canShowSessionSchedules(canManageSession, effectiveAgentIdentityId, linkedRoomBinding)
  // New-user default (zero schedules) hides the menu entry entirely instead of exposing an empty dialog;
  // an agent that already has schedules keeps the existing pause/resume/edit/delete management path.
  const { hasActiveSchedules, refresh: refreshHasActiveSchedules } = useHasActiveSchedules(
    sessionId,
    canManageSessionSchedules,
  )
  const showSessionSchedules = canManageSessionSchedules && hasActiveSchedules

  const connectionDisabledReason = machineOffline
    ? t('machine_offline_error')
    : relayState !== 'connected'
      ? t(
          relayFeedbackStatus === 'network_offline'
            ? 'relay_network_offline_draft'
            : relayFeedbackStatus === 'version_unsupported'
              ? 'relay_version_unsupported'
              : relayFeedbackStatus === 'auth_required'
                ? 'relay_auth_required'
                : 'relay_disconnected_retry',
        )
      : null
  const voiceDisabledReason = editingQueueMessageId
    ? t('msg_editing_queued')
    : isSending
      ? t('desktop_composer_sending')
      : connectionDisabledReason

  if (!session) return <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.bg}}>
    {screen.directSessionLoading ? <ActivityIndicator color={colors.brand} /> : <>
      <Text accessibilityRole="alert" style={{color: colors.textSecondary}}>{t('desktop_session_unavailable')}</Text>
      <Pressable accessibilityRole="button" onPress={screen.retrySession} style={{minHeight: 44, padding: 12}}><Text style={{color: colors.brand}}>{t('retry')}</Text></Pressable>
    </>}
  </View>

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
      <QueuedMessagePanel
        messages={controllablePending}
        localPendingIds={localPendingIds}
        action={queueAction}
        actionFailed={queueActionFailed}
        onDelete={handleDeleteQueued}
        onPromote={handlePromoteQueued}
        colors={colors}
      />
      <DesktopChatComposer
        input={input}
        onInputChange={handleInputChange}
        inputFocused={inputFocused}
        setInputFocused={setInputFocused}
        textInputRef={textInputRef}
        isTyping={isTyping}
        isSending={isSending}
        isStopping={isStopping}
        canStop={session?.activity?.canStop}
        uploadTasks={uploadTasks}
        onCancelUpload={cancelUpload}
        onPreviewUpload={openUploadPreview}
        onWebPaste={handlePasteWeb}
        canSend={canSend}
        reconnectAvailable={false}
        sendDisabledReason={null}
        placeholder={
          workspaceRoomId
              ? t('room_workspace_agent_placeholder', { agent: screen.workspaceAgentName || title })
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
        voiceDisabled={voiceDisabled || Boolean(editingQueueMessageId)}
        voiceDisabledReason={voiceDisabledReason}
        voiceMeterLevel={voice.meterLevel}
        voicePreviewPhase={null}
        contextMenu={composerContextMenu}
        contextControls={
          <DesktopChatContextControls
            colors={colors}
            showModelControl={canShowModelControl}
            canSwitchModel={canOpenModelSelector}
            modelMenuOpen={showModelSelector}
            modelBusy={modelSelectorBusy}
            refreshBusy={modelRefreshBusy}
            models={displayModels}
            effectiveModelId={effectiveModelId}
            currentModelLabel={currentModelLabel}
            followsAgentModel={session?.modelSource === 'agent'}
            followAgentDescription={currentModelLabel}
            canFollowAgentModel={Boolean(effectiveAgentIdentityId)}
            onModelMenuOpenChange={setShowModelSelector}
            onSelectModel={handleModelSelect}
            onFollowAgentModel={handleFollowAgentModel}
            onRefreshModels={handleRefreshModels}
            showReasoningEffort={canShowReasoningEffort}
            effectiveReasoningEffort={effectiveReasoningEffort}
            currentReasoningLabel={currentReasoningLabel}
            reasoningEfforts={reasoningEfforts}
            onSelectReasoningEffort={setPreferredReasoningEffort}
          />
        }
        toolbarActions={toolbarActions}
        colors={colors}
        isDark={isDark}
        bottomInset={composerBottomInset}
      />
    </View>
  )

  const chatColumn = (
    <ChatScreenColumn
      chatLoading={chatLoading}
      chatWebViewRef={chatWebViewRef}
      colors={colors}
      composer={composer}
      header={
        <DesktopPersonalChatHeader
          title={title}
          hasTitle={hasTitle}
          colors={colors}
          contextMenuBindings={contextMenu.bindings}
        />
      }
      handleImageLongPress={handleImageLongPress}
      handleResend={handleResend}
      handleSaveImage={handleSaveImage}
      externalChannel={session?.externalChannel ?? null}
      hydratedMessages={hydratedMessagesWithToolDetails}
      pendingCardMessages={controllablePending}
      initialScrollPosition={initialScrollPosition}
      isDark={isDark}
      desktopMessages={true}
      isTyping={isTyping}
      loadingOlder={loadingOlder}
      hideHeader={hideHeader}
      machineId={machineId}
      sessionId={sessionId}
      presentationToken={pendingPresentationToken}
      onMessagesPresented={acknowledgeLatestSnapshotPresented}
      onOpenAttachmentPreview={openAttachmentPreview}
      onSessionPress={conversation.handleWorkerSessionPress}
      onLinkPress={conversation.handleOfficialRoomLinkPress}
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
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={embedded ? [] : ['top']}
    >
      <DesktopChatWorkspace
        contextOpen={fileDrawerOpen}
        conversation={<View style={styles.chatColumn}>{chatColumn}</View>}
        renderContext={(narrow, workspaceWidth) => (
          <DesktopChatFileWorkspace
            narrow={narrow}
            width={workspaceWidth}
            colors={colors}
            machineId={machineId ?? ''}
            sessionId={sessionId}
            workDir={workDir}
            previewRequest={sidePreviewRequest}
            onInsertRef={handleInsertRef}
            onSelectionAiAction={handleFileSelectionAiAction}
            onSelectionQuoteAction={handleFileSelectionQuoteAction}
            refreshRevision={filePreviewRefreshRevision}
            onClose={closeFileDrawer}
          />
        )}
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

      <DesktopContextMenu menu={contextMenu} actions={[
        { label: t('file_browser'), onSelect: openFileDrawerFromDetails },
        ...(canManageSession ? [
          { label: t('rename_session'), onSelect: openRenameModal },
          ...(showSessionSchedules ? [{ label: t('schedules_title'), onSelect: () => setSchedulesOpen(true) }] : []),
          { label: t('delete_session'), destructive: true, onSelect: handleDeletePress },
        ] : []),
        ...(effectiveAgentIdentityId ? [{ label: t('agents_view_owner'), onSelect: handleOpenAgentSettings }] : []),
      ]} />

      {schedulesOpen && showSessionSchedules ? (
        <DesktopDialog
          title={t('schedules_title')}
          onClose={() => {
            setSchedulesOpen(false)
            refreshHasActiveSchedules()
          }}
        >
          <ConversationSchedules sessionId={sessionId} showHeading={false} />
        </DesktopDialog>
      ) : null}

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
      <Toast
        message={toast?.message ?? ''}
        visible={!!toast}
        type={toast?.type}
        onHide={hideToast}
      />
    </SafeAreaView>
  )
}
