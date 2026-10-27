// @arch docs/architecture/app/chat-attachments-preview.md
// @arch docs/architecture/app/chat-voice-draft.md
// @test src/__tests__/chat-web-timeline-virtualization.test.ts

import { useMemo, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  isToolMessage,
  type ChatAttachment,
  type ChatMessage,
  type ChatRunPhase,
  type ToolCall,
} from '@shennian/shared'
import {
  getInlinePreviewAttachments,
  stripInlinePreviewAttachmentRefs,
} from '../../features/chat/utils/attachments'
import { renderMarkdown } from './ChatWebViewMarkdown.web'
import { UserAttachmentPreview } from './ChatWebMessageAttachments.web'
import { parseWorkerCard, workerCardInnerHtml } from './webview/workerCard'
import { MessageCopyButton } from './MessageCopyButton.web'
import { LazyChatDisclosure } from './LazyChatDisclosure.web'

const TOOL_RESULT_PREVIEW_CHARS = 1200

type ToolMessageGroup = {
  key: string
  messages: ChatMessage[]
  ts: number
  lastTs: number
}

export type ToolDetailRequest = {
  messageId: string
  toolIndex: number
  name?: string
  detailRef?: unknown
}

type RenderItemBase =
  | {
      key: string
      type: 'message'
      message: ChatMessage
      ts: number
      lastTs: number
    }
  | ({
      type: 'tool-group'
    } & ToolMessageGroup)
  | ({ type: 'collapsed-process' } & ToolMessageGroup)
  | {
      key: string
      type: 'collapsed-run'
      messages: ChatMessage[]
      leadingMessages: ChatMessage[]
      trailingTools: ChatMessage[]
      finalMessage: ChatMessage
      ts: number
      lastTs: number
    }

// `continuesTurn` marks items inside one agent turn; they never get a time
// separator so the reply reads as a single block.
export type RenderItem = RenderItemBase & { continuesTurn?: boolean }

function ThinkingBlockWeb({ content, done }: { content: string; done: boolean }) {
  return (
    <details className="thinking-block">
      <summary>{done ? '已深度思考' : '思考中...'}</summary>
      <div className="thinking-content">{content}</div>
    </details>
  )
}

function isSystemContextText(value: string): boolean {
  const text = value.trim()
  return (
    /^<environment_context>[\s\S]*<\/environment_context>$/i.test(text) ||
    /^# AGENTS\.md instructions for [^\n]+[\s\S]*<INSTRUCTIONS>[\s\S]*<\/INSTRUCTIONS>/i.test(
      text,
    ) ||
    /^<turn_aborted>[\s\S]*<\/turn_aborted>$/i.test(text)
  )
}

function sanitizeToolDisplayValue(value: unknown): unknown {
  if (typeof value === 'string')
    return isSystemContextText(value) ? '[SYSTEM CONTEXT REDACTED]' : value
  if (Array.isArray(value)) return value.map(sanitizeToolDisplayValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, raw]) => [
        key,
        sanitizeToolDisplayValue(raw),
      ]),
    )
  }
  return value
}

function toolDisplayText(value: unknown): string {
  if (typeof value === 'string')
    return isSystemContextText(value) ? '[SYSTEM CONTEXT REDACTED]' : value
  return JSON.stringify(sanitizeToolDisplayValue(value), null, 2)
}

function truncateToolText(text: string) {
  if (text.length <= TOOL_RESULT_PREVIEW_CHARS) {
    return { text, truncated: false, omitted: 0 }
  }
  return {
    text: text.slice(0, TOOL_RESULT_PREVIEW_CHARS),
    truncated: true,
    omitted: text.length - TOOL_RESULT_PREVIEW_CHARS,
  }
}

function ToolCodeSection({
  label,
  value,
  truncate = false,
}: {
  label: string
  value: string
  truncate?: boolean
}) {
  const preview = truncate ? truncateToolText(value) : { text: value, truncated: false, omitted: 0 }
  const { t } = useTranslation()
  return (
    <div className="tool-section">
      <span className="tool-label">{label}</span>
      <pre className="tool-code">{preview.text}</pre>
      {preview.truncated ? (
        <div className="tool-code-truncated">
          {t('tool_code_truncated', { count: preview.omitted })}
        </div>
      ) : null}
    </div>
  )
}

export function isTimeSeparated(prevTs: number, nextTs: number) {
  // A separator at every displayed-minute boundary between items. Items that
  // continue an agent turn never get one (see `continuesTurn`).
  return Math.floor(prevTs / 60_000) !== Math.floor(nextTs / 60_000)
}

function summarizeToolCall(t: (key: string, options?: Record<string, unknown>) => string) {
  return {
    title: t('tool_call'),
    meta: '',
  }
}

function summarizeToolGroup(
  toolCount: number,
  t: (key: string, options?: Record<string, unknown>) => string,
  isActiveRun = false,
  activeToolCallCount?: number,
) {
  const count =
    isActiveRun && (activeToolCallCount ?? 0) > 0 ? activeToolCallCount! : toolCount
  return {
    title: t('tool_group_tools', { count }),
    meta: '',
  }
}

function isFinalAgentMessage(message: ChatMessage): boolean {
  return (
    message.role === 'agent' &&
    !isToolMessage(message) &&
    (!!message.content ||
      !!message.attachments?.length ||
      message.status === 'error' ||
      !!message.approval ||
      !!message.channelDelivery ||
      !!message.wechatRpaDelivery)
  )
}

function isWorkerSessionMessage(message: ChatMessage): boolean {
  // The internal Worker Session URL is the stable contract. Link text is
  // human/AI-readable presentation and may be localized or evolve.
  return (
    message.role === 'agent' &&
    /^\[(?:\\.|[^\]])+\]\(shennian:\/\/session\/sess_worker_[^)]+\)/.test(
      message.content?.trim() ?? '',
    )
  )
}

function attachmentPreviewKey(
  messageId: string,
  attachment: ChatAttachment,
  index: number,
): string {
  return `${messageId}:attachment:${attachment.path}:${index}`
}

function buildProcessRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!isToolMessage(message)) {
      items.push({
        key: message.id,
        type: 'message',
        message,
        ts: message.ts,
        lastTs: message.ts,
      })
      continue
    }

    const grouped = [message]
    let lastTs = message.ts

    while (index + 1 < messages.length) {
      const next = messages[index + 1]
      if (!isToolMessage(next)) break
      grouped.push(next)
      lastTs = next.ts
      index += 1
    }

    if (grouped.length === 1) {
      items.push({
        key: message.id,
        type: 'message',
        message,
        ts: message.ts,
        lastTs: message.ts,
      })
      continue
    }

    items.push({
      // Keyed by the first tool so a live tail group accepts new tools in place.
      key: `tool-group-${grouped[0].id}`,
      type: 'tool-group',
      messages: grouped,
      ts: grouped[0].ts,
      lastTs,
    })
  }

  return items
}

function collapseProcessMessages(messages: ChatMessage[]): RenderItem[] {
  if (messages.length === 0) return []
  if (messages.every(isToolMessage)) return buildProcessRenderItems(messages)
  return [{ key: `collapsed-process-${messages[0].id}`, type: 'collapsed-process', messages,
    ts: messages[0].ts, lastTs: messages.at(-1)!.ts }]
}
function buildWorkerTimelineItems(runMessages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = []
  const finalMessage = runMessages.findLast(
    (message) => !isWorkerSessionMessage(message) && isFinalAgentMessage(message),
  )
  let segment: ChatMessage[] = []
  const flushSegment = () => {
    const finalIndex = finalMessage ? segment.indexOf(finalMessage) : -1
    if (finalIndex < 0) {
      items.push(...collapseProcessMessages(segment))
    } else {
      items.push(...collapseProcessMessages(segment.slice(0, finalIndex)))
      items.push({ key: finalMessage!.id, type: 'message', message: finalMessage!,
        ts: finalMessage!.ts, lastTs: finalMessage!.ts })
      items.push(...collapseProcessMessages(segment.slice(finalIndex + 1)))
    }
    segment = []
  }
  for (const message of runMessages) {
    if (!isWorkerSessionMessage(message)) {
      segment.push(message)
      continue
    }
    flushSegment()
    items.push({ key: message.id, type: 'message', message, ts: message.ts, lastTs: message.ts })
  }
  flushSegment()
  return items
}
function buildAgentRunItems(
  runMessages: ChatMessage[],
  userMessageId: string,
  running: boolean,
): RenderItem[] {
  if (running) {
    // The latest turn stays expanded while it runs so progress text is never
    // swallowed by a summary; it collapses once the run is idle.
    return buildProcessRenderItems(runMessages)
  }

  const finalIndex = runMessages.findLastIndex(isFinalAgentMessage)
  if (finalIndex >= 0) {
    const leadingMessages = runMessages.slice(0, finalIndex)
    const finalMessage = runMessages[finalIndex]
    const trailingTools = runMessages.slice(finalIndex + 1).filter(isToolMessage)
    const hiddenMessages = [...leadingMessages, ...trailingTools]
    if (hiddenMessages.length > 0) {
      return [
        {
          key: `collapsed-run-${userMessageId}`,
          type: 'collapsed-run',
          messages: hiddenMessages,
          leadingMessages,
          trailingTools,
          finalMessage,
          ts: leadingMessages[0]?.ts ?? finalMessage.ts,
          lastTs: trailingTools.at(-1)?.ts ?? finalMessage.ts,
        },
      ]
    }
    return [
      {
        key: finalMessage.id,
        type: 'message',
        message: finalMessage,
        ts: finalMessage.ts,
        lastTs: finalMessage.ts,
      },
    ]
  }

  if (runMessages.length > 0 && runMessages.every(isToolMessage)) {
    return [
      {
        key: `tool-group-${userMessageId}`,
        type: 'tool-group',
        messages: runMessages,
        ts: runMessages[0].ts,
        lastTs: runMessages.at(-1)!.ts,
      },
    ]
  }

  return buildProcessRenderItems(runMessages)
}

export function buildRenderItems(messages: ChatMessage[], runPhase: ChatRunPhase): RenderItem[] {
  const items: RenderItem[] = []
  let pendingOrphans: ChatMessage[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'user') {
      pendingOrphans.push(message)
      continue
    }

    if (pendingOrphans.length > 0) {
      // A bounded history window can begin in the middle of the previous
      // agent run. Those leading fragments still precede this user message;
      // grouping must never reverse canonical transcript order.
      items.push(...buildProcessRenderItems(pendingOrphans))
      items.push({
        key: message.id,
        type: 'message',
        message,
        ts: message.ts,
        lastTs: message.ts,
      })
      pendingOrphans = []
    } else {
      items.push({
        key: message.id,
        type: 'message',
        message,
        ts: message.ts,
        lastTs: message.ts,
      })
    }

    const runMessages: ChatMessage[] = []
    let cursor = index + 1
    while (cursor < messages.length && messages[cursor].role !== 'user') {
      runMessages.push(messages[cursor])
      cursor += 1
    }

    if (runMessages.some(isWorkerSessionMessage)) {
      items.push(...buildWorkerTimelineItems(runMessages))
      index = cursor - 1
      continue
    }

    const runItems = buildAgentRunItems(
      runMessages,
      message.id,
      cursor >= messages.length && runPhase !== 'idle',
    )
    for (const item of runItems) item.continuesTurn = true
    items.push(...runItems)
    index = cursor - 1
  }

  if (pendingOrphans.length > 0) {
    items.push(...buildProcessRenderItems(pendingOrphans))
  }

  return items
}

function toolDetailMessage(
  tc: ToolCall,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (tc.detailStatus === 'loading') return t('tool_detail_loading')
  if (tc.detailStatus === 'offline') return t('tool_detail_offline')
  if (tc.detailStatus === 'unsupported') return t('tool_detail_unsupported')
  if (tc.detailStatus === 'unavailable') return t('tool_detail_unavailable')
  if (tc.detailStatus === 'error') return t('tool_detail_error')
  return t('tool_detail_cta')
}

function ToolDetailSections({ tc }: { tc: ToolCall }) {
  const { t } = useTranslation()
  const hasDetail = tc.args != null || tc.argsSummary != null || !!tc.command
  const argsSummaryCommand =
    tc.argsSummary && typeof tc.argsSummary === 'object'
      ? (tc.argsSummary as Record<string, unknown>).command
      : undefined

  return (
    <>
      {tc.command && tc.args == null && argsSummaryCommand !== tc.command ? (
        <ToolCodeSection label={t('command')} value={toolDisplayText(tc.command)} />
      ) : null}
      {tc.args != null ? (
        <ToolCodeSection label={t('arguments')} value={toolDisplayText(tc.args)} />
      ) : tc.argsSummary != null ? (
        <ToolCodeSection label={t('arguments')} value={toolDisplayText(tc.argsSummary)} />
      ) : null}
      {tc.result != null ? (
        <ToolCodeSection label={t('result')} value={toolDisplayText(tc.result)} truncate />
      ) : null}
      {tc.resultOmitted && tc.result == null ? (
        <div className="tool-detail-hint">{t('tool_result_omitted')}</div>
      ) : null}
      {!hasDetail ? <div className="tool-detail-hint">{toolDetailMessage(tc, t)}</div> : null}
    </>
  )
}

function shouldRequestToolDetail(tc: ToolCall): boolean {
  if (tc.detailStatus === 'loading' || tc.detailStatus === 'loaded') return false
  const hasInputDetail = tc.args != null || tc.argsSummary != null || !!tc.command
  return !(hasInputDetail && tc.result != null)
}

function ToolCallBlockWeb({
  tc,
  messageId,
  toolIndex = 0,
  onToolDetailRequest,
}: {
  tc: ToolCall
  messageId: string
  toolIndex?: number
  onToolDetailRequest?: (request: ToolDetailRequest) => void
  onAttachmentPreviewRequest?: (request: {
    path: string
    name?: string
    mimeType?: string
  }) => Promise<string | null>
}) {
  const { t } = useTranslation()
  const summary = summarizeToolCall(t)
  const handleToggle = useCallback(
    (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      if (!event.currentTarget.open || !shouldRequestToolDetail(tc)) return
      onToolDetailRequest?.({
        messageId,
        toolIndex,
        name: tc.name,
        detailRef: tc.detailRef,
      })
    },
    [messageId, onToolDetailRequest, tc, toolIndex],
  )

  return (
    <LazyChatDisclosure className="tool-disclosure tool-block" onToggle={handleToggle} summary={
      <summary>
        <span className="tool-summary">
          <span className="tool-title">{summary.title}</span>
          {summary.meta ? <span className="tool-meta">{summary.meta}</span> : null}
        </span>
      </summary>
    }>
      {() => <div className="tool-content">
        <ToolDetailSections tc={tc} />
      </div>}
    </LazyChatDisclosure>
  )
}

function ToolGroupBlockWeb({
  messages,
  onToolDetailRequest,
  isActiveRun = false,
  activeToolCallCount,
}: {
  messages: ChatMessage[]
  onToolDetailRequest?: (request: ToolDetailRequest) => void
  isActiveRun?: boolean
  activeToolCallCount?: number
}) {
  const { t } = useTranslation()
  const toolCount = messages.reduce((count, message) => count + (message.toolCalls?.length ?? 0), 0)
  const summary = summarizeToolGroup(toolCount, t, isActiveRun, activeToolCallCount)

  return (
    <LazyChatDisclosure className="tool-disclosure tool-group" summary={
      <summary>
        <span className="tool-summary">
          <span className="tool-title">{summary.title}</span>
        </span>
      </summary>
    }>
      {() => <div className="tool-group-content">
        {messages.flatMap((message) => (message.toolCalls ?? []).map((tc, index) => {
          const messageId = message.id
          const toolIndex = tc.toolIndex ?? index
          return (
            <LazyChatDisclosure
              className="tool-group-item"
              key={`${messageId}-${toolIndex}`}
              onToggle={(event) => {
                if (!event.currentTarget.open) return
                if (!shouldRequestToolDetail(tc)) return
                onToolDetailRequest?.({
                  messageId,
                  toolIndex,
                  name: tc.name,
                  detailRef: tc.detailRef,
                })
              }}
              summary={
                <summary className="tool-group-item-header">
                  <span className="tool-item-label">{t('tool_call')}</span>
                </summary>
              }
            >
              {() => <div className="tool-group-item-body">
                <ToolDetailSections tc={tc} />
              </div>}
            </LazyChatDisclosure>
          )
        }))}
      </div>}
    </LazyChatDisclosure>
  )
}

function ApprovalCardWeb({ msg }: { msg: ChatMessage }) {
  const { t } = useTranslation()
  const approval = msg.approval
  if (!approval) return null
  return (
    <div className="msg-row msg-agent msg-approval" data-id={msg.id}>
      <div className="agent-wrap">
        <div className="approval-card">
          <div className="approval-card-kicker">
            {t('approval_pending_kicker', { defaultValue: '等待确认' })}
          </div>
          <div className="approval-card-title">
            {approval.title || t('approval_pending_title', { defaultValue: '需要用户确认' })}
          </div>
          <div className="approval-card-content">{approval.content}</div>
          <div className="approval-card-hint">
            {approval.actionHint ||
              t('approval_pending_hint', {
                defaultValue: '当前神念暂不支持远程确认，请回到运行 Codex 的电脑/终端完成确认。',
              })}
          </div>
        </div>
      </div>
    </div>
  )
}

function DeliveryStatusCardWeb({ msg }: { msg: ChatMessage }) {
  const { t } = useTranslation()
  const delivery = msg.channelDelivery
  if (!delivery) return null
  const title = deliveryTitle(delivery, t)
  const copyText = delivery.copyText?.trim() ?? ''
  const detail = !copyText && delivery.content && delivery.content !== title ? delivery.content : ''

  return (
    <div className="msg-row msg-agent msg-delivery" data-id={msg.id}>
      <div className="agent-wrap">
        <div className="delivery-card">
          <div className="delivery-kicker">{t('wechat_delivery_status_kicker')}</div>
          <div className="delivery-title">{title}</div>
          {detail ? <div className="delivery-detail">{detail}</div> : null}
          {copyText ? (
            <>
              <div className="delivery-original-label">{t('wechat_delivery_original_content')}</div>
              <div className="delivery-original">{copyText}</div>
              <MessageCopyButton
                text={copyText}
                className="delivery-copy-btn"
                label={t('wechat_delivery_copy_original')}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function deliveryTitle(
  delivery: NonNullable<ChatMessage['channelDelivery']>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (delivery.status === 'manual_review') return t('wechat_delivery_manual_review_title')
  if (
    delivery.reasonCode === 'user_active_timeout' ||
    delivery.status === 'failed:user_active_timeout'
  ) {
    return t('wechat_delivery_timeout_title')
  }
  return t('wechat_delivery_failed_title')
}

function WeChatRpaInlineDeliveryWeb({ delivery }: { delivery?: ChatMessage['wechatRpaDelivery'] }) {
  const { t } = useTranslation()
  if (!delivery) return null
  return (
    <div className="delivery-inline" aria-label={t('wechat_delivery_status_kicker')}>
      <span className="delivery-inline-dot" />
      <span>{wechatRpaInlineDeliveryText(delivery, t)}</span>
    </div>
  )
}

function wechatRpaInlineDeliveryText(
  delivery: NonNullable<ChatMessage['wechatRpaDelivery']>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (delivery.status === 'sending') return t('wechat_delivery_inline_sending')
  if (delivery.status === 'sent_unconfirmed') return t('wechat_delivery_inline_confirming')
  const reason = delivery.reasonCode || ''
  if (
    reason === 'recent_mouse_activity' ||
    reason === 'recent_mouse_click' ||
    reason === 'recent_scroll_activity' ||
    reason === 'recent_keyboard_activity' ||
    reason === 'frontmost_app_changed'
  ) {
    return t('wechat_delivery_inline_waiting_idle')
  }
  return t('wechat_delivery_inline_queued')
}

function ProcessDisclosureWeb({
  messages,
  onResourcePress,
  onImageLongPress,
  onToolDetailRequest,
}: {
  messages: ChatMessage[]
  onResourcePress?: (path: string, imagePaths?: string[]) => void
  onImageLongPress?: (path: string) => void
  onToolDetailRequest?: (request: ToolDetailRequest) => void
}) {
  const toolCount = messages.reduce(
    (count, message) => count + (message.toolCalls?.length ?? 0),
    0,
  )
  const messageCount = messages.reduce(
    (count, message) => count + (message.content?.trim() ? 1 : 0),
    0,
  )
  const { t } = useTranslation()
  const label =
    messageCount > 0 && toolCount > 0
      ? t('process_messages_with_tools', { messages: messageCount, tools: toolCount })
      : toolCount > 0
        ? t('process_tools', { count: toolCount })
        : t('process_messages', { count: messageCount })

  if (messages.length === 0) return null
  return (
    <LazyChatDisclosure className="process-collapse" summary={<summary>{label}</summary>}>
          {() => <div className="process-collapse-content">
            {buildProcessRenderItems(messages).map((item) => (
              <div key={item.key}>
                {item.type === 'tool-group' ? (
                  <div className="msg-row msg-agent msg-tool">
                    <div className="agent-wrap">
                      <ToolGroupBlockWeb
                        messages={item.messages}
                        onToolDetailRequest={onToolDetailRequest}
                      />
                    </div>
                  </div>
                ) : item.type === 'message' && isToolMessage(item.message) ? (
                  <div className="msg-row msg-agent msg-tool">
                    <div className="agent-wrap">
                      <ToolCallBlockWeb
                        tc={item.message.toolCalls![0]}
                        messageId={item.message.id}
                        toolIndex={item.message.toolCalls![0].toolIndex ?? 0}
                        onToolDetailRequest={onToolDetailRequest}
                      />
                    </div>
                  </div>
                ) : item.type === 'message' && item.message.role === 'user' ? null : item.type ===
                    'message' && item.message.channelDelivery ? (
                  <DeliveryStatusCardWeb msg={item.message} />
                ) : item.type === 'message' && item.message.approval ? (
                  <ApprovalCardWeb msg={item.message} />
                ) : item.type === 'message' ? (
                  <AgentMessage
                    msg={item.message}
                    onResourcePress={onResourcePress}
                    onImageLongPress={onImageLongPress}
                  />
                ) : null}
              </div>
            ))}
          </div>}
    </LazyChatDisclosure>
  )
}

function CollapsedRunBlockWeb({
  leadingMessages,
  trailingTools,
  finalMessage,
  onResourcePress,
  onImageLongPress,
  onToolDetailRequest,
}: {
  leadingMessages: ChatMessage[]
  trailingTools: ChatMessage[]
  finalMessage: ChatMessage
  onResourcePress?: (path: string, imagePaths?: string[]) => void
  onImageLongPress?: (path: string) => void
  onToolDetailRequest?: (request: ToolDetailRequest) => void
}) {
  return (
    <>
      <ProcessDisclosureWeb
        messages={leadingMessages}
        onResourcePress={onResourcePress}
        onImageLongPress={onImageLongPress}
        onToolDetailRequest={onToolDetailRequest}
      />
      {finalMessage.channelDelivery ? (
        <DeliveryStatusCardWeb msg={finalMessage} />
      ) : finalMessage.approval ? (
        <ApprovalCardWeb msg={finalMessage} />
      ) : (
        <AgentMessage
          msg={finalMessage}
          onResourcePress={onResourcePress}
          onImageLongPress={onImageLongPress}
        />
      )}
      {trailingTools.length > 0 ? (
        <div className="msg-row msg-agent msg-tool trailing-tool-summary">
          <div className="agent-wrap">
            <ToolGroupBlockWeb messages={trailingTools} onToolDetailRequest={onToolDetailRequest} />
          </div>
        </div>
      ) : null}
    </>
  )
}

export function RenderChatItem({
  item,
  onResourcePress,
  onImageLongPress,
  onToolDetailRequest,
  isActiveRun = false,
  activeToolCallCount,
}: {
  item: RenderItem
  onResourcePress?: (path: string, imagePaths?: string[]) => void
  onImageLongPress?: (path: string) => void
  onToolDetailRequest?: (request: ToolDetailRequest) => void
  isActiveRun?: boolean
  activeToolCallCount?: number
}) {
  if (item.type === 'collapsed-run') {
    return (
      <CollapsedRunBlockWeb
        leadingMessages={item.leadingMessages}
        trailingTools={item.trailingTools}
        finalMessage={item.finalMessage}
        onResourcePress={onResourcePress}
        onImageLongPress={onImageLongPress}
        onToolDetailRequest={onToolDetailRequest}
      />
    )
  }
  if (item.type === 'collapsed-process') {
    return (
      <ProcessDisclosureWeb
        messages={item.messages}
        onResourcePress={onResourcePress}
        onImageLongPress={onImageLongPress}
        onToolDetailRequest={onToolDetailRequest}
      />
    )
  }
  if (item.type === 'tool-group') {
    return (
      <div className="msg-row msg-agent msg-tool">
        <div className="agent-wrap">
          <ToolGroupBlockWeb
            messages={item.messages}
            onToolDetailRequest={onToolDetailRequest}
            isActiveRun={isActiveRun}
            activeToolCallCount={activeToolCallCount}
          />
        </div>
      </div>
    )
  }
  if (isToolMessage(item.message)) {
    return (
      <div className="msg-row msg-agent msg-tool">
        <div className="agent-wrap">
          <ToolCallBlockWeb
            tc={item.message.toolCalls![0]}
            messageId={item.message.id}
            toolIndex={item.message.toolCalls![0].toolIndex ?? 0}
            onToolDetailRequest={onToolDetailRequest}
          />
        </div>
      </div>
    )
  }
  if (item.message.approval) {
    return <ApprovalCardWeb msg={item.message} />
  }
  if (item.message.channelDelivery) {
    return <DeliveryStatusCardWeb msg={item.message} />
  }
  if (item.message.role === 'user' && !parseWorkerCard(item.message.content)) {
    return (
      <UserMessage
        msg={item.message}
        onResourcePress={onResourcePress}
        onImageLongPress={onImageLongPress}
      />
    )
  }
  return (
    <AgentMessage
      msg={item.message}
      onResourcePress={onResourcePress}
      onImageLongPress={onImageLongPress}
    />
  )
}

const AgentMessage = memo(function AgentMessage({
  msg,
  onResourcePress,
  onImageLongPress,
}: {
  msg: ChatMessage
  onResourcePress?: (path: string, imagePaths?: string[]) => void
  onImageLongPress?: (path: string) => void
}) {
  const previewAttachments = useMemo(
    () => getInlinePreviewAttachments(msg.attachments),
    [msg.attachments],
  )
  const displayContent = useMemo(
    () => stripInlinePreviewAttachmentRefs(msg.content, msg.attachments),
    [msg.attachments, msg.content],
  )
  const copyText = displayContent.trim()
  const html = useMemo(
    () => (displayContent ? renderMarkdown(displayContent) : ''),
    [displayContent],
  )

  const worker = parseWorkerCard(displayContent)
  if (worker) {
    return (
      <div className="msg-row msg-agent worker-session-message" data-id={msg.id}>
        <div className="agent-wrap">
          <a className="worker-session-card" data-worker-kind={worker.kind} href={worker.href} onMouseDown={(event) => event.preventDefault()}
            dangerouslySetInnerHTML={{ __html: workerCardInnerHtml(worker) }} />
        </div>
      </div>
    )
  }

  return (
    <div className="msg-row msg-agent" data-id={msg.id}>
      <div className="agent-wrap">
        {msg.thinking && (
          <ThinkingBlockWeb
            content={msg.thinking}
            done={!!msg.content || !!previewAttachments.length}
          />
        )}
        {(html || previewAttachments.length > 0) && (
          <div className="bubble-agent">
            {previewAttachments.length ? (
              <div className="user-attachments">
                {previewAttachments.map((attachment, index) => (
                  <UserAttachmentPreview
                    key={attachmentPreviewKey(msg.id, attachment, index)}
                    attachment={attachment}
                    onOpen={(path) => onResourcePress?.(path)}
                    onImageContextMenu={(path) => onImageLongPress?.(path)}
                  />
                ))}
              </div>
            ) : null}
            {html ? <div className="md" dangerouslySetInnerHTML={{ __html: html }} /> : null}
          </div>
        )}
        <WeChatRpaInlineDeliveryWeb delivery={msg.wechatRpaDelivery} />
        {copyText ? <MessageCopyButton text={copyText} /> : null}
      </div>
    </div>
  )
})

function UserMessage({
  msg,
  onResourcePress,
  onImageLongPress,
}: {
  msg: ChatMessage
  onResourcePress?: (path: string, imagePaths?: string[]) => void
  onImageLongPress?: (path: string) => void
}) {
  const { t } = useTranslation()
  const errorClass = msg.status === 'error' ? ' error' : ''
  const previewAttachments = useMemo(
    () => getInlinePreviewAttachments(msg.attachments),
    [msg.attachments],
  )
  const displayContent = useMemo(
    () => stripInlinePreviewAttachmentRefs(msg.content, msg.attachments),
    [msg.attachments, msg.content],
  )
  const copyText = displayContent.trim()
  const html = useMemo(
    () => (displayContent ? renderMarkdown(displayContent) : ''),
    [displayContent],
  )

  return (
    <div className="msg-row msg-user" data-id={msg.id}>
      <div className="user-wrap">
        <div className={`bubble-user${errorClass}`}>
          {previewAttachments.length ? (
            <div className="user-attachments">
              {previewAttachments.map((attachment, index) => (
                <UserAttachmentPreview
                  key={attachmentPreviewKey(msg.id, attachment, index)}
                  attachment={attachment}
                  onOpen={(path) => onResourcePress?.(path)}
                  onImageContextMenu={(path) => onImageLongPress?.(path)}
                />
              ))}
            </div>
          ) : null}
          {html ? <div className="md md-user" dangerouslySetInnerHTML={{ __html: html }} /> : null}
        </div>
        {copyText ? <MessageCopyButton text={copyText} /> : null}
      </div>
      {msg.queueMessageId ? null : msg.status === 'sending' || msg.status === 'uncertain' ? (
        <div className="msg-status sending-status">
          <span className="sending" />
          <span className="sending-label">{t('msg_sending')}</span>
          <span className="still-sending-label">{t('msg_still_sending')}</span>
        </div>
      ) : null}
      {msg.status === 'error' && (
        <div className="msg-status">
          <span className="ephemeral-error">{t('msg_send_failed')}</span>
        </div>
      )}
    </div>
  )
}
