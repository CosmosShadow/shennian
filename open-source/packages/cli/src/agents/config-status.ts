// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-config-status.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentConfigStatus, AgentConfigSummary, AgentType } from '@shennian/wire'
import { readLatestUserEnv } from '../agent-env.js'
import { loadConfig, resolveShennianPath } from '../config/index.js'

export type ConfigurableAgent = 'codex' | 'claude' | 'pi'

export type AgentProviderConfigRecord = {
  agent: ConfigurableAgent
  baseUrl?: string
  token?: string
  updatedAt: string
}

type ProviderConfigFile = {
  configs: Partial<Record<ConfigurableAgent, AgentProviderConfigRecord>>
}

const MANAGED_CONFIG_PATH = resolveShennianPath('agent-provider-config.json')
const TOKEN_SUFFIX_LENGTH = 4

function isConfigurableAgent(agent: AgentType): agent is ConfigurableAgent {
  return agent === 'codex' || agent === 'claude' || agent === 'pi'
}

const AGENT_ENV_KEYS = {
  codex: {
    baseUrl: ['OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_API_URL'],
    token: ['OPENAI_API_KEY', 'OPENAI_TOKEN'],
  },
  claude: {
    baseUrl: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_URL'],
    token: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  },
  pi: {
    baseUrl: ['DASHSCOPE_BASE_URL', 'DASHSCOPE_API_BASE', 'DASHSCOPE_API_URL'],
    token: ['DASHSCOPE_API_KEY', 'DASHSCOPE_TOKEN'],
  },
} as const

export function getManagedAgentProviderConfig(agent: ConfigurableAgent): AgentProviderConfigRecord | undefined {
  return loadManagedConfig().configs[agent]
}

export function upsertManagedAgentProviderConfig(input: {
  agent: ConfigurableAgent
  baseUrl?: string
  token?: string
}): AgentProviderConfigRecord {
  const file = loadManagedConfig()
  const existing = file.configs[input.agent]
  const record: AgentProviderConfigRecord = {
    agent: input.agent,
    baseUrl: input.baseUrl?.trim() || existing?.baseUrl,
    token: input.token?.trim() || existing?.token,
    updatedAt: new Date().toISOString(),
  }
  file.configs[input.agent] = record
  saveManagedConfig(file)
  return record
}

export function deleteManagedAgentProviderConfig(agent: ConfigurableAgent): void {
  const file = loadManagedConfig()
  delete file.configs[agent]
  saveManagedConfig(file)
}

export function buildManagedAgentEnv(agent: AgentType): NodeJS.ProcessEnv {
  if (!isConfigurableAgent(agent)) return {}
  const config = getManagedAgentProviderConfig(agent)
  if (!config) return {}

  if (agent === 'codex') {
    return compactEnv({
      OPENAI_BASE_URL: config.baseUrl,
      OPENAI_API_KEY: config.token,
    })
  }

  if (agent === 'claude') {
    return compactEnv({
      ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_API_KEY: config.token,
    })
  }

  return compactEnv({
    DASHSCOPE_BASE_URL: config.baseUrl,
    DASHSCOPE_API_KEY: config.token,
  })
}

export function getAgentConfigSummary(agent: AgentType, env?: NodeJS.ProcessEnv): AgentConfigSummary | undefined {
  // Third-party Pi owns provider configuration in its agent dir. Pairing a
  // Shennian machine is not provider authentication and must never be exposed
  // as a Shennian-managed model configuration.
  if (agent === 'pi-coding-agent') return undefined
  if (!isConfigurableAgent(agent)) return undefined

  const managed = getManagedAgentProviderConfig(agent)
  if (managed?.token || managed?.baseUrl) {
    return toSummary({
      agent,
      source: 'shennian',
      status: managed.token ? 'managed' : 'missing',
      baseUrl: managed.baseUrl,
      token: managed.token,
      tokenPresent: !!managed.token,
    })
  }

  const envConfig = detectFromEnv(agent, env ?? readLatestUserEnv())
  if (envConfig.tokenPresent || envConfig.baseUrl) {
    return toSummary({
      agent,
      source: 'env',
      status: envConfig.tokenPresent ? 'detected' : 'missing',
      baseUrl: envConfig.baseUrl,
      token: envConfig.token,
      tokenPresent: envConfig.tokenPresent,
    })
  }

  const fileConfig = detectFromKnownConfigFiles(agent)
  if (fileConfig.tokenPresent || fileConfig.baseUrl) {
    return toSummary({
      agent,
      source: 'config-file',
      status: fileConfig.tokenPresent ? 'detected' : 'missing',
      baseUrl: fileConfig.baseUrl,
      token: fileConfig.token,
      tokenPresent: fileConfig.tokenPresent,
    })
  }

  return toSummary({
    agent,
    source: 'unknown',
    status: 'missing',
    tokenPresent: false,
  })
}

function loadManagedConfig(): ProviderConfigFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANAGED_CONFIG_PATH, 'utf-8')) as ProviderConfigFile
    return { configs: parsed.configs ?? {} }
  } catch {
    return { configs: {} }
  }
}

function saveManagedConfig(file: ProviderConfigFile): void {
  fs.mkdirSync(path.dirname(MANAGED_CONFIG_PATH), { recursive: true })
  fs.writeFileSync(MANAGED_CONFIG_PATH, JSON.stringify(file, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(MANAGED_CONFIG_PATH, 0o600)
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
}

function compactEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const compacted: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value) compacted[key] = value
  }
  return compacted
}

function detectFromEnv(agent: ConfigurableAgent, env: NodeJS.ProcessEnv): {
  baseUrl?: string
  token?: string
  tokenPresent: boolean
} {
  const keys = AGENT_ENV_KEYS[agent]
  const baseUrl = firstEnv(env, keys.baseUrl)
  const token = firstEnv(env, keys.token)
  return { baseUrl, token, tokenPresent: !!token }
}

function firstEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function detectFromKnownConfigFiles(agent: ConfigurableAgent): {
  baseUrl?: string
  token?: string
  tokenPresent: boolean
} {
  const home = os.homedir()
  if (agent === 'pi') {
    const config = loadConfig()
    const token = config.apiKeys?.dashscope?.trim()
    if (token) return { token, tokenPresent: true }
  }

  const candidates = agent === 'codex'
    ? [path.join(home, '.codex', 'config.toml'), path.join(home, '.codex', 'auth.json')]
    : agent === 'claude'
      ? [path.join(home, '.claude', 'settings.json'), path.join(home, '.claude.json')]
      : [path.join(home, '.dashscope', 'config.json')]

  for (const file of candidates) {
    const text = readSmallTextFile(file)
    if (!text) continue
    const token = extractTokenLikeValue(text, agent)
    const baseUrl = extractBaseUrl(text)
    if (token || baseUrl) return { token, baseUrl, tokenPresent: !!token }
  }

  return { tokenPresent: false }
}

function readSmallTextFile(file: string): string | null {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > 1024 * 1024) return null
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

function extractBaseUrl(text: string): string | undefined {
  const match = text.match(/(?:base_url|baseURL|api_url|apiUrl|ANTHROPIC_BASE_URL|OPENAI_BASE_URL|DASHSCOPE_BASE_URL)["'\s:=]+([^"'\s,}]+)/i)
  return match?.[1]?.trim()
}

function extractTokenLikeValue(text: string, agent: ConfigurableAgent): string | undefined {
  const prefix = agent === 'claude' ? 'sk-ant-' : agent === 'pi' ? 'sk-' : 'sk-'
  const direct = text.match(new RegExp(`${prefix.replace(/-/g, '\\-')}[A-Za-z0-9_\\-]{8,}`))
  if (direct?.[0]) return direct[0]
  const keyMatch = text.match(/(?:api[_-]?key|auth[_-]?token|token|dashscope)["'\s:=]+([A-Za-z0-9_\-.]{12,})/i)
  return keyMatch?.[1]?.trim()
}

function toSummary(input: {
  agent: ConfigurableAgent
  source: AgentConfigSummary['source']
  status: AgentConfigStatus
  baseUrl?: string
  token?: string
  tokenPresent: boolean
}): AgentConfigSummary {
  return {
    status: input.status,
    source: input.source,
    tokenPresent: input.tokenPresent,
    ...(input.baseUrl ? { baseUrlHost: formatBaseUrlHost(input.baseUrl) } : {}),
    ...(input.token ? { tokenHint: maskToken(input.token) } : {}),
    updatedAt: new Date().toISOString(),
  }
}

export function maskToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  const suffix = trimmed.slice(-TOKEN_SUFFIX_LENGTH)
  return `••••${suffix}`
}

function formatBaseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl
  } catch {
    return baseUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || baseUrl
  }
}
