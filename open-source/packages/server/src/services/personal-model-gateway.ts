import { reservePersonalModelQuota } from './personal-model-quota.js'
import { platformTextBaseUrl } from './platform-model.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-model-gateway.test.ts
import { randomUUID } from 'node:crypto'
import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { ensureNianHostedModelAllowed, reserveNianQuota, getNianQuotaConfig, chargeNianHostedModelUsage } from './agent-proxy.js'
import { OFFICIAL_PERSONAL_MODEL } from './personal-model-credentials.js'

type Completion = { model?: unknown; messages?: unknown; tools?: unknown; stream?: unknown; max_tokens?: unknown; temperature?: unknown; tool_choice?: unknown }
/** Strictly rebuild the request; callers cannot choose upstream URLs, headers or another paid model. */
export function officialCompletion(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('model_request_invalid')
  const body = raw as Completion
  if (body.model !== OFFICIAL_PERSONAL_MODEL || (body.stream !== undefined && typeof body.stream !== 'boolean') || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 10000) throw new Error('model_request_invalid')
  const max = getNianQuotaConfig().maxOutputTokens
  if (body.max_tokens !== undefined && (!Number.isSafeInteger(body.max_tokens) || Number(body.max_tokens) <= 0)) throw new Error('model_request_invalid')
  if (body.temperature !== undefined && (typeof body.temperature !== 'number' || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2)) throw new Error('model_request_invalid')
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 128)) throw new Error('model_request_invalid')
  return {
    model: OFFICIAL_PERSONAL_MODEL, messages: body.messages, stream: body.stream === true,
    ...(body.stream === true ? { stream_options: { include_usage: true } } : {}), enable_thinking: false,
    max_tokens: Math.min(Number(body.max_tokens ?? max), max),
    ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
    ...(body.tools === undefined ? {} : { tools: body.tools, tool_choice: 'auto' }),
  }
}
/** Observes SSE usage while preserving provider bytes, including split UTF-8 and split lines. */
export class CompletionUsage extends Transform {
  inputTokens = 0
  outputTokens = 0
  hasUsage = false
  private pending = ''
  private decoder = new TextDecoder()
  private observe(text: string) {
    this.pending += text
    const lines = this.pending.split('\n')
    this.pending = lines.pop() ?? ''
    if (this.pending.length > 2 * 1024 * 1024) throw new Error('model_stream_invalid')
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      try {
        const data = JSON.parse(line.slice(5)) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
        if (Number.isSafeInteger(data.usage?.prompt_tokens) && data.usage!.prompt_tokens! >= 0 && Number.isSafeInteger(data.usage?.completion_tokens) && data.usage!.completion_tokens! >= 0) this.hasUsage = true
        if (Number.isSafeInteger(data.usage?.prompt_tokens) && data.usage!.prompt_tokens! >= 0) this.inputTokens = data.usage!.prompt_tokens!
        if (Number.isSafeInteger(data.usage?.completion_tokens) && data.usage!.completion_tokens! >= 0) this.outputTokens = data.usage!.completion_tokens!
      } catch { /* [DONE] and non-usage events are passed through, not interpreted. */ }
    }
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    try { this.observe(this.decoder.decode(chunk, { stream: true })); callback(null, chunk) }
    catch { callback(new Error('model_stream_invalid')) }
  }
  override _flush(callback: (error?: Error | null) => void) {
    try { this.observe(this.decoder.decode() + '\n'); callback() } catch { callback(new Error('model_stream_invalid')) }
  }
}
export async function streamPersonalModel(request: FastifyRequest, reply: FastifyReply) {
  let body: Record<string, unknown>
  try { body = officialCompletion(request.body) } catch { return reply.code(400).send({ error: 'model_request_invalid' }) }
  // Key and URL are only loaded inside the Server process; never send provider errors or config back.
  const key = process.env.DASHSCOPE_API_KEY
  let baseUrl: string
  try { baseUrl = platformTextBaseUrl() } catch { return reply.code(503).send({ error: 'official_model_not_configured' }) }
  if (!key) return reply.code(503).send({ error: 'official_model_not_configured' })
  try { await ensureNianHostedModelAllowed(request.userId) }
  catch { return reply.code(402).send({ error: 'official_model_entitlement_required' }) }
  const quota = await reserveNianQuota(request.userId, { model: { id: OFFICIAL_PERSONAL_MODEL, api: 'openai-completions', provider: 'shennian' }, context: { messages: [{ role: 'user', content: JSON.stringify(body.messages) }] } })
  if (!quota.allowed) {
    if (quota.retryAfterSeconds) reply.header('Retry-After', String(quota.retryAfterSeconds))
    return reply.code(quota.statusCode).send({ error: quota.code, message: quota.message })
  }
  let monthly
  try { monthly = await reservePersonalModelQuota(request.userId, body) }
  catch { return reply.code(503).send({ error: 'official_model_quota_unavailable' }) }
  if (!monthly) return reply.code(429).send({ error: 'personal_model_monthly_quota_exceeded', message: '本月免费额度不足以完成本次请求，请下月再试或使用自己的模型。' })
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), getNianQuotaConfig().requestTimeoutMs)
  const close = () => abort.abort()
  reply.raw.once('close', close)
  const usage = new CompletionUsage()
  let upstream: Response | undefined
  let usageSettled = false
  let monthlyUsage: { inputTokens: number; outputTokens: number } | null = null
  try {
    upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: abort.signal,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!upstream.ok || !upstream.body) {
      monthlyUsage = { inputTokens: 0, outputTokens: 0 }
      await upstream.body?.cancel()
      return reply.code(502).send({ error: 'official_model_unavailable' })
    }
    if (body.stream !== true) {
      const result = await upstream.json() as { choices?: unknown[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      if (!Array.isArray(result.choices)) return reply.code(502).send({ error: 'official_model_unavailable' })
      if (Number.isSafeInteger(result.usage?.prompt_tokens) && Number(result.usage?.prompt_tokens) >= 0 && Number.isSafeInteger(result.usage?.completion_tokens) && Number(result.usage?.completion_tokens) >= 0) monthlyUsage = { inputTokens: result.usage!.prompt_tokens!, outputTokens: result.usage!.completion_tokens! }
      usage.inputTokens = Math.max(0, Number(result.usage?.prompt_tokens) || 0)
      usage.outputTokens = Math.max(0, Number(result.usage?.completion_tokens) || 0)
      // Non-streaming requests settle billing before returning success.
      usageSettled = true
      await chargeNianHostedModelUsage({ userId: request.userId, modelId: OFFICIAL_PERSONAL_MODEL, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usageRefId: `personal:${randomUUID()}` })
      usage.inputTokens = 0; usage.outputTokens = 0
      return reply.send(result)
    }
    reply.hijack()
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
    // pipeline honors backpressure and tears down upstream on disconnect.
    await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), usage, reply.raw)
  } catch {
    if (!reply.sent) return reply.code(502).send({ error: 'official_model_unavailable' })
    reply.raw.destroy()
  } finally {
    clearTimeout(timeout)
    reply.raw.off('close', close)
    try { await monthly.settle(monthlyUsage ?? (usage.hasUsage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : null)) }
    catch { request.log.error('Personal model quota settlement failed; reservation retained') }
    if (!usageSettled && upstream?.ok && (usage.inputTokens || usage.outputTokens)) {
      // Same existing per-user billing path; no prompt, key or upstream error is logged.
      await chargeNianHostedModelUsage({ userId: request.userId, modelId: OFFICIAL_PERSONAL_MODEL, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usageRefId: `personal:${randomUUID()}` })
    }
  }
}
