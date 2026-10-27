// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/chat-store.test.ts

import { create } from 'zustand'
import {
  type ApprovalPendingPayload,
  type ChannelDeliveryStatusPayload,
  type WeChatRpaPendingReplyProjection,
  buildApprovalPendingPayload,
  buildUserMessagePayload,
  parseChannelDeliveryStatusPayload,
  parseStewardSayPayload,
  parseUserMessagePayload,
  isSystemControlPayload,
  type ChatAttachmentMeta,
  type ChatQueueSnapshot,
  type Envelope,
  type QueuedChatMessage,
  type SessionActivitySnapshot,
  type SessionDeliveryState,
} from '@shennian/wire'
import { getLiveSessionActivitySnapshot } from '../lib/session-list'

export type ToolCall = {
  name: string
  durationMs?: number
  toolCallId?: string
  detailRevision?: number
  args?: unknown
  result?: string
  status?: 'running' | 'completed' | 'failed' | string
  resultOmitted?: boolean
  detailAvailable?: boolean
  detailRef?: unknown
  toolIndex?: number
  command?: string
  argsSummary?: unknown
  detailStatus?: 'idle' | 'loading' | 'loaded' | 'offline' | 'unsupported' | 'unavailable' | 'error'
  detailMessage?: string
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'uncertain' | 'error'

export type ErrorInfo = {
  type: 'network' | 'cli_unreachable' | 'agent_error'
  message?: string
}

export type ChatRunPhase =
  | 'idle'
  | 'thinking'
  | 'tool_running'
  | 'streaming_text'
  | 'waiting_approval'
  | 'waiting_user_input'

export type ChatAttachment = ChatAttachmentMeta & {
  previewData?: string
}

export type ChatMessage = {
  id: string
  role: 'user' | 'agent'
  ts: number
  content: string
  attachments?: ChatAttachment[]
  thinking?: string
  toolCalls?: ToolCall[]
  status?: MessageStatus
  deliveryState?: SessionDeliveryState | 'local_pending' | 'sending' | 'unconfirmed'
  error?: ErrorInfo
  queueMessageId?: string
  approval?: ApprovalPendingPayload
  /** Set on a message the steward deliberately addressed to the user (`fallback` = last output shown). */
  steward?: 'say' | 'fallback'
  workerSource?: import('@shennian/wire').StewardSayPayload['worker']
  /** Display-only marker between steward conversations, e.g. "新对话" or "切换到 Claude". */
  divider?: string
  channelDelivery?: ChannelDeliveryStatusPayload
  wechatRpaDelivery?: WeChatRpaPendingReplyProjection
}

type ChatState = {
  sessionId: string | null
  messages: ChatMessage[]
  runPhase: ChatRunPhase
  isTyping: boolean
  currentRunId: string | null
  queue: ChatQueueSnapshot | null
  hasMore: boolean
  loading: boolean
  sessionLoadFailed: boolean
  setSessionId(sessionId: string | null): void
  setMessages(msgs: ChatMessage[]): void
  prependMessages(msgs: ChatMessage[]): void
  appendMessage(msg: ChatMessage): void
  /** Upsert a message by id: update if exists, append if new. */
  upsertMessage(msg: ChatMessage): void
  /** Upsert a live micro-batch with one Zustand notification and one sort. */
  upsertMessages(msgs: ChatMessage[]): void
  setHasMore(hasMore: boolean): void
  setLoading(loading: boolean): void
  setSessionLoadFailed(failed: boolean): void
  startPendingRun(): void
  clearPendingRun(): void
  addMessage(msg: ChatMessage): void
  updateMessageStatus(id: string, status: MessageStatus): void
  updateMessageError(id: string, error: ErrorInfo): void
  clearMessageError(id: string): void
  setQueue(queue: ChatQueueSnapshot | null): void
  removeQueuedMessage(queueMessageId: string): void
  sendMessage(sessionId: string, text: string): void
  restoreRunPhase(activity: SessionActivitySnapshot | null | undefined): void
  loadMessages(msgs: ChatMessage[]): void
  clear(): void
}

export const PENDING_CHAT_RUN_ID = '__pending__'

const GIT_DIRECTIVE_LINE_RE = /^\s*::git-[a-z-]+\{[^\n]*\}\s*$/gm

function stripGitDirectiveArtifacts(text: string): string {
  if (!text) return ''
  const normalized = text.replace(/\r\n/g, '\n')
  const hadDirective = /(^|\n)\s*::git-[a-z-]+\{[^\n]*\}\s*(?=\n|$)/.test(normalized)
  if (!hadDirective) return normalized
  const stripped = normalized.replace(GIT_DIRECTIVE_LINE_RE, '')
  if (!stripped.trim()) return ''
  return stripped.replace(/[ \t]+\n/g, '\n').replace(/\n+$/g, '')
}

function stateForRunPhase(runPhase: ChatRunPhase) {
  return { runPhase, isTyping: runPhase !== 'idle' }
}

function parseAttachmentMeta(value: unknown): ChatAttachment | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  const attachmentPath = typeof entry.path === 'string' ? entry.path : ''
  const name = typeof entry.name === 'string' ? entry.name : ''
  const mimeType = typeof entry.mimeType === 'string' ? entry.mimeType : ''
  const kind =
    entry.kind === 'image' || entry.kind === 'file' || entry.kind === 'folder' ? entry.kind : null
  if (!attachmentPath || !name || !mimeType || !kind) return null
  const previewData =
    typeof entry.previewData === 'string' && entry.previewData.trim()
      ? entry.previewData.trim()
      : undefined
  const byteSize = typeof entry.byteSize === 'number' && Number.isSafeInteger(entry.byteSize) && entry.byteSize >= 0
    ? entry.byteSize
    : undefined
  const sha256 = typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(entry.sha256)
    ? entry.sha256.toLowerCase()
    : undefined
  return {
    path: attachmentPath,
    name,
    mimeType,
    kind,
    ...(byteSize !== undefined ? { byteSize } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(previewData ? { previewData } : {}),
  }
}

function parseAttachmentList(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value
    .map(parseAttachmentMeta)
    .filter((item): item is ChatAttachment => item != null)
  return attachments.length ? attachments : undefined
}

// ─── Envelope conversion helpers ─────────────────────────

export function isToolMessage(msg: ChatMessage): boolean {
  return msg.role === 'agent' && !!msg.toolCalls?.length && !msg.content
}

function isRenderableMessage(msg: ChatMessage): boolean {
  return Boolean(
    msg.content ||
    msg.attachments?.length ||
    msg.toolCalls?.length ||
    msg.thinking ||
    msg.channelDelivery,
  )
}

function deliveryStateToMessageStatus(
  deliveryState: SessionDeliveryState | undefined,
): MessageStatus | undefined {
  if (deliveryState === 'queued') return 'sending'
  if (deliveryState === 'failed' || deliveryState === 'cancelled') return 'error'
  if (deliveryState) return 'sent'
  return undefined
}

export function envelopeToChatMessage(
  env: Envelope,
  deliveryState?: SessionDeliveryState,
): ChatMessage {
  const deliveryProjection = deliveryState
    ? {
        deliveryState,
        status: deliveryStateToMessageStatus(deliveryState),
        // Canonical queued mutations may arrive after the queue snapshot and
        // replace its local projection. Preserve the pending identity so the
        // transcript does not resurrect a duplicate sending indicator.
        ...(deliveryState === 'queued' ? { queueMessageId: env.id } : {}),
      }
    : {}
  if (isSystemControlPayload(env.payload)) {
    return {
      id: env.id,
      role: env.role,
      ts: env.ts,
      content: '',
      ...deliveryProjection,
    }
  }

  if (env.role === 'user') {
    const parsedUser = parseUserMessagePayload(env.payload)
    if (parsedUser) {
      return {
        id: env.id,
        role: env.role,
        ts: env.ts,
        content: parsedUser.content,
        attachments: parsedUser.attachments,
        ...deliveryProjection,
      }
    }
  }

  if (env.role === 'agent' && env.payload.startsWith('{"v":1,')) {
    try {
      const p = JSON.parse(env.payload) as {
        type?: string
        content?: string
        thinking?: string
        name?: string
        durationMs?: number
        args?: unknown
        result?: string
        status?: string
        resultOmitted?: boolean
        detailAvailable?: boolean
        toolCallId?: string
        detailRevision?: number
        detailRef?: unknown
        toolIndex?: number
        error?: boolean
        attachments?: unknown
        title?: string
        source?: string
        actionHint?: string
        permission?: ApprovalPendingPayload['permission']
      }
      if ((p.type === 'tool' || p.type === 'tool_use' || p.type === 'tool_result') && p.name) {
        return {
          id: env.id,
          role: env.role,
          ts: env.ts,
          content: '',
          toolCalls: [
            {
              name: p.name,
              durationMs:
                typeof p.durationMs === 'number' && Number.isFinite(p.durationMs) && p.durationMs >= 0
                  ? p.durationMs
                  : undefined,
              toolCallId: p.toolCallId,
              detailRevision: p.detailRevision,
              args: p.args,
              result: p.result,
              status: p.status,
              resultOmitted: p.resultOmitted,
              detailAvailable: p.detailAvailable,
              detailRef: p.detailRef,
              toolIndex: p.toolIndex,
            },
          ],
        }
      }
      if (p.type === 'approval_pending') {
        const payload = JSON.parse(
          buildApprovalPendingPayload({
            title: typeof p.title === 'string' ? p.title : undefined,
            content: typeof p.content === 'string' ? p.content : undefined,
            source: typeof p.source === 'string' ? p.source : undefined,
            actionHint: typeof p.actionHint === 'string' ? p.actionHint : undefined,
            permission: p.permission as ApprovalPendingPayload['permission'],
          }),
        ) as ApprovalPendingPayload
        return {
          id: env.id,
          role: env.role,
          ts: env.ts,
          content: payload.content,
          approval: payload,
        }
      }
      if (p.type === 'steward_say') {
        const say = parseStewardSayPayload(env.payload)
        return {
          id: env.id,
          role: env.role,
          ts: env.ts,
          content: say?.content ?? '',
          ...(say ? { steward: say.source, ...(say.worker ? { workerSource: say.worker } : {}) } : {}),
        }
      }
      if (p.type === 'channel_delivery_status') {
        const payload = parseChannelDeliveryStatusPayload(env.payload)
        if (payload) {
          return {
            id: env.id,
            role: env.role,
            ts: env.ts,
            content: payload.content,
            channelDelivery: payload,
          }
        }
      }
      return {
        id: env.id,
        role: env.role,
        ts: env.ts,
        content: stripGitDirectiveArtifacts(p.content ?? ''),
        attachments: parseAttachmentList(p.attachments),
        status: p.type === 'error' || p.error ? 'error' : undefined,
        ...deliveryProjection,
      }
    } catch {
      // fall through to legacy
    }
  }
  return {
    id: env.id,
    role: env.role,
    ts: env.ts,
    content: env.role === 'agent' ? stripGitDirectiveArtifacts(env.payload) : env.payload,
    ...deliveryProjection,
  }
}

export function chatMessageToEnvelope(msg: ChatMessage, sessionId: string): Envelope {
  const payload =
    msg.role === 'user'
      ? buildUserMessagePayload(
          msg.content,
          msg.attachments?.map(({ previewData: _previewData, ...attachment }) => attachment),
        )
      : msg.content
  return { id: msg.id, sessionId, role: msg.role, ts: msg.ts, payload }
}

export function queuedMessageToChatMessage(message: QueuedChatMessage): ChatMessage {
  const parsedUser = parseUserMessagePayload(message.text)
  return {
    id: message.clientMessageId ?? message.id,
    role: 'user',
    ts: Date.parse(message.createdAt) || Date.now(),
    content: parsedUser?.content ?? message.text,
    attachments: parsedUser?.attachments ?? message.attachments,
    status: 'sending',
    queueMessageId: message.id,
  }
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  messages: [],
  runPhase: 'idle',
  isTyping: false,
  currentRunId: null,
  queue: null,
  hasMore: true,
  loading: false,
  sessionLoadFailed: false,
  setSessionId(sessionId) {
    set({ sessionId })
  },
  setMessages(msgs) {
    const sorted = [...msgs].sort((a, b) => a.ts - b.ts)
    const deduped: ChatMessage[] = []
    const seen = new Set<string>()
    for (const m of sorted) {
      if (!isRenderableMessage(m)) continue
      if (!seen.has(m.id)) {
        seen.add(m.id)
        deduped.push(m)
      }
    }
    set({ messages: deduped, loading: false })
  },
  prependMessages(msgs) {
    if (msgs.length === 0) return
    set((s) => {
      const seen = new Set(s.messages.map((m) => m.id))
      const filtered = msgs.filter((m) => !seen.has(m.id))
      if (filtered.length === 0) return s
      const merged = [...filtered, ...s.messages].sort((a, b) => a.ts - b.ts)
      const deduped: ChatMessage[] = []
      const seen2 = new Set<string>()
      for (const m of merged) {
        if (!isRenderableMessage(m)) continue
        if (!seen2.has(m.id)) {
          seen2.add(m.id)
          deduped.push(m)
        }
      }
      return { messages: deduped }
    })
  },
  appendMessage(msg) {
    if (!isRenderableMessage(msg)) return
    set((s) => {
      if (s.messages.some((m) => m.id === msg.id)) return s
      return { messages: [...s.messages, msg].sort((a, b) => a.ts - b.ts) }
    })
  },
  upsertMessage(msg) {
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === msg.id)
      if (!isRenderableMessage(msg)) {
        if (idx >= 0) return { messages: s.messages.filter((m) => m.id !== msg.id) }
        return s
      }
      if (idx >= 0) {
        const next = [...s.messages]
        next[idx] = msg
        // A durable queued user keeps its ID but receives its dispatch time.
        // Move it after the previous reply instead of grouping all replies.
        return { messages: next.sort((left, right) => left.ts - right.ts) }
      }
      // Insert in sorted order
      const msgs = [...s.messages, msg].sort((a, b) => a.ts - b.ts)
      return { messages: msgs }
    })
  },
  upsertMessages(incoming) {
    if (incoming.length === 0) return
    set((state) => {
      const byId = new Map(state.messages.map((message) => [message.id, message]))
      let changed = false
      for (const message of incoming) {
        if (!isRenderableMessage(message)) {
          if (byId.delete(message.id)) changed = true
          continue
        }
        if (byId.get(message.id) === message) continue
        byId.set(message.id, message)
        changed = true
      }
      if (!changed) return state
      return { messages: [...byId.values()].sort((left, right) => left.ts - right.ts) }
    })
  },
  setHasMore(hasMore) {
    set({ hasMore })
  },
  setLoading(loading) {
    set({ loading })
  },
  setSessionLoadFailed(failed) {
    set({ sessionLoadFailed: failed })
  },
  startPendingRun() {
    set((s) => {
      if (s.isTyping && s.currentRunId && s.currentRunId !== PENDING_CHAT_RUN_ID) return s
      console.log(
        `[chatStore] startPendingRun: prev=${s.runPhase}/${s.currentRunId?.slice(0, 8) ?? '-'}`,
      )
      return { ...stateForRunPhase('thinking'), currentRunId: PENDING_CHAT_RUN_ID }
    })
  },
  clearPendingRun() {
    set((s) => {
      if (s.currentRunId !== PENDING_CHAT_RUN_ID) return s
      console.log(`[chatStore] clearPendingRun: was=${s.runPhase}`)
      return { ...stateForRunPhase('idle'), currentRunId: null }
    })
  },
  addMessage(msg) {
    if (!isRenderableMessage(msg)) return
    set((s) => {
      if (s.messages.some((m) => m.id === msg.id)) return s
      return { messages: [...s.messages, msg].sort((a, b) => a.ts - b.ts) }
    })
  },
  updateMessageStatus(id, status) {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, status, error: undefined } : m)),
    }))
  },
  updateMessageError(id, error) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, status: 'error' as const, error } : m,
      ),
    }))
  },
  clearMessageError(id) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, status: 'sending' as const, error: undefined } : m,
      ),
    }))
  },
  setQueue(queue) {
    set((s) => {
      if (queue && s.sessionId && queue.sessionId !== s.sessionId) return s
      const pending = queue?.pending ?? []
      const queuedByMessageId = new Map<string, QueuedChatMessage>()
      for (const message of pending) {
        queuedByMessageId.set(message.clientMessageId || message.id, message)
      }

      const messages = s.messages.map((message) => {
        const queued = queuedByMessageId.get(message.id)
        if (queued) {
          queuedByMessageId.delete(message.id)
          if (
            message.status === undefined ||
            message.status === 'sent' ||
            message.status === 'delivered'
          ) {
            return message
          }
          // Queue state enriches the existing optimistic bubble in place. It must
          // never remove the user's message from the conversation flow.
          const queuedProjection = queuedMessageToChatMessage(queued)
          return {
            ...message,
            content: queuedProjection.content,
            attachments: queuedProjection.attachments,
            status: 'sending' as const,
            queueMessageId: queued.id,
          }
        }
        if (message.queueMessageId) {
          // The daemon removes a queue item immediately before dispatching it.
          // Keep the bubble visible until the matching session.message arrives.
          return { ...message, status: 'sending' as const, queueMessageId: undefined }
        }
        return message
      })

      for (const queued of queuedByMessageId.values()) {
        messages.push(queuedMessageToChatMessage(queued))
      }

      return {
        queue,
        messages: messages.sort((left, right) => left.ts - right.ts),
      }
    })
  },
  removeQueuedMessage(queueMessageId) {
    set((s) => ({
      messages: s.messages.filter((message) => message.queueMessageId !== queueMessageId),
      queue: s.queue
        ? {
            ...s.queue,
            pending: s.queue.pending.filter((message) => message.id !== queueMessageId),
          }
        : s.queue,
    }))
  },
  sendMessage(_sessionId, text) {
    const msg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      ts: Date.now(),
      content: text,
    }
    set((s) => ({ messages: [...s.messages, msg], ...stateForRunPhase('thinking') }))
  },
  restoreRunPhase(activity) {
    set((s) => {
      const liveActivity = getLiveSessionActivitySnapshot(activity)
      if (!liveActivity) {
        // Guard: don't clear optimistic pending state from stale/periodic updates.
        // For non-blocking adapters (Claude), there's a gap between res ok:true
        // and the first activity event where activity is null. The pending state
        // will transition to a real runId once agent events arrive, at which
        // point null activity can clear it normally.
        if (s.currentRunId === PENDING_CHAT_RUN_ID) {
          return s
        }
        return s.isTyping ? { ...stateForRunPhase('idle'), currentRunId: null } : s
      }
      const phase = liveActivity.runPhase as ChatRunPhase
      if (s.runPhase === phase && s.currentRunId === liveActivity.runId) return s
      return { ...stateForRunPhase(phase), currentRunId: liveActivity.runId }
    })
  },
  loadMessages(msgs) {
    set({ messages: msgs.filter(isRenderableMessage) })
  },
  clear() {
    set({
      sessionId: null,
      messages: [],
      ...stateForRunPhase('idle'),
      currentRunId: null,
      queue: null,
      hasMore: true,
      loading: false,
      sessionLoadFailed: false,
    })
  },
}))
