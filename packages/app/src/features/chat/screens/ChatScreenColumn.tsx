import { RecoverableSection } from '../../../components/RecoverableSection'
import { DesktopScrollToLatestButton } from '../../desktop-chat/DesktopScrollToLatestButton'
import { AgentUserInputForm } from '../components/AgentUserInputForm'
import { ProjectTaskCoordinationNotice } from '../../projects/coordination/ProjectTaskCoordinationNotice'
// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-background-history-loading.test.ts

import Feather from '@expo/vector-icons/Feather'
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { ChatWebView, type ChatWebViewHandle } from '../../../components/chat'
import type { ChatScrollPosition } from '../utils/scrollPositionStorage'
import type { ChatMessage, ChatRunPhase } from '@shennian/shared'
import type { ExternalChannelSessionStatus } from '@shennian/wire'
import { styles } from './ChatScreen.styles'
import { useCallback, useMemo, useState, type RefObject, type ReactNode } from 'react'
import type { WeChatRpaPendingReplyProjection } from '@shennian/wire'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import type { QueuedChatMessage } from '@shennian/wire'
import { useRetainedChatPresentation } from '../hooks/useRetainedChatPresentation'
import { withoutPendingCardMessages } from '../utils/screen'
import { presentAgentUpstreamError } from '../utils/agentErrorPresentation'

type ChatScreenColumnProps = {
  chatLoading: boolean
  chatWebViewRef: RefObject<ChatWebViewHandle | null>
  colors: any
  composer: ReactNode
  header: ReactNode
  handleEditQueued?: (id: string) => void
  handleDeleteQueued?: (id: string) => void
  handleImageLongPress: any
  handleResend: () => void
  handleSaveImage: (path: string) => void
  externalChannel: ExternalChannelSessionStatus | null
  hydratedMessages: any[]
  pendingCardMessages?: QueuedChatMessage[]
  initialScrollPosition: ChatScrollPosition | null | undefined
  isDark: boolean
  desktopMessages: boolean
  loadingOlder: boolean
  hideHeader?: boolean
  machineId: string | null
  sessionId: string
  presentationToken: string | null
  onOpenAttachmentPreview: (path: string, imagePaths?: string[]) => void
  onSessionPress?: (sessionId: string) => void
  onLinkPress?: (url: string) => boolean
  onAttachmentPreviewRequest?: (request: {
    path: string
    name?: string
    mimeType?: string
  }) => Promise<string | null>
  onMessagesPresented: (presentationToken: string) => void
  onOpenExternalChannel?: () => void
  onToolDetailRequest?: (request: {
    messageId: string
    toolIndex: number
    name?: string
    detailRef?: unknown
  }) => void
  onScrollState: (
    dist: number,
    scrollingUp: boolean,
    scrollTop?: number,
    distanceFromTop?: number,
  ) => void
  onScrollToBottom: () => void
  runPhase: ChatRunPhase
  activeToolCallCount?: number
  showScrollBtn: boolean
  t: (key: string, options?: any) => string
  isTyping: boolean
  scrollCommand: { action: 'top' | 'bottom'; id: number } | null
}

export function ChatScreenColumn(incoming: ChatScreenColumnProps) {
  const props = useRetainedChatPresentation(incoming)
  const {
    chatLoading,
    chatWebViewRef,
    colors,
    composer,
    header,
    handleEditQueued,
    handleDeleteQueued,
    handleImageLongPress,
    handleResend,
    handleSaveImage,
    externalChannel,
    hydratedMessages,
    initialScrollPosition,
    isDark,
    desktopMessages,
    isTyping,
    loadingOlder,
    hideHeader = false,
    machineId,
    sessionId,
    presentationToken,
    onOpenAttachmentPreview,
    onSessionPress,
    onLinkPress,
    onAttachmentPreviewRequest,
    onMessagesPresented,
    onOpenExternalChannel,
    onToolDetailRequest,
    onScrollState,
    onScrollToBottom,
    runPhase,
    activeToolCallCount,
    scrollCommand,
    showScrollBtn,
    t,
  } = props
  const messagesWithWeChatRpaDelivery = useMemo(
    () => decorateMessagesWithWeChatRpaPendingReplies(
      withoutPendingCardMessages(hydratedMessages, props.pendingCardMessages ?? []),
      externalChannel,
    ),
    [externalChannel, hydratedMessages, props.pendingCardMessages],
  )
  const presentedMessages = useMemo(
    () => messagesWithWeChatRpaDelivery.map((message) =>
      message.role === 'agent'
        ? { ...message, content: presentAgentUpstreamError(message.content, t) }
        : message,
    ),
    [messagesWithWeChatRpaDelivery, t],
  )
  const handleTimelineImageLongPress = useCallback(
    (path: string) => handleImageLongPress(
      (key: string, fallback: string) => t(key, fallback),
      () => onOpenAttachmentPreview(path),
      () => { void handleSaveImage(path) },
    ),
    [handleImageLongPress, handleSaveImage, onOpenAttachmentPreview, t],
  )

  return (
    <>
      <RecoverableSection scope="header" resetKey={sessionId}>{!hideHeader ? header : null}</RecoverableSection>

      <WeChatRpaDeliveryNotice
        colors={colors}
        externalChannel={externalChannel}
        messages={messagesWithWeChatRpaDelivery}
        onPress={() => {
          const deliveryMessage = messagesWithWeChatRpaDelivery.find(
            (message) => message?.channelDelivery || message?.wechatRpaDelivery,
          )
          if (deliveryMessage?.id) {
            chatWebViewRef.current?.scrollToMessage(deliveryMessage.id)
            return
          }
          onOpenExternalChannel?.()
        }}
        t={t}
      />

      <View style={styles.messageViewport}>
        <RecoverableSection scope="timeline" resetKey={sessionId} fill>
        {initialScrollPosition !== undefined ? (
          <ChatWebView
            ref={chatWebViewRef}
            messages={presentedMessages}
            runPhase={runPhase}
            activeToolCallCount={activeToolCallCount}
            isTyping={isTyping}
            isLoading={chatLoading}
            colors={colors}
            isDark={isDark}
            desktop={desktopMessages}
            presentationToken={presentationToken}
            onMessagesPresented={onMessagesPresented}
            onResourcePress={onOpenAttachmentPreview}
            onSessionPress={onSessionPress}
            onLinkPress={onLinkPress}
            onAttachmentPreviewRequest={onAttachmentPreviewRequest}
            onImageLongPress={handleTimelineImageLongPress}
            onResend={handleResend}
            onEditQueued={handleEditQueued}
            onDeleteQueued={handleDeleteQueued}
            onToolDetailRequest={onToolDetailRequest}
            onScrollState={onScrollState}
            loadingOlder={loadingOlder}
            scrollCommand={scrollCommand}
            initialScrollPosition={initialScrollPosition}
          />
        ) : null}
        </RecoverableSection>
        {showScrollBtn && desktopMessages ? <DesktopScrollToLatestButton colors={colors} onPress={onScrollToBottom} /> : showScrollBtn ? (
          <View style={styles.scrollToBottomWrap} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('scroll_to_bottom')}
              style={[
                styles.scrollToBottomBtn,
                desktopMessages ? styles.desktopScrollToBottomBtn : null,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              onPress={onScrollToBottom}
            >
              <Feather name="chevron-down" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <ProjectTaskCoordinationNotice sessionId={sessionId} machineId={machineId} />
      <AcpPermissionNotice
        colors={colors}
        machineId={machineId}
        sessionId={sessionId}
        messages={messagesWithWeChatRpaDelivery}
        visible={runPhase === 'waiting_approval' || runPhase === 'waiting_user_input'}
        t={t}
      />

      <RecoverableSection scope="composer" resetKey={sessionId}>{composer}</RecoverableSection>
    </>
  )
}

function AcpPermissionNotice({ colors, machineId, sessionId, messages, visible, t }: {
  colors: any
  machineId: string | null
  sessionId: string
  messages: ChatMessage[]
  visible: boolean
  t: (key: string, options?: any) => string
}) {
  const [responding, setResponding] = useState('')
  const [responded, setResponded] = useState('')
  const [error, setError] = useState('')
  const { height } = useWindowDimensions()
  const approval = [...messages].reverse().find((message) => message?.approval?.permission)?.approval
  const permission = approval?.permission
  if (!visible || !permission || responded === permission.id) return null
  const respond = async (optionId: string) => {
    if (!machineId || responding) return
    setResponding(optionId)
    setError('')
    try {
      const response = await accountRuntime.requestMachine(
        machineId,
        'agent.permission.respond',
        { sessionId, permissionId: permission.id, optionId },
        { connectTimeoutMs: 15_000, responseTimeoutMs: 30_000 },
      )
      if (!response.ok) throw new Error(response.error ?? 'permission_response_failed')
      setResponded(permission.id)
    } catch {
      setError(t('acp_permission_response_failed'))
    } finally {
      setResponding('')
    }
  }
  return <ScrollView
    accessibilityLiveRegion="polite"
    keyboardShouldPersistTaps="handled"
    style={{ maxHeight: Math.max(180, height * 0.45), flexGrow: 0 }}
    contentContainerStyle={[styles.permissionNotice, { backgroundColor: colors.surface, borderColor: colors.border }]}
  >
    <Text style={[styles.permissionTitle, { color: colors.text }]}>{approval.title || t('approval_pending_title')}</Text>
    {approval.content ? (
      <Text style={[styles.permissionContent, { color: colors.textSecondary }]}>{approval.content}</Text>
    ) : null}
    {permission.questions?.length ? <AgentUserInputForm key={permission.id} questions={permission.questions} colors={colors} busy={Boolean(responding)} onSubmit={respond} /> : <View style={styles.permissionActions}>
      {permission.options.map((option: { id: string; name: string; kind: string }) => <Pressable
        key={option.id}
        accessibilityRole="button"
        accessibilityLabel={option.name}
        accessibilityState={{ busy: responding === option.id, disabled: Boolean(responding) }}
        disabled={Boolean(responding)}
        onPress={() => void respond(option.id)}
        style={[styles.permissionButton, {
          borderColor: colors.border,
          backgroundColor: option.kind.startsWith('allow') ? colors.brand : colors.bg,
        }]}
      >
        {responding === option.id ? <ActivityIndicator size="small" color={option.kind.startsWith('allow') ? '#fff' : colors.text} /> :
          <Text style={[styles.permissionButtonText, { color: option.kind.startsWith('allow') ? '#fff' : colors.text }]}>{option.name}</Text>}
      </Pressable>)}
    </View>}
    {error ? <Text accessibilityRole="alert" style={[styles.permissionError, { color: colors.error }]}>{error}</Text> : null}
  </ScrollView>
}

function decorateMessagesWithWeChatRpaPendingReplies(
  messages: any[],
  externalChannel: ExternalChannelSessionStatus | null,
): any[] {
  if (externalChannel?.type !== 'wechat-rpa') return messages
  const pendingReplies = Array.isArray(externalChannel.wechatRpaPendingReplies)
    ? externalChannel.wechatRpaPendingReplies.filter(isRenderableWeChatRpaPendingReply)
    : []
  if (pendingReplies.length === 0) return messages

  const byMessageId = new Map<string, WeChatRpaPendingReplyProjection>()
  for (const reply of pendingReplies) {
    const replyId = normalizePendingReplyMessageKey(reply.replyId)
    if (replyId && !byMessageId.has(replyId)) byMessageId.set(replyId, reply)
    const idempotencyKey = normalizePendingReplyMessageKey(reply.idempotencyKey)
    if (idempotencyKey && !byMessageId.has(idempotencyKey)) byMessageId.set(idempotencyKey, reply)
  }
  if (byMessageId.size === 0) return messages

  let changed = false
  const decorated = messages.map((message) => {
    const messageId = normalizePendingReplyMessageKey(message?.id)
    const delivery = messageId ? byMessageId.get(messageId) : null
    if (!delivery) return message
    changed = true
    return {
      ...message,
      wechatRpaDelivery: delivery,
    }
  })
  return changed ? decorated : messages
}

function isRenderableWeChatRpaPendingReply(
  reply: WeChatRpaPendingReplyProjection | null | undefined,
): reply is WeChatRpaPendingReplyProjection {
  if (!reply?.idempotencyKey) return false
  return (
    reply.status === 'queued' || reply.status === 'sending' || reply.status === 'sent_unconfirmed'
  )
}

function normalizePendingReplyMessageKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function WeChatRpaDeliveryNotice({
  colors,
  externalChannel,
  messages,
  onPress,
  t,
}: {
  colors: any
  externalChannel: ExternalChannelSessionStatus | null
  messages: any[]
  onPress: () => void
  t: (key: string, options?: any) => string
}) {
  const summary = summarizeWeChatRpaDeliveryNotice(externalChannel, messages)
  if (!summary) return null

  return (
    <View style={styles.wechatDeliveryNoticeWrap}>
      <Pressable
        style={[
          styles.wechatDeliveryNotice,
          { backgroundColor: `${colors.warning}10`, borderColor: `${colors.warning}45` },
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t(summary.titleKey, summary.options)}
      >
        <Feather name="message-circle" size={15} color={colors.warning} />
        <View style={styles.wechatDeliveryNoticeTextBox}>
          <Text
            style={[styles.wechatDeliveryNoticeTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {t(summary.titleKey, summary.options)}
          </Text>
          <Text
            style={[styles.wechatDeliveryNoticeDesc, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {t(summary.descKey)}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.textTertiary} />
      </Pressable>
    </View>
  )
}

function summarizeWeChatRpaDeliveryNotice(
  externalChannel: ExternalChannelSessionStatus | null,
  messages: any[],
): { titleKey: string; descKey: string; options?: Record<string, unknown> } | null {
  if (externalChannel?.type !== 'wechat-rpa') return null
  const pendingRaw = Number(externalChannel.wechatRpaPendingReplyCount ?? 0)
  const pendingCount = Number.isFinite(pendingRaw) ? Math.max(0, Math.floor(pendingRaw)) : 0
  const terminalIssueCount = messages.filter((message) => {
    const status = message?.channelDelivery?.status
    return typeof status === 'string' && (status.startsWith('failed') || status === 'manual_review')
  }).length

  if (pendingCount > 0 && terminalIssueCount > 0) {
    return {
      titleKey: 'wechat_delivery_notice_mixed',
      descKey: 'wechat_delivery_notice_tap',
      options: { pending: pendingCount, issue: terminalIssueCount },
    }
  }
  if (pendingCount > 0) {
    return {
      titleKey: 'wechat_delivery_notice_pending',
      descKey: 'wechat_delivery_notice_open_channel',
      options: { count: pendingCount },
    }
  }
  if (terminalIssueCount > 0) {
    return {
      titleKey: 'wechat_delivery_notice_issue',
      descKey: 'wechat_delivery_notice_tap',
      options: { count: terminalIssueCount },
    }
  }
  if (
    externalChannel.wechatRpaRuntimeState === 'interrupted' ||
    externalChannel.wechatRpaRuntimeState === 'cooldown'
  ) {
    return {
      titleKey: 'wechat_delivery_notice_runtime_paused',
      descKey: 'wechat_delivery_notice_open_channel',
    }
  }
  if (externalChannel.wechatRpaRuntimeState === 'retrying') {
    return {
      titleKey: 'wechat_delivery_notice_retrying',
      descKey: 'wechat_delivery_notice_open_channel',
    }
  }
  return null
}
