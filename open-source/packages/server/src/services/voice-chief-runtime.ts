// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-runtime.test.ts
// @test src/__tests__/voice-chief-cross-instance.test.ts

import { pubsub } from '../relay/pubsub.js'

export type VoiceChiefConversationSubscriber = (message: {
  conversationId: string
  runId: string
  text: string
  state: 'final' | 'error' | 'aborted'
}) => void

export type VoiceChiefManagerSubscriber = (message: {
  managerSessionId: string
  runId: string
  text: string
}) => void

export type VoiceChiefConversationMessage = Parameters<VoiceChiefConversationSubscriber>[0]

export const VOICE_CHIEF_AGENT_EVENT_MAX_CHARS = 1_800

export type VoiceChiefAgentEventSummary = {
  kind: 'question' | 'failed' | 'completed' | 'progress'
  text: string
  requiresUserResponse: boolean
}

export function summarizeVoiceChiefAgentEvent(
  text: string,
  state: 'final' | 'error' | 'aborted' = 'final',
): VoiceChiefAgentEventSummary {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const question =
    /[？?](?:[”"'）】》]*)$/u.test(normalized) ||
    /(?:请确认|需要你|是否要|是否需要|请选择|可以吗|要不要)/u.test(normalized)
  const kind =
    state === 'error' || state === 'aborted' ? 'failed' : question ? 'question' : 'completed'
  const limit = kind === 'question' ? 1_000 : 800
  const clipped =
    normalized.length <= limit
      ? normalized
      : `${normalized.slice(0, Math.floor(limit * 0.72))}…${normalized.slice(-Math.floor(limit * 0.22))}`
  return {
    kind,
    text: clipped,
    requiresUserResponse: kind === 'question',
  }
}

const subscribers = new Map<string, Set<VoiceChiefConversationSubscriber>>()
const transportUnsubscribers = new Map<string, () => void>()
const runText = new Map<string, string>()

function runKey(sessionId: string, runId: string) {
  return `${sessionId}\0${runId}`
}

export function subscribeVoiceChiefConversation(
  conversationId: string,
  subscriber: VoiceChiefConversationSubscriber,
): () => void {
  const current = subscribers.get(conversationId) ?? new Set<VoiceChiefConversationSubscriber>()
  current.add(subscriber)
  subscribers.set(conversationId, current)
  if (pubsub.isActive && !transportUnsubscribers.has(conversationId)) {
    transportUnsubscribers.set(
      conversationId,
      pubsub.subscribeVoiceChiefConversation(conversationId, (data) => {
        try {
          handleVoiceChiefAgentEvent(JSON.parse(data) as Record<string, unknown>)
        } catch {
          // Ignore malformed internal transport frames.
        }
      }),
    )
  }
  return () => {
    const active = subscribers.get(conversationId)
    active?.delete(subscriber)
    if (active?.size === 0) {
      subscribers.delete(conversationId)
      transportUnsubscribers.get(conversationId)?.()
      transportUnsubscribers.delete(conversationId)
    }
  }
}

export function subscribeVoiceChiefManager(
  managerSessionId: string,
  subscriber: VoiceChiefManagerSubscriber,
): () => void {
  return subscribeVoiceChiefConversation(managerSessionId, (message) => {
    subscriber({ managerSessionId, runId: message.runId, text: message.text })
  })
}

export function handleVoiceChiefAgentEvent(payload: Record<string, unknown>): void {
  const message = consumeVoiceChiefAgentEvent(payload)
  if (message) deliverVoiceChiefConversationMessage(message)
}

export function routeVoiceChiefAgentEvent(payload: Record<string, unknown>): void {
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
  if (sessionId && pubsub.isActive) {
    pubsub.publishVoiceChiefConversation(sessionId, JSON.stringify(payload))
    return
  }
  handleVoiceChiefAgentEvent(payload)
}

function consumeVoiceChiefAgentEvent(
  payload: Record<string, unknown>,
): VoiceChiefConversationMessage | null {
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
  const runId = typeof payload.runId === 'string' ? payload.runId : ''
  const state = typeof payload.state === 'string' ? payload.state : ''
  if (!sessionId || !runId || !subscribers.has(sessionId)) return null
  const key = runKey(sessionId, runId)
  if (state === 'start' || state === 'init') {
    runText.set(key, '')
    return null
  }
  if (state === 'delta' && !payload.thinking && typeof payload.text === 'string') {
    const next = `${runText.get(key) ?? ''}${payload.text}`
    runText.set(
      key,
      next.length <= VOICE_CHIEF_AGENT_EVENT_MAX_CHARS
        ? next
        : `${next.slice(0, 1_200)}\n……（中间内容已省略）……\n${next.slice(-500)}`,
    )
    return null
  }
  if (state !== 'final' && state !== 'error' && state !== 'aborted') return null

  const accumulated = (runText.get(key) ?? '').trim()
  runText.delete(key)
  const fallback =
    (state === 'error' || state === 'aborted') && typeof payload.message === 'string'
      ? payload.message.trim()
      : ''
  const text = accumulated || fallback
  if (!text) return null
  return {
    conversationId: sessionId,
    runId,
    text,
    state,
  }
}

function deliverVoiceChiefConversationMessage(message: VoiceChiefConversationMessage): void {
  for (const subscriber of subscribers.get(message.conversationId) ?? []) {
    subscriber(message)
  }
}
