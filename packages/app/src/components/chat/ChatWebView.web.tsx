// @arch docs/features/desktop-local-first-client.md#54-同步与服务器压力
// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/chat-web-timeline-virtualization.test.ts

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react'
import { collectMessageImagePaths } from '../../features/chat/utils/imageGallery'
import { useChatFontSize } from '../../hooks/useChatFontSize'
import { chatFontCss } from '../../features/chat/preferences/chatFontSize'
import { desktopChatProcessCss } from '../../features/desktop-chat/desktopChatProcessCss'
import { useTranslation } from 'react-i18next'
import type { ChatMessage, ChatRunPhase } from '@shennian/shared'
import type { Colors } from '../../hooks/useTheme'
import { getServerUrl } from '../../config/server'
import {
  isLocalResourceHref,
  normalizeLocalResourceHref,
} from '../../features/chat/utils/attachments'
import { shouldShowBottomWorkingIndicator } from '../../features/chat/utils/screen'
import { CHAT_CSS_WEB } from './webview/chatCss'
import {
  CAPTURE_BRAND_LOGO_DATA_URL,
  createCaptureBrandQrSvg,
  getCaptureBrandHref,
} from './captureBranding'
import {
  captureLongScreenshotFromElement,
  type LongScreenshotResult,
} from './captureLongScreenshot.web'
import { getCodeBlockCopyText, openExternalHref } from './ChatWebViewMarkdown.web'
import { formatMessageTime } from './messageTime'
import { parseWorkerSessionUrl } from '../../features/chat/utils/workerSessionLink'
import {
  RenderChatItem,
  buildRenderItems,
  isTimeSeparated,
  type ToolDetailRequest,
} from './ChatWebMessageRenderer.web'
import {
  VirtualizedWebTimeline,
  WEB_TIMELINE_SCROLL_ROOT_STYLE,
  estimateWebTimelineItemHeight,
  settleWebTimelineFollowedViewport,
  type WebTimelineHandle,
} from './webTimelineVirtualization.web'
import {
  WebAttachmentPreviewProvider,
  type WebAttachmentPreviewRequest,
} from './webAttachmentPreview.web'

function TimeSeparatorWeb({ ts }: { ts: number }) {
  const { t } = useTranslation()
  return (
    <div className="time-separator">
      <span>{formatMessageTime(ts, { yesterdayLabel: t('time_yesterday') })}</span>
    </div>
  )
}

function TypingIndicatorWeb() {
  return (
    <div className="typing-row">
      <div className="typing-bubble">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  )
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
  onToolDetailRequest?: (request: ToolDetailRequest) => void
  onAttachmentPreviewRequest?: WebAttachmentPreviewRequest
  onScrollState?: (
    distanceFromBottom: number,
    scrollingUp: boolean,
    scrollTop?: number,
    distanceFromTop?: number,
  ) => void
  loadingOlder?: boolean
  scrollCommand?: { action: 'top' | 'bottom'; id: number } | null
  presentationToken?: string | null
  onMessagesPresented?: (presentationToken: string) => void
}

const ChatWebViewComponent = forwardRef<ChatWebViewHandle, ChatWebViewProps>(function ChatWebView(
  {
    messages,
    runPhase,
    activeToolCallCount,
    isTyping,
    isLoading,
    colors,
    isDark,
    desktop = false,
    onResourcePress,
    onSessionPress,
    onLinkPress,
    onImageLongPress,
    onToolDetailRequest,
    onAttachmentPreviewRequest,
    onScrollState,
    loadingOlder,
    scrollCommand,
    presentationToken,
    onMessagesPresented,
  },
  ref,
) {
  const { size: chatFontSize } = useChatFontSize()
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<WebTimelineHandle>(null)
  const prevLenRef = useRef(0)
  const showTypingIndicator = useMemo(
    () => shouldShowBottomWorkingIndicator(runPhase, messages),
    [messages, runPhase],
  )
  const renderItems = useMemo(() => buildRenderItems(messages, runPhase), [messages, runPhase])

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => timelineRef.current?.scrollToBottom(),
      scrollToTop: () => timelineRef.current?.scrollToTop(),
      scrollToMessage: (messageId: string) => {
        if (!messageId.trim()) return
        const index = renderItems.findIndex((item) => {
          if (item.type === 'message') return item.message.id === messageId
          if (item.type === 'collapsed-run') {
            return (
              item.finalMessage.id === messageId ||
              item.messages.some((message) => message.id === messageId)
            )
          }
          return item.messages.some((message) => message.id === messageId)
        })
        if (index >= 0) timelineRef.current?.scrollToIndex(index)
      },
      captureLongScreenshot: async () => {
        const brandUrl = getServerUrl()
        if (!timelineRef.current) throw new Error('empty')
        return timelineRef.current.withAllItems(() =>
          captureLongScreenshotFromElement(
            containerRef.current,
            brandUrl,
            CAPTURE_BRAND_LOGO_DATA_URL,
            createCaptureBrandQrSvg(getCaptureBrandHref(brandUrl)),
          ),
        )
      },
    }),
    [renderItems],
  )

  useEffect(() => {
    if (!presentationToken || !onMessagesPresented) return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => onMessagesPresented(presentationToken))
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
    }
  }, [messages, onMessagesPresented, presentationToken])

  useEffect(() => {
    if (!scrollCommand || !containerRef.current) return
    if (scrollCommand.action === 'bottom') timelineRef.current?.scrollToBottom()
    else timelineRef.current?.scrollToTop()
  }, [scrollCommand])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Live Agent updates can change measured row heights several times in one
    // turn. Settle the followed viewport before paint instead of starting a
    // new smooth-scroll animation for every snapshot; explicit user scroll
    // commands keep their smooth behavior through the timeline handle.
    settleWebTimelineFollowedViewport(el, prevLenRef.current === 0)
    prevLenRef.current = messages.length
  }, [messages, isTyping, runPhase])

  const lastScrollTopRef = useRef(0)
  const scrollFrameRef = useRef(0)
  const publishScrollState = useCallback(() => {
    scrollFrameRef.current = 0
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
    onScrollState?.(
      Math.max(0, distanceFromBottom),
      el.scrollTop < lastScrollTopRef.current,
      el.scrollTop,
      el.scrollTop,
    )
    lastScrollTopRef.current = el.scrollTop
  }, [onScrollState])
  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current) return
    scrollFrameRef.current = requestAnimationFrame(publishScrollState)
  }, [publishScrollState])

  useEffect(
    () => () => {
      if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current)
    },
    [],
  )

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!containerRef.current?.contains(target)) return
      const copyButton = target.closest('.code-block-copy') as HTMLElement | null
      if (copyButton) {
        const codeId = copyButton.getAttribute('data-code-id') || ''
        const rawCode = codeId ? getCodeBlockCopyText(codeId) : null
        const code =
          rawCode ??
          (copyButton.getAttribute('data-code') || '')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
        void navigator.clipboard?.writeText(code)
        const original = copyButton.textContent
        copyButton.textContent = `✓ ${t('copied')}`
        setTimeout(() => {
          copyButton.textContent = original
        }, 2_000)
        return
      }

      const resource = target.closest('[data-resource-path]') as HTMLElement | null
      if (resource) {
        event.preventDefault()
        const path = resource.getAttribute('data-resource-path')
        if (path) onResourcePress?.(path, collectMessageImagePaths(resource))
        return
      }

      const directLink = target.closest('a[href]') as HTMLAnchorElement | null
      const row = target.closest('[data-id]') as HTMLElement | null
      const workerLink = directLink ?? row?.querySelector<HTMLAnchorElement>('a[href^="shennian://session/"]')
      const workerHref = workerLink?.getAttribute('href') || ''
      const workerSessionId = workerHref ? parseWorkerSessionUrl(workerHref) : null
      if (workerSessionId) {
        if (directLink || !target.closest('button, details, summary, input, textarea, [data-resource-path]')) {
          event.preventDefault()
          onSessionPress?.(workerSessionId)
        }
        return
      }
      if (workerHref.startsWith('shennian://session/')) {
        event.preventDefault()
        return
      }

      const link = directLink
      if (!link) return
      const rawHref = link.getAttribute('href') || ''
      event.preventDefault()
      if (isLocalResourceHref(rawHref)) onResourcePress?.(normalizeLocalResourceHref(rawHref))
      else if (!onLinkPress?.(link.href)) openExternalHref(rawHref, link.href)
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [onLinkPress, onResourcePress, onSessionPress, t])

  const cssVars = useMemo(
    () =>
      ({
        '--bg': colors.bg,
        '--surface': colors.surface,
        '--surface-hover': colors.surfaceHover,
        '--border': colors.border,
        '--text': colors.text,
        '--text-secondary': colors.textSecondary,
        '--text-tertiary': colors.textTertiary,
        '--brand': colors.brand,
        '--brand-dark': colors.brandDark,
        '--brand-light': colors.brandLight,
        '--own-message': colors.ownMessage,
        '--error': colors.error,
        '--success': colors.success,
        '--warning': colors.warning,
      }) as CSSProperties,
    [colors],
  )

  return (
    <div
      ref={containerRef}
      className={'cwv' + (isDark ? ' cwv-dark' : '') + (desktop ? ' cwv-desktop' : '')}
      style={{
        flex: 1,
        overflowY: 'auto',
        overscrollBehaviorY: 'contain',
        // VirtualizedWebTimeline owns anchor compensation. Native browser
        // anchoring would apply a second correction when a live row resizes.
        ...WEB_TIMELINE_SCROLL_ROOT_STYLE,
        WebkitOverflowScrolling: 'touch',
        background: colors.bg,
        ...cssVars,
      }}
      onScroll={handleScroll}
    >
      <style dangerouslySetInnerHTML={{ __html: CHAT_CSS_WEB + chatFontCss(chatFontSize, 1, '.cwv ', desktop) + desktopChatProcessCss(desktop, chatFontSize) }} />
      <WebAttachmentPreviewProvider rootRef={containerRef} request={onAttachmentPreviewRequest}>
        {isLoading ? null : messages.length === 0 && runPhase === 'idle' ? (
          <div className="cwv-empty" role="status">
            <span className="cwv-empty-text">{t('chat_empty_hint')}</span>
          </div>
        ) : (
          <VirtualizedWebTimeline
            ref={timelineRef}
            items={renderItems}
            scrollRootRef={containerRef}
            estimateHeight={estimateWebTimelineItemHeight}
            header={
              loadingOlder ? (
                <div role="status" style={{ padding: '8px 0', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', color: colors.textSecondary, fontSize: 12 }}>
                  <span
                    className="dot"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      background: colors.textTertiary,
                      opacity: 0.5,
                      animation: 'cwv-bounce 1.2s infinite ease-in-out',
                    }}
                  />
                  <span>{t('conversation_history_loading')}</span>
                </div>
              ) : null
            }
            footer={<>
              {showTypingIndicator ? <TypingIndicatorWeb /> : null}
              {!showTypingIndicator ? <div role="status" style={{ padding: '7px 0 2px', textAlign: 'center', color: colors.textTertiary, fontSize: 11 }}>{t('conversation_latest_boundary')}</div> : null}
            </>}
            renderItem={(item, index) => {
              const showSeparator =
                index === 0 ||
                (!item.continuesTurn && isTimeSeparated(renderItems[index - 1].lastTs, item.ts))
              return (
                <>
                  {showSeparator ? <TimeSeparatorWeb ts={item.ts} /> : null}
                  <RenderChatItem
                    item={item}
                    isActiveRun={runPhase !== 'idle' && index === renderItems.length - 1}
                    activeToolCallCount={activeToolCallCount}
                    onResourcePress={onResourcePress}
                    onImageLongPress={onImageLongPress}
                    onToolDetailRequest={onToolDetailRequest}
                  />
                </>
              )
            }}
          />
        )}
      </WebAttachmentPreviewProvider>
    </div>
  )
})

/** Composer keystrokes must not rebuild the bounded Markdown timeline. */
export const ChatWebView = memo(ChatWebViewComponent)
