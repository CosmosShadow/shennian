// @arch open-source/docs/cli-runtime.md

import type { AgentAdapter, AgentEvent, AgentSendResult } from './adapter.js'

const MAX_REPLY_LENGTH = 20_000

export class PublicAgentReplyError extends Error {
  constructor(readonly code: 'empty_reply' | 'output_too_long' | 'failed' | 'aborted' | 'timeout'
    | 'external_owner' | 'provider_limit' | 'unauthorized_tool_attempt') {
    super(code)
  }
}

function providerLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /\b(?:insufficient quota|quota exceeded|out of credits|insufficient credits|billing hard limit|rate limit exceeded)\b|额度不足|余额不足|配额已用尽/.test(message.toLowerCase().slice(0, 1000))
}

/** Capture only the Agent's visible answer; the host owns the reply capability. */
export async function collectPublicAgentReply(input: {
  adapter: AgentAdapter
  send: () => Promise<void | AgentSendResult>
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<string> {
  const timeoutMs = Math.min(input.timeoutMs ?? 8 * 60_000, 8 * 60_000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new PublicAgentReplyError('timeout')
  let answer = ''
  let runId: string | null = null
  let settled = false
  let finalReceived = false
  let sendCompleted = false
  let resolveReply!: (value: string) => void
  let rejectReply!: (reason: Error) => void
  const result = new Promise<string>((resolve, reject) => {
    resolveReply = resolve
    rejectReply = reject
  })
  const finish = (error?: PublicAgentReplyError) => {
    if (settled) return
    settled = true
    if (error) rejectReply(error)
    else if (!answer.trim()) rejectReply(new PublicAgentReplyError('empty_reply'))
    else resolveReply(answer.trim())
  }
  const onEvent = (event: AgentEvent) => {
    if (settled) return
    if (event.runId) {
      if (runId && event.runId !== runId) return
      runId = event.runId
    }
    if (event.state === 'delta' && !event.thinking && event.text) {
      answer += event.text
      if (answer.length > MAX_REPLY_LENGTH) finish(new PublicAgentReplyError('output_too_long'))
    } else if (event.state === 'final') {
      finalReceived = true
      if (sendCompleted) finish()
    }
    else if (event.state === 'error') finish(new PublicAgentReplyError(
      providerLimit(event.message) ? 'provider_limit' : 'failed'))
    else if (event.state === 'aborted') finish(new PublicAgentReplyError('aborted'))
    // Tool events are not reply text. The Adapter's compiled permission
    // policy decides whether each tool can execute; a public turn must not
    // mistake a permitted file read (or a denied attempt) for a fatal leak.
    // Interactive approval cannot be delegated to a visitor, however.
    else if (event.state === 'approval-pending') {
      finish(new PublicAgentReplyError('unauthorized_tool_attempt'))
      void input.adapter.stop().catch(() => {})
    }
  }
  const onError = (error: unknown) => finish(new PublicAgentReplyError(
    providerLimit(error) ? 'provider_limit' : 'failed'))
  const onAbort = () => {
    finish(new PublicAgentReplyError('aborted'))
    void input.adapter.stop().catch(() => {})
  }
  if (input.signal?.aborted) throw new PublicAgentReplyError('aborted')
  input.adapter.on('agentEvent', onEvent)
  input.adapter.on('error', onError)
  input.signal?.addEventListener('abort', onAbort, { once: true })
  if (input.signal?.aborted) onAbort()
  const timer = setTimeout(() => {
    if (!settled) {
      finish(new PublicAgentReplyError('timeout'))
      void input.adapter.stop().catch(() => {})
    }
  }, timeoutMs)
  try {
    try {
      void input.send().then((delivery) => {
        if (delivery?.deliveryMode === 'external_owner_queue') {
          finish(new PublicAgentReplyError('external_owner'))
        } else {
          sendCompleted = true
          if (finalReceived) finish()
        }
      }).catch((error) => finish(new PublicAgentReplyError(
        providerLimit(error) ? 'provider_limit' : 'failed')))
    } catch (error) { finish(new PublicAgentReplyError(
      providerLimit(error) ? 'provider_limit' : 'failed')) }
    return await result
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
    input.adapter.off('agentEvent', onEvent)
    input.adapter.off('error', onError)
  }
}
