// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-model-settings.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { getShennianDir, loadConfig } from '../config/index.js'
export const OFFICIAL_MODEL = 'deepseek-v4.1-flash-1017'
export type PersonalModelSettings = { mode: 'official' | 'custom'; model?: string; baseUrl?: string; apiKey?: string; contextWindow?: number }
const location = () => {
  const account = loadConfig().accountNamespaceId ?? 'unpaired'
  const scope = createHash('sha256').update(account).digest('hex').slice(0, 32)
  return path.join(getShennianDir(), `personal-model-${scope}.json`)
}
const fail = (): never => { throw new Error('personal_model_settings_invalid') }
export function validatePersonalModel(value: unknown): PersonalModelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const p = value as Record<string, unknown>
  if (Object.keys(p).some(k => !['mode', 'model', 'baseUrl', 'apiKey', 'contextWindow'].includes(k)) || !['official', 'custom'].includes(String(p.mode))) return fail()
  for (const key of ['model', 'baseUrl', 'apiKey']) if (p[key] !== undefined && (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > (key === 'apiKey' ? 8192 : 2000) || /[\u0000-\u001f]/.test(p[key]))) return fail()
  if (p.contextWindow !== undefined && (!Number.isSafeInteger(p.contextWindow) || Number(p.contextWindow) < 8192 || Number(p.contextWindow) > 2000000)) return fail()
  if (p.baseUrl) {
    let url: URL
    try { url = new URL(String(p.baseUrl)) } catch { return fail() }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) return fail()
  }
  if (p.mode === 'custom' && (!p.model || !p.baseUrl || !p.apiKey)) return fail()
  return { mode: p.mode as PersonalModelSettings['mode'], ...(p.model ? { model: String(p.model).trim() } : {}), ...(p.baseUrl ? { baseUrl: String(p.baseUrl).trim().replace(/\/$/, '') } : {}), ...(p.apiKey ? { apiKey: String(p.apiKey).trim() } : {}), ...(p.contextWindow ? { contextWindow: Number(p.contextWindow) } : {}) }
}
export function readPersonalModel(): PersonalModelSettings {
  try {
    const fd = fs.openSync(location(), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > 16384) return fail()
      return validatePersonalModel(JSON.parse(fs.readFileSync(fd, 'utf8')))
    } finally { fs.closeSync(fd) }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 'official' }; return fail() }
}
export function personalModelSummary(settings = readPersonalModel()) {
  return { mode: settings.mode, model: settings.mode === 'official' ? OFFICIAL_MODEL : settings.model!, baseUrl: settings.baseUrl ?? '', hasApiKey: Boolean(settings.apiKey), contextWindow: settings.contextWindow ?? 1000000 }
}
export function savePersonalModel(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
  const update = raw as Partial<PersonalModelSettings>
  // An omitted key means keep it; an empty key is rejected, never silently accepted.
  const next = validatePersonalModel({ ...readPersonalModel(), ...update })
  const dir = getShennianDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${location()}.${randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, JSON.stringify(next) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, location()) }
  finally { try { fs.unlinkSync(tmp) } catch { /* renamed */ } }
  return personalModelSummary(next)
}

/** Keep small custom context windows usable too; never reserve more than the model can hold. */
export function personalCompactionSettings(contextWindow = 1000000) {
  return { enabled: true, reserveTokens: Math.min(8192, Math.floor(contextWindow / 4)), keepRecentTokens: Math.min(16000, Math.floor(contextWindow / 4)) }
}
