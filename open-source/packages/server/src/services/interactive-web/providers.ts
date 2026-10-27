// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-providers.test.ts

import { PLATFORM_TEXT_MODEL, platformTextBaseUrl } from '../platform-model.js'
import type { LoopMessage, ModelStep, INTERACTIVE_AGENT_ENTRY_TOOLS } from './agent-loop.js'
import { ContentError } from './repository.js'

export async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new ContentError('provider_result_too_large', 502)
  const reader = response.body?.getReader()
  if (!reader) throw new ContentError('provider_empty_body', 502)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > maxBytes) throw new ContentError('provider_result_too_large', 502)
      chunks.push(part.value)
    }
    return Buffer.concat(chunks)
  } finally { await reader.cancel().catch(() => {}) }
}
function endpoint(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ContentError('invalid_provider_configuration', 503)
  return url.href.replace(/\/$/, '')
}
export function contentProviderConfig() {
  return { key: process.env.DASHSCOPE_API_KEY || '',
    base: platformTextBaseUrl(),
    model: PLATFORM_TEXT_MODEL,
    imageKey: process.env.INTERACTIVE_IMAGE_API_KEY || process.env.DASHSCOPE_API_KEY || '',
    imageBase: endpoint(process.env.INTERACTIVE_IMAGE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'),
    imageModel: process.env.INTERACTIVE_IMAGE_MODEL || 'qwen-image-2.0-pro',
    imageProtocol: process.env.INTERACTIVE_IMAGE_PROTOCOL === 'openai' ? 'openai' : 'dashscope' }
}
export async function providerJson(url: string, key: string, body: object, signal: AbortSignal, maxBytes = 1_500_000) {
  if (!key) throw new ContentError('model_not_configured', 503)
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) {
    await response.body?.cancel()
    throw new ContentError(`provider_http_${response.status}`, 502)
  }
  return JSON.parse((await readLimited(response, maxBytes)).toString('utf8')) as Record<string, unknown>
}
const names: Record<string, string> = { 'context.inspect': 'context_inspect', 'tools.find': 'tools_find',
  'tools.describe': 'tools_describe', 'tools.invoke': 'tools_invoke' }
export function toProviderMessages(messages: readonly LoopMessage[]) {
  return messages.map((message) => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.callId, content: message.content }
    if (message.role === 'assistant' && message.calls?.length) return { role: 'assistant', content: message.content || null,
      tool_calls: message.calls.map((call) => ({ id: call.id, type: 'function',
        function: { name: names[call.name] ?? call.name, arguments: JSON.stringify(call.args) } })) }
    return { role: message.role, content: message.content }
  })
}
export function parseModelStep(data: Record<string, unknown>, reverseNames: Record<string, string> = {}): ModelStep {
  const choices = data.choices as Array<{ message?: { content?: unknown; tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }> } }> | undefined
  const message = choices?.[0]?.message
  if (!message) throw new ContentError('invalid_model_response', 502)
  const calls = message.tool_calls?.map((call) => {
    if (typeof call.id !== 'string' || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') {
      throw new ContentError('invalid_model_tool_call', 502)
    }
    const args = JSON.parse(call.function.arguments) as unknown
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ContentError('invalid_model_tool_arguments', 502)
    return { id: call.id, name: reverseNames[call.function.name] ?? call.function.name, args: args as Record<string, unknown> }
  })
  return { text: typeof message.content === 'string' ? message.content : undefined, calls }
}
export async function interactiveModel(messages: readonly LoopMessage[], tools: typeof INTERACTIVE_AGENT_ENTRY_TOOLS, signal: AbortSignal, maxTokens = 1800, onUsage?: (tokens: number) => void): Promise<ModelStep> {
  const config = contentProviderConfig()
  const data = await providerJson(`${config.base}/chat/completions`, config.key, {
    model: config.model, enable_thinking: false, max_tokens: maxTokens,
    messages: toProviderMessages(messages),
    tools: tools.map((tool) => ({ type: 'function', function: { name: names[tool.id],
      description: tool.description, parameters: tool.parameters } })), parallel_tool_calls: false,
  }, signal)
  const usage = data.usage as { total_tokens?: number } | undefined
  if (typeof usage?.total_tokens === 'number' && Number.isFinite(usage.total_tokens) && usage.total_tokens >= 0) onUsage?.(usage.total_tokens)
  return parseModelStep(data, Object.fromEntries(Object.entries(names).map(([key, value]) => [value, key])))
}

export function createInteractiveModel(maxOutputTokens = 1800, totalTokenBudget = 30000) {
  let remaining = totalTokenBudget
  return async (messages: readonly LoopMessage[], tools: typeof INTERACTIVE_AGENT_ENTRY_TOOLS, signal: AbortSignal) => {
    const estimatedInput = Math.ceil(JSON.stringify(messages).length / 2) + 800
    const output = Math.min(maxOutputTokens, remaining - estimatedInput)
    if (output < 512) throw new ContentError('model_token_budget_exhausted', 429)
    remaining -= estimatedInput + output
    return interactiveModel(messages, tools, signal, output, (used) => { remaining += estimatedInput + output - used })
  }
}
