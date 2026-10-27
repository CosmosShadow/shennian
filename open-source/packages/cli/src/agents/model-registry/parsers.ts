// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts

import type { ModelInfo } from '@shennian/wire'

export function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '') // eslint-disable-line no-control-regex
    .replace(/\u001b\][^\u0007]*\u0007/g, '') // eslint-disable-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '') // eslint-disable-line no-control-regex
}

function uniqueModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>()
  const unique: ModelInfo[] = []
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    unique.push(model)
  }
  return unique
}

function titleCaseSegment(segment: string): string {
  if (!segment) return segment
  return segment[0]!.toUpperCase() + segment.slice(1)
}

function prettifyCodexModel(id: string): string {
  return id
    .split('-')
    .map((segment) => {
      if (segment === 'gpt') return 'GPT'
      if (segment === 'codex') return 'Codex'
      return /^\d/.test(segment) ? segment : titleCaseSegment(segment)
    })
    .join('-')
}

function prettifyReasoningEffort(id: string): string {
  switch (id) {
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    case 'xhigh':
      return 'Extra High'
    default:
      return titleCaseSegment(id)
  }
}

const CODEX_REASONING_EFFORTS: NonNullable<ModelInfo['supportedReasoningEfforts']> = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'Extra High' },
  { id: 'max', name: 'Max' },
  { id: 'ultra', name: 'Ultra' },
]

const LATEST_CODEX_MODELS: readonly ModelInfo[] = [
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    description: 'Most capable Codex model for complex, demanding work.',
    provider: 'openai',
    supportedReasoningEfforts: CODEX_REASONING_EFFORTS,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    description: 'Reliable agentic workhorse for everyday tasks.',
    provider: 'openai',
    supportedReasoningEfforts: CODEX_REASONING_EFFORTS,
    defaultReasoningEffort: 'low',
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    description: 'Balanced agentic coding model for everyday work.',
    provider: 'openai',
    supportedReasoningEfforts: CODEX_REASONING_EFFORTS,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    description: 'Fast and affordable agentic coding model.',
    provider: 'openai',
    supportedReasoningEfforts: CODEX_REASONING_EFFORTS.filter((effort) => effort.id !== 'ultra'),
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'Proven previous-generation model for coding and general work.',
    provider: 'openai',
    supportedReasoningEfforts: CODEX_REASONING_EFFORTS.filter(
      (effort) => effort.id !== 'max' && effort.id !== 'ultra',
    ),
    defaultReasoningEffort: 'medium',
  },
]

function cloneModel(model: ModelInfo): ModelInfo {
  const cloned: ModelInfo = {
    ...model,
  }
  if (model.supportedReasoningEfforts) {
    cloned.supportedReasoningEfforts = model.supportedReasoningEfforts.map((effort) => ({
      ...effort,
    }))
  }
  if (model.additionalSpeedTiers) {
    cloned.additionalSpeedTiers = [...model.additionalSpeedTiers]
  }
  return cloned
}

function includeLatestCodexModels(models: ModelInfo[], currentModel?: string): ModelInfo[] {
  const selectedDefault = currentModel ?? models.find((model) => model.isDefault)?.id
  const withLatest = uniqueModels([
    ...models.map(cloneModel),
    ...LATEST_CODEX_MODELS.map((model) => cloneModel(model)),
  ])

  if (!selectedDefault) return withLatest
  return withLatest.map((model) => ({
    ...model,
    isDefault: model.id === selectedDefault,
  }))
}

export function fallbackCodexModels(): ModelInfo[] {
  return LATEST_CODEX_MODELS.map((model, index) => ({
    ...cloneModel(model),
    ...(index === 0 ? { isDefault: true } : {}),
  }))
}

export function fallbackWorkBuddyModels(): ModelInfo[] {
  return [{
    id: 'auto',
    name: 'Auto',
    provider: 'workbuddy',
    isDefault: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({
      id,
      name: prettifyReasoningEffort(id),
    })),
    defaultReasoningEffort: 'medium',
  }]
}

function prettifyCursorModel(id: string): string {
  return id
    .split('-')
    .map((segment) => (/^\d/.test(segment) ? segment : titleCaseSegment(segment)))
    .join(' ')
}

function buildGeminiId(version: string, flavor: string, preview = false): string {
  const normalizedFlavor = flavor.toLowerCase().replace(/\s+/g, '-')
  return `gemini-${version}-${normalizedFlavor}${preview ? '-preview' : ''}`
}

export function parseCursorModels(raw: string): ModelInfo[] {
  const models: ModelInfo[] = []
  const clean = stripAnsi(raw)
  for (const line of clean.split('\n')) {
    const match = line.trim().match(/^(\S+)\s+-\s+(.+?)(?:\s+\(([^)]+)\))?$/)
    if (!match) continue
    const [, id, name, flags] = match
    const tags = flags?.split(',').map((flag) => flag.trim().toLowerCase()) ?? []
    models.push({
      id,
      name: name.trim() || prettifyCursorModel(id),
      description: flags?.trim(),
      isDefault: tags.includes('default') || tags.includes('current'),
    })
  }
  return uniqueModels(models)
}

export function parseOpenClawModels(raw: string): ModelInfo[] {
  try {
    const data = JSON.parse(raw) as {
      models?: Array<{ key: string; name?: string; available?: boolean; tags?: string[] }>
    }
    const models = (data.models ?? [])
      .filter((model) => model.available)
      .map((model) => ({
        id: model.key,
        name: model.name?.trim() || model.key,
        provider: model.key.split('/')[0],
        description: model.tags?.join(', '),
        isDefault: model.tags?.includes('default') ?? false,
      }))
    return uniqueModels(models)
  } catch {
    return []
  }
}

export function parseOpenCodeModels(raw: string): ModelInfo[] {
  const models = stripAnsi(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes(' '))
    .map((id) => ({
      id,
      name: id,
      provider: id.includes('/') ? id.split('/')[0] : undefined,
    }))
  return uniqueModels(models)
}

export function parseOpenCodeProviderModels(providerResponse: unknown, configResponse: unknown): ModelInfo[] {
  if (!providerResponse || typeof providerResponse !== 'object') return []
  const response = providerResponse as { all?: unknown; connected?: unknown }
  if (!Array.isArray(response.all) || !Array.isArray(response.connected)) return []
  const connected = new Set(response.connected.filter((id): id is string => typeof id === 'string'))
  const config = configResponse && typeof configResponse === 'object'
    ? configResponse as { model?: unknown; provider?: unknown }
    : {}
  const selectedId = typeof config.model === 'string' ? config.model : ''
  const configuredProviders = config.provider && typeof config.provider === 'object'
    ? config.provider as Record<string, unknown>
    : {}
  const configuredModelIds = new Set<string>()
  for (const [providerId, value] of Object.entries(configuredProviders)) {
    if (!value || typeof value !== 'object') continue
    const models = (value as { models?: unknown }).models
    if (!models || typeof models !== 'object') continue
    for (const modelId of Object.keys(models)) configuredModelIds.add(`${providerId}/${modelId}`)
  }

  const models: ModelInfo[] = []
  for (const value of response.all) {
    if (!value || typeof value !== 'object') continue
    const provider = value as { id?: unknown; models?: unknown }
    if (typeof provider.id !== 'string' || !connected.has(provider.id)) continue
    if (!provider.models || typeof provider.models !== 'object') continue
    for (const [modelKey, rawModel] of Object.entries(provider.models)) {
      if (!rawModel || typeof rawModel !== 'object') continue
      const item = rawModel as {
        id?: unknown; name?: unknown; status?: unknown
        capabilities?: { input?: { text?: unknown }; output?: { text?: unknown }; toolcall?: unknown }
      }
      if (item.status === 'deprecated' || item.status === 'unavailable') continue
      // A chat Agent cannot run image, audio, realtime, or embedding-only models.
      if (item.capabilities?.input?.text === false || item.capabilities?.output?.text === false ||
          item.capabilities?.toolcall === false) continue
      const modelId = typeof item.id === 'string' && item.id ? item.id : modelKey
      const id = `${provider.id}/${modelId}`
      models.push({
        id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name : id,
        provider: provider.id,
        ...(id === selectedId ? { isDefault: true } : {}),
      })
    }
  }
  return uniqueModels(models).sort((a, b) => {
    const rank = (model: ModelInfo) => model.id === selectedId ? 0
      : configuredModelIds.has(model.id) ? 1
      : model.provider && Object.hasOwn(configuredProviders, model.provider) ? 2 : 3
    return rank(a) - rank(b) || a.id.localeCompare(b.id)
  })
}

export function parseClaudeModels(raw: string): ModelInfo[] {
  const rawClean = stripAnsi(raw).replace(/\s+/g, ' ')
  const patterns: ReadonlyArray<readonly [RegExp, string, string, string?]> = [
    [
      /\d+\.Default\(recommended\).*?(?:Sonnet|currently\s*Sonnet)\s*([\d.]+)/i,
      'default',
      'Default (recommended)',
    ],
    [/\d+\.Best.*?Opus\s*([\d.]+)/i, 'best', 'Best', 'Most capable available model'],
    [/\d+\.Fable.*?Fable\s*([\d.]+)/i, 'fable', 'Fable', 'Most capable for the hardest, longest-running tasks'],
    [/\d+\.Opus\(1Mcontext\).*?Opus\s*([\d.]+)/i, 'opus[1m]', 'Opus (1M context)'],
    [/\d+\.OpusPlan.*?Opus\s*([\d.]+)/i, 'opusplan', 'Opus Plan', 'Opus for planning · Sonnet for execution'],
    [/\d+\.Opus(?!\(1Mcontext\)).*?Opus\s*([\d.]+)/i, 'opus', 'Opus'],
    [/\d+\.Sonnet\(1Mcontext\).*?Sonnet\s*([\d.]+)/i, 'sonnet[1m]', 'Sonnet (1M context)'],
    [/\d+\.Sonnet(?!\(1Mcontext\)).*?Sonnet\s*([\d.]+)/i, 'sonnet', 'Sonnet'],
    [/\d+\.Haiku.*?Haiku\s*([\d.]+)/i, 'haiku', 'Haiku'],
  ]
  const models: ModelInfo[] = []
  for (const [pattern, id, name, detail] of patterns) {
    const match = rawClean.match(pattern)
    if (match) {
      models.push(withClaudeReasoningEfforts({
        id,
        name,
        description: detail ? `${detail} · v${match[1]}` : `v${match[1]}`,
        provider: 'anthropic',
        isDefault: id === 'default',
      }))
    }
  }
  if (models.length > 0) return uniqueModels(models)

  const fallback: ModelInfo[] = []
  const defaultMatch = rawClean.match(/currently\s*(Sonnet|Opus|Haiku)\s*([34](?:\.\d)?)/i)
  const aliasMap: Record<string, string> = { sonnet: 'sonnet', opus: 'opus', haiku: 'haiku' }
  for (const match of rawClean.matchAll(/\b(Sonnet|Opus|Haiku)\s*([34](?:\.\d)?)\b/gi)) {
    const family = (match[1] ?? '').toLowerCase()
    const alias = aliasMap[family]
    if (!alias) continue
    const version = match[2] ?? ''
    const isDefault =
      defaultMatch && defaultMatch[1]?.toLowerCase() === family && defaultMatch[2] === version
    fallback.push(withClaudeReasoningEfforts({
      id: alias,
      name: `${titleCaseSegment(family)} ${version}`,
      provider: 'anthropic',
      isDefault: Boolean(isDefault),
    }))
  }
  return uniqueModels(fallback)
}

function compareVersionNumbers(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const left = a[index] ?? -1
    const right = b[index] ?? -1
    if (left === right) continue
    return left - right
  }
  return 0
}

function extractClaudeFamilyVersion(id: string, family: string): number[] | null {
  const match = id.match(new RegExp(`^claude-${family}-([0-9]+(?:-[0-9]+)*)$`, 'i'))
  if (!match?.[1]) return null
  const parts = match[1]
    .split('-')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))
  if (parts.length === 0 || parts.length > 2) return null
  return parts
}

function formatClaudeVersion(version: number[] | null): string | undefined {
  if (!version?.length) return undefined
  return `v${version.join('.')}`
}

type ClaudeAlias = 'default' | 'sonnet' | 'opus' | 'haiku'
export type EnvLike = Record<string, string | undefined>

const CLAUDE_ALIAS_LABELS: Record<ClaudeAlias, string> = {
  default: 'Default (recommended)',
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku',
}

const CLAUDE_ALIAS_MODEL_ENV: Record<ClaudeAlias, string> = {
  default: 'ANTHROPIC_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
}

const CLAUDE_DEEPSEEK_REASONING_EFFORTS = [
  { id: 'max', name: 'Max' },
] satisfies NonNullable<ModelInfo['supportedReasoningEfforts']>

const CLAUDE_REASONING_EFFORTS = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'Extra High' },
  { id: 'max', name: 'Max' },
] satisfies NonNullable<ModelInfo['supportedReasoningEfforts']>

function withClaudeReasoningEfforts(model: ModelInfo): ModelInfo {
  return {
    ...model,
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: 'medium',
  }
}

export function readEnvValue(env: EnvLike, key: string): string | null {
  const value = env[key]?.trim()
  return value || null
}

export function inferClaudeOverrideProvider(modelName: string, env: EnvLike): string {
  const baseUrl = readEnvValue(env, 'ANTHROPIC_BASE_URL')?.toLowerCase() ?? ''
  if (baseUrl.includes('deepseek.com') || modelName.toLowerCase().startsWith('deepseek-')) {
    return 'deepseek'
  }
  return baseUrl ? 'custom' : 'anthropic'
}

function configuredClaudeAliasModels(env: EnvLike): ModelInfo[] {
  const configured = new Set<string>()
  for (const key of Object.values(CLAUDE_ALIAS_MODEL_ENV)) {
    const modelName = readEnvValue(env, key)
    if (modelName) configured.add(modelName)
  }

  const models = Array.from(configured).map((modelName, index) => {
    const provider = inferClaudeOverrideProvider(modelName, env)
    const model: ModelInfo = {
      id: modelName,
      name: modelName,
      provider,
      isDefault: index === 0,
    }
    if (provider === 'deepseek') {
      return {
        ...model,
        supportedReasoningEfforts: CLAUDE_DEEPSEEK_REASONING_EFFORTS,
        defaultReasoningEffort: readEnvValue(env, 'CLAUDE_CODE_EFFORT_LEVEL') ?? 'max',
      }
    }
    return withClaudeReasoningEfforts(model)
  })

  return uniqueModels(models)
}

export function discoverClaudeAliasModelsFromEnv(env: EnvLike = process.env): ModelInfo[] {
  return configuredClaudeAliasModels(env)
}

export function applyClaudeModelEnvOverrides(
  models: ModelInfo[],
  env: EnvLike = process.env,
): ModelInfo[] {
  return models.map((model) => {
    if (!['default', 'sonnet', 'opus', 'haiku'].includes(model.id)) return model

    const alias = model.id as ClaudeAlias
    const configuredModel = readEnvValue(env, CLAUDE_ALIAS_MODEL_ENV[alias])
    if (!configuredModel) return model

    const aliasLabel = CLAUDE_ALIAS_LABELS[alias]
    const aliasDescription = `Claude Code alias: ${aliasLabel}`
    return {
      ...model,
      name: configuredModel,
      description: model.description
        ? `${aliasDescription} · ${model.description}`
        : aliasDescription,
      provider: inferClaudeOverrideProvider(configuredModel, env),
    }
  })
}

export function parseClaudeBinaryModels(raw: string): ModelInfo[] {
  const clean = stripAnsi(raw)
  const familyVersions = new Map<'sonnet' | 'opus' | 'haiku', number[]>()

  for (const family of ['sonnet', 'opus', 'haiku'] as const) {
    for (const match of clean.matchAll(new RegExp(`\\bclaude-${family}-[0-9.-]+\\b`, 'gi'))) {
      const normalized = match[0]!.trim().toLowerCase().replace(/\./g, '-').replace(/-+$/g, '')
      const version = extractClaudeFamilyVersion(normalized, family)
      if (!version) continue
      const current = familyVersions.get(family)
      if (!current || compareVersionNumbers(current, version) < 0) {
        familyVersions.set(family, version)
      }
    }
  }

  const models: ModelInfo[] = []
  for (const alias of ['default', 'sonnet', 'opus', 'haiku'] as const) {
    if (!new RegExp(`\\b${alias}\\b`, 'i').test(clean)) continue
    const version =
      (alias === 'default' ? familyVersions.get('sonnet') : familyVersions.get(alias)) ?? null
    models.push(withClaudeReasoningEfforts({
      id: alias,
      name: CLAUDE_ALIAS_LABELS[alias],
      description: formatClaudeVersion(version),
      provider: 'anthropic',
      isDefault: alias === 'default',
    }))
  }

  return uniqueModels(models)
}

export function fallbackClaudeAliasModels(env: EnvLike = process.env): ModelInfo[] {
  const configuredModels = configuredClaudeAliasModels(env)
  if (configuredModels.length > 0) return configuredModels

  return applyClaudeModelEnvOverrides([
    { id: 'default', name: 'Default (recommended)', description: 'Recommended model for your account', provider: 'anthropic', isDefault: true },
    { id: 'sonnet', name: 'Sonnet', description: 'Latest Sonnet · everyday coding', provider: 'anthropic' },
    { id: 'fable', name: 'Fable', description: 'Most capable for the hardest, longest-running tasks', provider: 'anthropic' },
    { id: 'opus', name: 'Opus', description: 'Latest Opus · complex reasoning', provider: 'anthropic' },
    { id: 'haiku', name: 'Haiku', description: 'Fast and efficient · simple tasks', provider: 'anthropic' },
    { id: 'best', name: 'Best', description: 'Most capable available model', provider: 'anthropic' },
    { id: 'opus[1m]', name: 'Opus (1M context)', description: 'Latest Opus · long sessions', provider: 'anthropic' },
    { id: 'sonnet[1m]', name: 'Sonnet (1M context)', description: 'Latest Sonnet · long sessions', provider: 'anthropic' },
    { id: 'opusplan', name: 'Opus Plan', description: 'Opus for planning · Sonnet for execution', provider: 'anthropic' },
  ], env).map((model) => model.id === 'haiku' ? model : withClaudeReasoningEfforts(model))
}

export function parseCodexModels(raw: string): ModelInfo[] {
  const clean = stripAnsi(raw)
  const models: ModelInfo[] = []

  for (const line of clean.split('\n')) {
    const match = line.match(/\b(gpt-[a-z0-9][a-z0-9.-]*)\b/i)
    if (!match) continue
    const id = match[1]!.trim()
    const description =
      line
        .replace(id, '')
        .replace(/^[^\w]+/, '')
        .trim() || undefined
    models.push({
      id,
      name: prettifyCodexModel(id),
      description,
      provider: 'openai',
      isDefault: /\bcurrent\b/i.test(line) || /\bselected\b/i.test(line),
    })
  }

  return uniqueModels(models)
}

export function parseCodexAppServerModels(raw: unknown): ModelInfo[] {
  const data =
    typeof raw === 'object' && raw !== null
      ? (raw as {
          data?: unknown[]
          config?: { model?: unknown; model_reasoning_effort?: unknown }
        })
      : {}
  const currentModel = typeof data.config?.model === 'string' ? data.config.model : undefined
  const currentReasoningEffort =
    typeof data.config?.model_reasoning_effort === 'string'
      ? data.config.model_reasoning_effort
      : undefined
  const models: ModelInfo[] = []

  for (const entry of data.data ?? []) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const id =
      typeof item.id === 'string' ? item.id : typeof item.model === 'string' ? item.model : ''
    if (!id) continue
    const displayName =
      typeof item.displayName === 'string'
        ? item.displayName
        : typeof item.name === 'string'
          ? item.name
          : undefined
    const description = typeof item.description === 'string' ? item.description : undefined
    const defaultReasoningEffort =
      typeof item.defaultReasoningEffort === 'string' ? item.defaultReasoningEffort : undefined
    const supportedReasoningEfforts = Array.isArray(item.supportedReasoningEfforts)
      ? item.supportedReasoningEfforts
          .map((effort) => {
            if (typeof effort !== 'object' || effort === null) return null
            const rawEffort = effort as Record<string, unknown>
            const effortId =
              typeof rawEffort.reasoningEffort === 'string'
                ? rawEffort.reasoningEffort
                : typeof rawEffort.id === 'string'
                  ? rawEffort.id
                  : ''
            if (!effortId) return null
            return {
              id: effortId,
              name: prettifyReasoningEffort(effortId),
              description:
                typeof rawEffort.description === 'string' ? rawEffort.description : undefined,
            }
          })
          .filter((effort): effort is NonNullable<typeof effort> => effort != null)
      : undefined
    const additionalSpeedTiers = Array.isArray(item.additionalSpeedTiers)
      ? item.additionalSpeedTiers.filter((tier): tier is string => typeof tier === 'string')
      : undefined

    models.push({
      id,
      name: displayName || prettifyCodexModel(id),
      description,
      provider: 'openai',
      isDefault: currentModel ? currentModel === id : item.isDefault === true,
      supportedReasoningEfforts,
      defaultReasoningEffort,
      additionalSpeedTiers,
    })
  }

  if (currentModel && !models.some((model) => model.id === currentModel)) {
    models.unshift({
      id: currentModel,
      name: prettifyCodexModel(currentModel),
      provider: 'openai',
      isDefault: true,
      defaultReasoningEffort: currentReasoningEffort,
    })
  }

  return includeLatestCodexModels(uniqueModels(models), currentModel)
}

export function parseGeminiModels(raw: string): ModelInfo[] {
  const clean = stripAnsi(raw)
  const models: ModelInfo[] = []

  for (const match of clean.matchAll(/\b(?:auto-)?gemini-[a-z0-9.-]+\b/gi)) {
    const id = match[0]!.trim()
    models.push({
      id,
      name: id,
      provider: 'google',
      isDefault: /\bcurrent\b/i.test(clean) && clean.includes(id),
    })
  }

  for (const match of clean.matchAll(
    /\bGemini\s*(\d(?:\.\d)?)\s*(Pro|Flash(?:[- ]Lite)?)\s*(Preview)?\b/gi,
  )) {
    const version = match[1] ?? ''
    const flavor = (match[2] ?? '').replace(/\s+/g, '-')
    const preview = Boolean(match[3])
    const id = buildGeminiId(version, flavor, preview)
    models.push({
      id,
      name: `Gemini ${version} ${flavor.replace(/-/g, ' ')}`.trim(),
      provider: 'google',
      isDefault: /\bcurrent\b/i.test(clean) && clean.includes(match[0] ?? ''),
    })
  }

  for (const match of clean.matchAll(/\bAuto\s*Gemini\s*(\d(?:\.\d)?)\b/gi)) {
    const version = match[1] ?? ''
    const id = `auto-gemini-${version}`
    models.push({
      id,
      name: `Auto Gemini ${version}`,
      provider: 'google',
      isDefault: /\bcurrent\b/i.test(clean) && clean.includes(match[0] ?? ''),
    })
  }

  return uniqueModels(models)
}

export function fallbackGeminiModels(): ModelInfo[] {
  return [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', isDefault: true },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
    { id: 'auto-gemini-2.5', name: 'Auto Gemini 2.5', provider: 'google' },
  ]
}
