// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/pi-turn-diagnostics.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export type PiModelSelectionSource =
  | 'room_effective_model'
  | 'persisted_session_model'
  | 'queued_message_model'
  | 'request_model'
  | 'pi_default_model'
  | 'upgrade_recovery_model'
  | 'unknown'

export type PiObservedModel = {
  provider?: string
  id?: string
  api?: string
  baseUrl?: string
}

export type PiCredentialPresence = true | false | 'unknown'

export type PiTurnDiagnostic = {
  marker: string
  phase: 'request_config' | 'outcome'
  outcome?: 'completed' | 'failed' | 'aborted'
  errorStage?: 'process_start' | 'state_read' | 'model_selection' | 'thinking_selection' | 'prompt_dispatch' | 'pi_model_turn' | 'pi_process'
  errorCode?: string
  httpStatus?: number
  requestedProvider?: string
  requestedModel?: string
  provider?: string
  model?: string
  modelSelectionSource: PiModelSelectionSource
  piObservedRequestConfig: boolean
  finalHttpRequestObserved: false
  api?: string
  target?: { scheme: 'http' | 'https'; host: string; port?: string }
  providerConfigSource: 'pi_runtime_catalog' | 'models_file' | 'unknown'
  credentialSource: 'auth_file' | 'process_environment' | 'models_file_environment' | 'models_file_literal' | 'models_file_command' | 'oauth' | 'unknown'
  credentialPresent: PiCredentialPresence
  agentDirSource: 'pi_agent_dir_environment' | 'user_home_default'
  historyMessageCount: number | null
  attachmentCount: number
  imageAttachmentCount: number
  toolCallCount: number
  queuedIntoActiveRun: boolean
}

const PROVIDER_ENV_KEYS: Record<string, readonly string[]> = {
  anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  google: ['GEMINI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  xai: ['XAI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  opencode: ['OPENCODE_API_KEY'],
}

function safeDimension(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/.test(trimmed) ? trimmed : fallback
}

export function sanitizePiDiagnosticDimension(value: unknown): string | undefined {
  const safe = safeDimension(value, '')
  return safe || undefined
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > 1024 * 1024) return null
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function environmentReferences(value: string): string[] {
  const refs = new Set<string>()
  for (const match of value.matchAll(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g)) {
    refs.add(match[1] ?? match[2]!)
  }
  return [...refs]
}

function configuredValuePresence(value: unknown, env: NodeJS.ProcessEnv): {
  source: 'models_file_environment' | 'models_file_literal' | 'models_file_command' | 'unknown'
  present: PiCredentialPresence
} {
  if (typeof value !== 'string' || !value.trim()) return { source: 'unknown', present: false }
  const trimmed = value.trim()
  if (trimmed.startsWith('!')) return { source: 'models_file_command', present: 'unknown' }
  const refs = environmentReferences(trimmed)
  if (refs.length) {
    return {
      source: 'models_file_environment',
      present: refs.every((key) => Boolean(env[key])) ? true : false,
    }
  }
  return { source: 'models_file_literal', present: true }
}

function storedCredentialPresence(value: unknown, env: NodeJS.ProcessEnv): {
  source: 'auth_file' | 'oauth'
  present: PiCredentialPresence
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.type === 'oauth') {
    return {
      source: 'oauth',
      present: typeof record.access === 'string' && record.access.length > 0,
    }
  }
  if (record.type !== 'api_key') return null
  const scopedEnv = record.env && typeof record.env === 'object' && !Array.isArray(record.env)
    ? Object.fromEntries(Object.entries(record.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {}
  const configured = configuredValuePresence(record.key, { ...env, ...scopedEnv })
  return { source: 'auth_file', present: configured.present }
}

function safeTarget(baseUrl: unknown): PiTurnDiagnostic['target'] | undefined {
  if (typeof baseUrl !== 'string') return undefined
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (!parsed.hostname) return undefined
    return {
      scheme: parsed.protocol.slice(0, -1) as 'http' | 'https',
      host: parsed.hostname,
      ...(parsed.port ? { port: parsed.port } : {}),
    }
  } catch {
    return undefined
  }
}

export function inspectPiTurnConfiguration(input: {
  model: PiObservedModel | null | undefined
  env: NodeJS.ProcessEnv
  agentDir?: string
}): Pick<PiTurnDiagnostic,
  'provider' | 'model' | 'api' | 'target' | 'providerConfigSource' | 'credentialSource' | 'credentialPresent' | 'agentDirSource'
> {
  const provider = safeDimension(input.model?.provider, 'unknown')
  const model = safeDimension(input.model?.id, 'unknown')
  const agentDir = input.agentDir ?? (
    input.env.PI_CODING_AGENT_DIR?.trim() ||
    path.join(input.env.HOME?.trim() || os.homedir(), '.pi', 'agent')
  )
  const agentDirSource = input.agentDir || input.env.PI_CODING_AGENT_DIR?.trim()
    ? 'pi_agent_dir_environment' as const
    : 'user_home_default' as const
  const models = readJsonObject(path.join(agentDir, 'models.json'))
  const providers = models?.providers && typeof models.providers === 'object' && !Array.isArray(models.providers)
    ? models.providers as Record<string, unknown>
    : null
  const providerConfig = providers?.[provider]
  const providerRecord = providerConfig && typeof providerConfig === 'object' && !Array.isArray(providerConfig)
    ? providerConfig as Record<string, unknown>
    : null
  const providerConfigSource = providerRecord
    ? 'models_file' as const
    : provider === 'unknown'
      ? 'unknown' as const
      : 'pi_runtime_catalog' as const

  const auth = readJsonObject(path.join(agentDir, 'auth.json'))
  const stored = storedCredentialPresence(auth?.[provider], input.env)
  let credentialSource: PiTurnDiagnostic['credentialSource'] = 'unknown'
  let credentialPresent: PiCredentialPresence = PROVIDER_ENV_KEYS[provider] || providerRecord
    ? false
    : 'unknown'
  if (stored) {
    credentialSource = stored.source
    credentialPresent = stored.present
  } else {
    const envKeys = PROVIDER_ENV_KEYS[provider] ?? []
    if (envKeys.some((key) => Boolean(input.env[key]))) {
      credentialSource = 'process_environment'
      credentialPresent = true
    } else if (providerRecord && 'apiKey' in providerRecord) {
      const configured = configuredValuePresence(providerRecord.apiKey, input.env)
      credentialSource = configured.source
      credentialPresent = configured.present
    }
  }

  return {
    provider,
    model,
    api: safeDimension(input.model?.api, 'unknown'),
    target: safeTarget(input.model?.baseUrl),
    providerConfigSource,
    credentialSource,
    credentialPresent,
    agentDirSource,
  }
}

export function createPiDiagnosticMarker(): string {
  return randomBytes(9).toString('base64url')
}

export function classifyPiFailure(value: unknown): {
  errorCode: string
  httpStatus?: number
  safeDetail?: string
} {
  const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  const statusMatch = raw.match(/(?:^|\D)([1-5]\d\d)(?:\D|$)/)
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined
  const rules: Array<[RegExp, string, string]> = [
    [/request not allowed/i, 'request_not_allowed', 'Request not allowed'],
    [/provider unavailable/i, 'provider_unavailable', 'Provider unavailable'],
    [/model not found/i, 'model_not_found', 'Model not found'],
    [/rate[ -]?limit/i, 'rate_limited', 'Rate limited'],
    [/quota/i, 'quota_exceeded', 'Quota exceeded'],
    [/unauthori[sz]ed|authentication required|invalid api key/i, 'authentication_rejected', 'Authentication rejected'],
    [/forbidden/i, 'forbidden', 'Forbidden'],
    [/timed? out|timeout/i, 'timeout', 'Timed out'],
    [/connection (?:refused|reset)|fetch failed/i, 'connection_failed', 'Connection failed'],
  ]
  const matched = rules.find(([pattern]) => pattern.test(raw))
  return {
    errorCode: httpStatus ? `http_${httpStatus}` : matched?.[1] ?? 'pi_error',
    ...(httpStatus ? { httpStatus } : {}),
    ...(matched ? { safeDetail: matched[2] } : {}),
  }
}

export function formatPiDiagnostic(entry: PiTurnDiagnostic): string {
  return `[pi.diagnostic] ${JSON.stringify(entry)}`
}
