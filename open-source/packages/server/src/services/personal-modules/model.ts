// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-modules.test.ts

import { PLATFORM_TEXT_MODEL, platformTextBaseUrl } from '../platform-model.js'
export async function completeModuleJson(
  system: string,
  input: unknown,
  options: {
    maxTokens?: number
    onUsage?: (usage: { inputTokens: number; outputTokens: number; model: string }) => void
  } = {},
): Promise<Record<string, unknown>> {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) throw new Error('personal_modules_model_unavailable')
  const response = await fetch(`${platformTextBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: PLATFORM_TEXT_MODEL,
      enable_thinking: false,
      response_format: { type: 'json_object' },
      max_tokens: options.maxTokens ?? 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error('personal_modules_model_unavailable')
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  if (Number.isFinite(data.usage?.prompt_tokens) && Number.isFinite(data.usage?.completion_tokens))
    options.onUsage?.({
      inputTokens: data.usage!.prompt_tokens!,
      outputTokens: data.usage!.completion_tokens!,
      model: PLATFORM_TEXT_MODEL,
    })
  const result: unknown = JSON.parse(data.choices?.[0]?.message?.content ?? '')
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('invalid_model_response')
  return result as Record<string, unknown>
}
