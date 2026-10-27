// @arch docs/architecture/app/chat-attachments-preview.md
// @arch docs/architecture/app/chat-voice-draft.md
// @arch docs/architecture/app/modular-features.md#移动端长对话渲染
// @test src/__tests__/chat-webview-script.test.ts

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react'
import { useChatFontSize } from '../../hooks/useChatFontSize'
import { chatFontCss } from '../../features/chat/preferences/chatFontSize'
import { ActivityIndicator, Clipboard, Linking, Platform, View, useWindowDimensions } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { Directory, File as ExpoFile, Paths } from 'expo-file-system'
import { useTranslation } from 'react-i18next'
import {
  incrementRuntimeMetric,
  type ChatAttachment,
  type ChatMessage,
  type ChatRunPhase,
  type ToolCall,
} from '@shennian/shared'
import { CODEX_DESKTOP_SEND_UNAVAILABLE } from '@shennian/wire'
import type { Colors } from '../../hooks/useTheme'
import { getServerUrl } from '../../config/server'
import {
  CAPTURE_BRAND_LOGO_DATA_URL,
  createCaptureBrandQrSvg,
  getCaptureBrandHref,
} from './captureBranding'
import { createChatHtml } from './webview/bundledHtml'
import { startPresentationAckRetry } from '../../features/chat/utils/presentationAckRetry'
import { parseWorkerSessionUrl } from '../../features/chat/utils/workerSessionLink'

type RNToWeb =
  | {
      type: 'init'
      theme: ThemePayload
      messages: WebMessage[]
      runPhase: ChatRunPhase
      activeToolCallCount?: number
      initialScroll?: InitialScrollTarget
    }
  | { type: 'addMessage'; message: WebMessage }
  | { type: 'addMessages'; messages: WebMessage[] }
  | { type: 'streamToken'; msgId: string; token: string }
  | { type: 'updateContent'; msgId: string; content: string }
  | { type: 'streamEnd'; msgId: string }
  | { type: 'updateTimestamp'; msgId: string; ts: number }
  | { type: 'updateStatus'; msgId: string; status: string | null; ephemeralFailure?: boolean }
  | { type: 'updateThinking'; msgId: string; thinking: string }
  | { type: 'updateToolCall'; msgId: string; toolCalls: ToolCall[] }
  | {
      type: 'updateToolDetail'
      msgId: string
      toolIndex: number
      name?: string
      status?: string
      command?: string
      argsSummary?: unknown
      result?: string
      resultOmitted?: boolean
      detailStatus?: ToolCall['detailStatus']
      detailMessage?: string
    }
  | { type: 'updateAttachments'; msgId: string; attachments: ChatAttachment[] }
  | {
      type: 'updateAttachmentPreview'
      msgId: string
      path: string
      name?: string
      mimeType?: string
      previewUrl: string | null
    }
  | { type: 'viewportChanged' }
  | { type: 'setTheme'; theme: ThemePayload }
  | { type: 'setRunPhase'; runPhase: ChatRunPhase; activeToolCallCount?: number }
  | { type: 'scrollToBottom'; animated?: boolean }
  | { type: 'scrollToTop'; animated?: boolean }
  | { type: 'scrollToMessage'; messageId: string; animated?: boolean }
  | { type: 'prependMessages'; messages: WebMessage[] }
  | { type: 'ackPresentation'; presentationToken: string }
  | {
      type: 'captureLongScreenshot'
      requestId: string
      brandUrl: string
      brandLogoDataUrl: string
      brandQrSvg: string
    }
  | { type: 'clear' }

type ThemePayload = { isDark: boolean; colors: Colors }

type WebMessage = {
  id: string
  role: 'user' | 'agent'
  ts: number
  content: string
  attachments?: ChatAttachment[]
  thinking?: string
  toolCalls?: ToolCall[]
  status?: string
  ephemeralFailure?: boolean
  queueMessageId?: string
  channelDelivery?: ChatMessage['channelDelivery']
  wechatRpaDelivery?: ChatMessage['wechatRpaDelivery']
  divider?: string
}

type WebToRN =
  | { type: 'ready' }
  | { type: 'messagesPresented'; presentationToken: string }
  | { type: 'linkPress'; url: string }
  | { type: 'resourcePress'; path: string; imagePaths?: string[] }
  | { type: 'imageLongPress'; path: string }
  | { type: 'resend' }
  | { type: 'editQueued'; queueMessageId: string }
  | { type: 'deleteQueued'; queueMessageId: string }
  | { type: 'copyCode'; code: string }
  | { type: 'copyMessage'; text: string }
  | {
      type: 'toolDetailRequest'
      messageId: string
      toolIndex: number
      name?: string
      detailRef?: unknown
    }
  | {
      type: 'attachmentPreviewRequest'
      messageId: string
      path: string
      name?: string
      mimeType?: string
    }
  | { type: 'scrollState'; distanceFromBottom: number; distanceFromTop?: number; scrollTop?: number }
  | {
      type: 'perfSnapshot'
      metrics: Record<string, { count?: number; totalMs?: number; maxMs?: number }>
    }
  | { type: 'longScreenshot'; requestId: string; dataUrl: string; width: number; height: number }
  | { type: 'longScreenshotError'; requestId: string; error?: string }

export type LongScreenshotResult = {
  dataUrl: string
  width: number
  height: number
}

export type ChatScrollPosition = {
  scrollTop: number
  distanceFromBottom: number
}

type InitialScrollTarget =
  | { kind: 'bottom' }
  | { kind: 'position'; scrollTop: number; distanceFromBottom?: number }

function isBridgeSafePreviewUrl(value: unknown): value is string {
  return typeof value === 'string' && /^(?:file|content|blob|https?):/i.test(value)
}

function attachmentToWeb(attachment: ChatAttachment): ChatAttachment {
  const previewData = attachment.previewData
  const bridgeSafePreview = isBridgeSafePreviewUrl(previewData) ? previewData : undefined
  return bridgeSafePreview === previewData
    ? attachment
    : { ...attachment, previewData: bridgeSafePreview }
}

function chatMsgToWeb(msg: ChatMessage): WebMessage {
  return {
    id: msg.id,
    role: msg.role,
    ts: msg.ts,
    content: msg.content,
    attachments: msg.attachments?.map(attachmentToWeb),
    thinking: msg.thinking,
    toolCalls: msg.toolCalls,
    status: msg.status,
    ephemeralFailure: msg.error?.message === CODEX_DESKTOP_SEND_UNAVAILABLE,
    queueMessageId: msg.queueMessageId,
    channelDelivery: msg.channelDelivery,
    wechatRpaDelivery: msg.wechatRpaDelivery,
    divider: msg.divider,
  }
}

function attachmentListsEqual(
  left: ChatAttachment[] | undefined,
  right: ChatAttachment[] | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return !left?.length && !right?.length
  if (left.length !== right.length) return false
  return left.every((attachment, index) => {
    const other = right[index]
    return Boolean(
      other &&
        attachment.path === other.path &&
        attachment.name === other.name &&
        attachment.mimeType === other.mimeType &&
        attachment.kind === other.kind &&
        attachment.previewData === other.previewData,
    )
  })
}

function copyToClipboard(text: string) {
  if (!text) return
  if (Platform.OS === 'web') {
    navigator.clipboard?.writeText(text)
    return
  }
  Clipboard.setString(text)
}

export interface ChatWebViewHandle {
  scrollToBottom: () => void
  scrollToTop: () => void
  scrollToMessage: (messageId: string) => void
  captureLongScreenshot: () => Promise<LongScreenshotResult>
}

interface ChatWebViewProps {
  messages: ChatMessage[]
  runPhase: ChatRunPhase
  activeToolCallCount?: number
  isTyping: boolean
  isLoading?: boolean
  colors: Colors
  isDark: boolean
  desktop?: boolean
  onResourcePress?: (path: string, imagePaths?: string[]) => void
  onSessionPress?: (sessionId: string) => void
  onLinkPress?: (url: string) => boolean
  onImageLongPress?: (path: string) => void
  onResend?: () => void
  onEditQueued?: (queueMessageId: string) => void
  onDeleteQueued?: (queueMessageId: string) => void
  onToolDetailRequest?: (request: {
    messageId: string
    toolIndex: number
    name?: string
    detailRef?: unknown
  }) => void
  onAttachmentPreviewRequest?: (request: {
    path: string
    name?: string
    mimeType?: string
  }) => Promise<string | null>
  onScrollState?: (
    distanceFromBottom: number,
    scrollingUp: boolean,
    scrollTop?: number,
    distanceFromTop?: number,
  ) => void
  loadingOlder?: boolean
  scrollCommand?: { action: 'top' | 'bottom'; id: number } | null
  initialScrollPosition?: ChatScrollPosition | null
  presentationToken?: string | null
  onMessagesPresented?: (presentationToken: string) => void
}

export const ChatWebView = forwardRef<ChatWebViewHandle, ChatWebViewProps>(function ChatWebView(
  {
    messages,
    runPhase,
    activeToolCallCount,
    isTyping: _isTyping,
    isLoading,
    colors,
    isDark,
    onResourcePress,
    onSessionPress,
    onLinkPress,
    onImageLongPress,
    onResend,
    onEditQueued,
    onDeleteQueued,
    onToolDetailRequest,
    onAttachmentPreviewRequest,
    onScrollState,
    loadingOlder,
    scrollCommand,
    initialScrollPosition,
    presentationToken,
    onMessagesPresented,
  },
  ref,
) {
  const { t } = useTranslation()
  const webviewRef = useRef<WebView>(null)
  const [ready, setReady] = useState(false)
  const { size: chatFontSize } = useChatFontSize()
  const { fontScale } = useWindowDimensions()
  useEffect(() => {
    if (!ready) return
    const css = chatFontCss(chatFontSize, fontScale)
    webviewRef.current?.injectJavaScript(`(function(){
      var style = document.getElementById('chat-font-size');
      if (!style) { style = document.createElement('style'); style.id = 'chat-font-size'; document.head.appendChild(style); }
      style.textContent = ${JSON.stringify(css)};
    })();true;`)
  }, [ready, chatFontSize, fontScale])

  const prevMsgRef = useRef<ChatMessage[]>([])
  const prevRunPhaseRef = useRef<ChatRunPhase>('idle')
  const prevActiveToolCallCountRef = useRef<number | undefined>(undefined)
  const sentInitRef = useRef(false)
  const lastDistRef = useRef(0)
  const screenshotRequestsRef = useRef(
    new Map<
      string,
      {
        resolve: (result: LongScreenshotResult) => void
        reject: (error: Error) => void
        timeout: ReturnType<typeof setTimeout>
      }
    >(),
  )
  const documentInstanceIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  const documentRevisionRef = useRef(0)
  const [source, setSource] = useState<
    { uri: string } | { html: string; baseUrl: string } | null
  >(null)

  const post = useCallback((msg: RNToWeb) => {
    webviewRef.current?.postMessage(JSON.stringify(msg))
  }, [])

  const getInitialScrollTarget = useCallback((): InitialScrollTarget => {
    if (
      initialScrollPosition &&
      Number.isFinite(initialScrollPosition.scrollTop) &&
      initialScrollPosition.scrollTop > 0 &&
      initialScrollPosition.distanceFromBottom > 150
    ) {
      return {
        kind: 'position',
        scrollTop: initialScrollPosition.scrollTop,
        distanceFromBottom: initialScrollPosition.distanceFromBottom,
      }
    }
    return { kind: 'bottom' }
  }, [initialScrollPosition])

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => post({ type: 'scrollToBottom' }),
    scrollToTop: () => post({ type: 'scrollToTop', animated: true }),
    scrollToMessage: (messageId: string) => {
      if (!messageId.trim()) return
      post({ type: 'scrollToMessage', messageId, animated: true })
    },
    captureLongScreenshot: () =>
      new Promise<LongScreenshotResult>((resolve, reject) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const timeout = setTimeout(() => {
          screenshotRequestsRef.current.delete(requestId)
          reject(new Error('timeout'))
        }, 12000)
        screenshotRequestsRef.current.set(requestId, { resolve, reject, timeout })
        const brandUrl = getServerUrl()
        post({
          type: 'captureLongScreenshot',
          requestId,
          brandUrl,
          brandLogoDataUrl: CAPTURE_BRAND_LOGO_DATA_URL,
          brandQrSvg: createCaptureBrandQrSvg(getCaptureBrandHref(brandUrl)),
        })
      }),
  }))

  useEffect(() => {
    if (!scrollCommand || !ready) return
    if (scrollCommand.action === 'bottom') {
      post({ type: 'scrollToBottom' })
    } else {
      post({ type: 'scrollToTop', animated: true })
    }
  }, [scrollCommand, ready, post])

  useEffect(() => {
    if (!ready) return
    if (!sentInitRef.current) {
      // History hydration publishes the loaded window before it clears the
      // loading flag. Do not initialize an empty document first: otherwise
      // the same cold-open history is forced through the incremental bridge
      // path and the user waits for a second synchronous WebView rebuild.
      if (isLoading && messages.length === 0) return
      post({
        type: 'init',
        theme: { isDark, colors },
        messages: messages.map(chatMsgToWeb),
        runPhase,
        activeToolCallCount,
        initialScroll: getInitialScrollTarget(),
      })
      sentInitRef.current = true
      prevMsgRef.current = [...messages]
      prevRunPhaseRef.current = runPhase
      prevActiveToolCallCountRef.current = activeToolCallCount
      return
    }

    const prev = prevMsgRef.current
    const next = messages

    if (next.length === 0 && prev.length > 0) {
      if (!isLoading) {
        post({ type: 'clear' })
      }
      prevMsgRef.current = []
      sentInitRef.current = false
      return
    }

    const prevById = new Map(prev.map((m) => [m.id, m]))
    const oldIds = new Set(prevById.keys())
    const nextIds = new Set(next.map((m) => m.id))
    const hasNewEarlierMessages = next.some((msg) => !oldIds.has(msg.id) && prev[0] && msg.ts < prev[0].ts)
    const hasRemovedMessages = prev.some((msg) => !nextIds.has(msg.id))
    const prevStartIndex = prev.length > 0 ? next.findIndex((msg) => msg.id === prev[0]?.id) : -1
    const canPrependOnly =
      hasNewEarlierMessages &&
      !hasRemovedMessages &&
      prevStartIndex > 0 &&
      prev.every((msg, index) => next[prevStartIndex + index]?.id === msg.id)

    if (canPrependOnly) {
      post({
        type: 'prependMessages',
        messages: next.slice(0, prevStartIndex).map(chatMsgToWeb),
      })
      prevMsgRef.current = [...next]
      prevRunPhaseRef.current = runPhase
      return
    }

    if (hasNewEarlierMessages || hasRemovedMessages) {
      post({
        type: 'init',
        theme: { isDark, colors },
        messages: next.map(chatMsgToWeb),
        runPhase,
        activeToolCallCount,
        initialScroll: { kind: 'bottom' },
      })
      prevMsgRef.current = [...next]
      prevRunPhaseRef.current = runPhase
      prevActiveToolCallCountRef.current = activeToolCallCount
      return
    }

    // A genuinely empty conversation can still receive its first local or
    // restored history after the WebView was initialized. Treat that as one
    // replacement snapshot rather than N ordered inserts. Besides preserving
    // the initial scroll target, this keeps cold-open history linear.
    if (prev.length === 0 && next.length > 0) {
      post({
        type: 'init',
        theme: { isDark, colors },
        messages: next.map(chatMsgToWeb),
        runPhase,
        activeToolCallCount,
        initialScroll: getInitialScrollTarget(),
      })
      prevMsgRef.current = [...next]
      prevRunPhaseRef.current = runPhase
      prevActiveToolCallCountRef.current = activeToolCallCount
      return
    }

    const addedMessages = next.filter((msg) => !prevById.has(msg.id))
    if (addedMessages.length === 1) {
      post({ type: 'addMessage', message: chatMsgToWeb(addedMessages[0]) })
    } else if (addedMessages.length > 1) {
      post({ type: 'addMessages', messages: addedMessages.map(chatMsgToWeb) })
    }

    for (const msg of next) {
      const old = prevById.get(msg.id)
      if (old) {
        if (msg.ts !== old.ts) {
          post({ type: 'updateTimestamp', msgId: msg.id, ts: msg.ts })
        }
        if (msg.content !== old.content && msg.role === 'agent') {
          if (msg.content.startsWith(old.content)) {
            const token = msg.content.slice(old.content.length)
            if (token) {
              post({ type: 'streamToken', msgId: msg.id, token })
            }
          } else {
            post({ type: 'updateContent', msgId: msg.id, content: msg.content })
          }
        }
        if (msg.status !== old.status || msg.error?.message !== old.error?.message) {
          post({
            type: 'updateStatus',
            msgId: msg.id,
            status: msg.status ?? null,
            ephemeralFailure: msg.error?.message === CODEX_DESKTOP_SEND_UNAVAILABLE,
          })
        }
        if (msg.queueMessageId !== old.queueMessageId) {
          post({
            type: 'init',
            theme: { isDark, colors },
            messages: next.map(chatMsgToWeb),
            runPhase,
            activeToolCallCount,
            initialScroll: { kind: 'bottom' },
          })
          prevMsgRef.current = [...next]
          prevRunPhaseRef.current = runPhase
          prevActiveToolCallCountRef.current = activeToolCallCount
          return
        }
        if (msg.thinking !== old.thinking && msg.thinking) {
          post({ type: 'updateThinking', msgId: msg.id, thinking: msg.thinking })
        }
        if (msg.toolCalls !== old.toolCalls && msg.toolCalls) {
          post({ type: 'updateToolCall', msgId: msg.id, toolCalls: msg.toolCalls })
        }
        if (!attachmentListsEqual(msg.attachments, old.attachments)) {
          post({
            type: 'updateAttachments',
            msgId: msg.id,
            attachments: msg.attachments?.map(attachmentToWeb) ?? [],
          })
        }
      }
    }

    prevMsgRef.current = [...next]
  }, [
    ready,
    messages,
    post,
    isDark,
    colors,
    isLoading,
    runPhase,
    activeToolCallCount,
    getInitialScrollTarget,
  ])

  useEffect(() => {
    if (!ready || !sentInitRef.current || !presentationToken) return
    return startPresentationAckRetry(presentationToken, (token) => {
      post({ type: 'ackPresentation', presentationToken: token })
    })
    // The preceding init effect can move sentInitRef from false to true when
    // loading completes. Re-evaluate this effect for that transition too.
  }, [isLoading, messages, post, presentationToken, ready])

  const webPerfSnapshotRef = useRef<
    Record<string, { count?: number; totalMs?: number; maxMs?: number }>
  >({})

  useEffect(() => {
    if (!ready || !sentInitRef.current) return
    if (
      runPhase !== prevRunPhaseRef.current ||
      activeToolCallCount !== prevActiveToolCallCountRef.current
    ) {
      // setRunPhase owns finalization and the structural virtual-window
      // rebuild. Sending streamEnd first would parse the final Markdown and
      // then parse it again during that required rebuild.
      post({ type: 'setRunPhase', runPhase, activeToolCallCount })
      prevRunPhaseRef.current = runPhase
      prevActiveToolCallCountRef.current = activeToolCallCount
    }
  }, [ready, runPhase, activeToolCallCount, post])

  useEffect(() => {
    if (!ready || !sentInitRef.current) return
    post({ type: 'setTheme', theme: { isDark, colors } })
  }, [ready, isDark, colors, post])

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let data: WebToRN
      try {
        data = JSON.parse(event.nativeEvent.data) as WebToRN
      } catch {
        return
      }
      switch (data.type) {
        case 'ready':
          setReady(true)
          break
        case 'messagesPresented':
          onMessagesPresented?.(data.presentationToken)
          break
        case 'linkPress':
          {
            const workerSessionId = parseWorkerSessionUrl(data.url)
            if (workerSessionId) onSessionPress?.(workerSessionId)
            else if (data.url.startsWith('shennian://session/')) break
            else if (!onLinkPress?.(data.url)) Linking.openURL(data.url).catch(() => {})
          }
          break
        case 'resourcePress':
          onResourcePress?.(data.path, data.imagePaths)
          break
        case 'imageLongPress':
          onImageLongPress?.(data.path)
          break
        case 'resend':
          onResend?.()
          break
        case 'editQueued':
          onEditQueued?.(data.queueMessageId)
          break
        case 'deleteQueued':
          onDeleteQueued?.(data.queueMessageId)
          break
        case 'copyCode':
          copyToClipboard(data.code)
          break
        case 'copyMessage':
          copyToClipboard(data.text)
          break
        case 'toolDetailRequest':
          onToolDetailRequest?.({
            messageId: data.messageId,
            toolIndex: data.toolIndex,
            name: data.name,
            detailRef: data.detailRef,
          })
          break
        case 'attachmentPreviewRequest':
          if (!onAttachmentPreviewRequest) break
          void onAttachmentPreviewRequest({
            path: data.path,
            name: data.name,
            mimeType: data.mimeType,
          })
            .then((previewUrl) => {
              post({
                type: 'updateAttachmentPreview',
                msgId: data.messageId,
                path: data.path,
                name: data.name,
                mimeType: data.mimeType,
                previewUrl: isBridgeSafePreviewUrl(previewUrl) ? previewUrl : null,
              })
            })
            .catch(() => {
              post({
                type: 'updateAttachmentPreview',
                msgId: data.messageId,
                path: data.path,
                name: data.name,
                mimeType: data.mimeType,
                previewUrl: null,
              })
            })
          break
        case 'scrollState': {
          const scrollingUp = data.distanceFromBottom > lastDistRef.current
          lastDistRef.current = data.distanceFromBottom
          onScrollState?.(data.distanceFromBottom, scrollingUp, data.scrollTop, data.distanceFromTop)
          break
        }
        case 'perfSnapshot': {
          const previous = webPerfSnapshotRef.current
          for (const [name, metric] of Object.entries(data.metrics)) {
            const oldMetric = previous[name]
            const countDelta = Math.max(0, (metric.count ?? 0) - (oldMetric?.count ?? 0))
            const durationDelta = Math.max(
              0,
              (metric.totalMs ?? 0) - (oldMetric?.totalMs ?? 0),
            )
            if (countDelta) incrementRuntimeMetric(`webview.${name}.count`, countDelta)
            if (durationDelta) {
              incrementRuntimeMetric(`webview.${name}.duration_ms`, durationDelta)
            }
          }
          webPerfSnapshotRef.current = data.metrics
          break
        }
        case 'longScreenshot': {
          const request = screenshotRequestsRef.current.get(data.requestId)
          if (!request) break
          clearTimeout(request.timeout)
          screenshotRequestsRef.current.delete(data.requestId)
          request.resolve({ dataUrl: data.dataUrl, width: data.width, height: data.height })
          break
        }
        case 'longScreenshotError': {
          const request = screenshotRequestsRef.current.get(data.requestId)
          if (!request) break
          clearTimeout(request.timeout)
          screenshotRequestsRef.current.delete(data.requestId)
          request.reject(new Error(data.error || 'capture_failed'))
          break
        }
      }
    },
    [
      onAttachmentPreviewRequest,
      onEditQueued,
      onDeleteQueued,
      onImageLongPress,
      onMessagesPresented,
      onLinkPress,
      onResend,
      onResourcePress,
      onSessionPress,
      onScrollState,
      onToolDetailRequest,
      post,
    ],
  )

  const bgColor = isDark ? '#0a0a0a' : '#ffffff'

  const htmlDocument = useMemo(() => {
    const i18nScript = `window._shennianPerfEnabled=${JSON.stringify(
      process.env.EXPO_PUBLIC_SHENNIAN_PERF_DIAGNOSTICS === '1',
    )};window._i18n=${JSON.stringify({
      msgSending: t('msg_sending'),
      msgStillSending: t('msg_still_sending'),
      msgUncertain: t('msg_uncertain'),
      msgQueued: t('msg_queued'),
      msgEditQueued: t('msg_edit_queued'),
      msgDeleteQueued: t('msg_delete_queued'),
      msgResend: t('msg_resend'),
      msgSendFailed: t('msg_send_failed'),
      copy: t('copy'),
      copyFullText: t('copy_full_text'),
      copied: t('copied'),
      timeYesterday: t('time_yesterday'),
      arguments: t('arguments'),
      result: t('result'),
      command: t('command'),
      toolCall: t('tool_call'),
      toolCodeTruncated: t('tool_code_truncated', { count: '__COUNT__' }),
      toolGroupCommands: t('tool_group_commands', { count: '__COUNT__' }),
      toolGroupTools: t('tool_group_tools', { count: '__COUNT__' }),
      toolGroupToolsRunning: t('tool_group_tools_running', { count: '__COUNT__' }),
      toolGroupMore: t('tool_group_more', { count: '__COUNT__' }),
      toolStatusRunning: t('tool_status_running'),
      toolStatusCompleted: t('tool_status_completed'),
      toolStatusFailed: t('tool_status_failed'),
      toolDetailAvailableLabel: t('tool_detail_available_label'),
      toolDetailUnavailableLabel: t('tool_detail_unavailable_label'),
      toolDetailLoading: t('tool_detail_loading'),
      toolDetailCta: t('tool_detail_cta'),
      toolDetailOffline: t('tool_detail_offline'),
      toolDetailUnsupported: t('tool_detail_unsupported'),
      toolDetailUnavailable: t('tool_detail_unavailable'),
      toolDetailError: t('tool_detail_error'),
      toolResultOmitted: t('tool_result_omitted'),
      processMessages: t('process_messages', { count: '__COUNT__' }),
      processTools: t('process_tools', { count: '__COUNT__' }),
      processMessagesWithTools: t('process_messages_with_tools', {
        messages: '__MESSAGES__',
        tools: '__TOOLS__',
      }),
      wechatDeliveryKicker: t('wechat_delivery_status_kicker'),
      wechatDeliveryFailedTitle: t('wechat_delivery_failed_title'),
      wechatDeliveryTimeoutTitle: t('wechat_delivery_timeout_title'),
      wechatDeliveryManualReviewTitle: t('wechat_delivery_manual_review_title'),
      wechatDeliveryOriginalContent: t('wechat_delivery_original_content'),
      wechatDeliveryCopyOriginal: t('wechat_delivery_copy_original'),
      wechatDeliveryInlineQueued: t('wechat_delivery_inline_queued'),
      wechatDeliveryInlineWaitingIdle: t('wechat_delivery_inline_waiting_idle'),
      wechatDeliveryInlineSending: t('wechat_delivery_inline_sending'),
      wechatDeliveryInlineConfirming: t('wechat_delivery_inline_confirming'),
    })};`
    return createChatHtml({ i18nScript, theme: { isDark, colors } })
  }, [colors, isDark, t])

  useEffect(() => {
    let documentFile: ExpoFile | null = null
    sentInitRef.current = false
    prevMsgRef.current = []
    setReady(false)

    try {
      const directory = new Directory(Paths.cache, 'chat-webview-documents')
      directory.create({ idempotent: true, intermediates: true })
      const revision = ++documentRevisionRef.current
      documentFile = new ExpoFile(
        directory,
        `${documentInstanceIdRef.current}-${revision}.html`,
      )
      documentFile.create({ overwrite: true, intermediates: true })
      documentFile.write(htmlDocument)
      setSource({ uri: documentFile.uri })
    } catch {
      // Keep the transcript available if the cache directory is temporarily
      // unavailable. Inline HTML cannot read cached file:// thumbnails on iOS,
      // but is still a safer fallback than a blank conversation.
      setSource({ html: htmlDocument, baseUrl: Paths.cache.uri })
    }

    return () => {
      if (!documentFile?.exists) return
      try {
        documentFile.delete()
      } catch {
        // Temporary WebView documents are best-effort cache files.
      }
    }
  }, [htmlDocument])

  useEffect(
    () => () => {
      for (const request of screenshotRequestsRef.current.values()) {
        clearTimeout(request.timeout)
        request.reject(new Error('unmounted'))
      }
      screenshotRequestsRef.current.clear()
    },
    [],
  )

  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      {loadingOlder ? (
        <View style={{ paddingVertical: 6, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.textTertiary} />
        </View>
      ) : null}
      {source ? (
        <WebView
          ref={webviewRef}
          source={source}
          onMessage={handleMessage}
          onLayout={() => post({ type: 'viewportChanged' })}
          style={{ flex: 1, backgroundColor: bgColor }}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          originWhitelist={['*']}
          javaScriptEnabled
          allowingReadAccessToURL={Paths.cache.uri}
          allowFileAccess
          allowFileAccessFromFileURLs
          domStorageEnabled={false}
          bounces
          overScrollMode="never"
          contentMode="mobile"
          textInteractionEnabled
          allowsLinkPreview={false}
          startInLoadingState={false}
          containerStyle={{ backgroundColor: bgColor }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={colors.textTertiary} />
        </View>
      )}
    </View>
  )
})
