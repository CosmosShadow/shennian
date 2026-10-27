// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-model-settings.test.ts
import { loadConfig } from '../config/index.js'
import { readPersonalModel, savePersonalModel, validatePersonalModel } from './model-settings.js'

// Verified against provider documentation on 2026-10-23. Only exact URLs get a preset.
const presets: Record<string, string> = {
  'https://dashscope.aliyuncs.com/compatible-mode/v1': 'deepseek-v4.1-flash-1017',
  'https://tokenhub.tencentmaas.com/v1': 'deepseek-v4-flash',
  'https://api.deepseek.com': 'deepseek-flash',
  'https://api.deepseek.com/v1': 'deepseek-flash',
}
const fail = (): never => { throw new Error('personal_model_settings_invalid') }
async function discoverModel(baseUrl: string, apiKey: string): Promise<string> {
  const response = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(8000) })
  if (!response.ok || !response.body) { await response.body?.cancel(); return fail() }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 256 * 1024) return fail()
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: Array<{ id?: unknown; isDefault?: unknown; is_default?: unknown }> }
  if (!Array.isArray(parsed.data)) return fail()
  const models = parsed.data.filter(m => m && typeof m.id === 'string' && m.id.trim() && m.id.length <= 2000 && !/[\u0000-\u001f]/.test(m.id) && !/embed|rerank|whisper|tts|dall-e|moderation/i.test(m.id))
  const selected = models.find(m => m.isDefault === true || m.is_default === true) ?? models.find(m => /deepseek.*flash|deepseek-chat|qwen.*plus|gpt.*mini/i.test(String(m.id))) ?? models[0]
  return typeof selected?.id === 'string' ? selected.id.trim() : fail()
}
/** UI never asks for model IDs; explicit CLI IDs remain backward compatible. */
export async function saveAutomaticPersonalModel(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
  const update = raw as Record<string, unknown>
  if (update.mode !== 'custom' || update.model !== undefined) return savePersonalModel(raw)
  const previous = readPersonalModel()
  const account = loadConfig().accountNamespaceId
  const baseUrl = typeof update.baseUrl === 'string' ? update.baseUrl.trim().replace(/\/$/, '') : previous.baseUrl
  if (!baseUrl) return fail()
  // Never forward a saved provider key to a newly selected destination.
  if (baseUrl !== previous.baseUrl && !update.apiKey) return fail()
  const candidate = validatePersonalModel({ ...previous, ...update, baseUrl, model: previous.model ?? 'automatic' })
  const model = previous.baseUrl === baseUrl && previous.model ? previous.model : presets[baseUrl] ?? await discoverModel(baseUrl, candidate.apiKey!)
  // A delayed response must not save into a different account or overwrite a newer edit.
  if (loadConfig().accountNamespaceId !== account || JSON.stringify(readPersonalModel()) !== JSON.stringify(previous)) return fail()
  return savePersonalModel({ ...candidate, model })
}
