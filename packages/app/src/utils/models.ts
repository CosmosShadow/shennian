import { collectMapped } from './runtimeValues'
// @test src/__tests__/model-runtime-values.test.ts
import { normalizeDisplayText } from '../components/headEllipsis'
import type { AgentInfo, AgentType, Machine, ModelInfo } from '@shennian/wire'

/** Accept only a model ID, never stringify a selection object into an identifier. */
export function normalizeModelId(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id || undefined
  }
  return undefined
}

/** Older discovery data may wrap {id,name} in both id and name. Repair on read, not in storage. */
export function normalizeModelInfos(values: unknown): ModelInfo[] {
  if (!Array.isArray(values)) return []
  let changed = false
  const models = collectMapped(values, (value) => {
    if (!value || typeof value !== 'object') { changed = true; return [] }
    const id = normalizeModelId(value.id)
    if (!id) { changed = true; return [] }
    const name = normalizeDisplayText(value.name) || normalizeDisplayText(value.id) || id
    const description = typeof value.description === 'string' ? value.description : undefined
    const supportedReasoningEfforts = value.supportedReasoningEfforts === undefined ? undefined : normalizeReasoningEfforts(value.supportedReasoningEfforts)
    const defaultReasoningEffort = typeof value.defaultReasoningEffort === 'string' ? value.defaultReasoningEffort : undefined
    if (value.id === id && value.name === name && value.description === description &&
      value.supportedReasoningEfforts === supportedReasoningEfforts && value.defaultReasoningEffort === defaultReasoningEffort &&
      (value.isDefault === undefined || typeof value.isDefault === 'boolean')) return [value as ModelInfo]
    changed = true
    return [{ ...value, id, name, description, supportedReasoningEfforts, defaultReasoningEffort,
      ...(value.isDefault === undefined ? {} : { isDefault: value.isDefault === true }) } as ModelInfo]
  })
  return changed ? models : values as ModelInfo[]
}


export function normalizeReasoningEfforts(value: unknown): NonNullable<ModelInfo['supportedReasoningEfforts']> {
  if (!Array.isArray(value)) return []
  let changed = false
  const efforts = collectMapped(value, (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) { changed = true; return [] }
    const name = normalizeDisplayText(item.name) || item.id
    if (typeof item.name === 'string' && item.name === name) return [item]
    changed = true
    return [{ id: item.id, name }]
  })
  return changed ? efforts : value
}

export const INLINE_MODEL_LIMIT = 10

export function shouldUseCollapsedModelSelector(modelCount: number): boolean {
  return modelCount > INLINE_MODEL_LIMIT
}

export function getMachineAgentInfo(machine: Machine | undefined, agentType: AgentType): AgentInfo | undefined {
  return Array.isArray(machine?.agents) ? machine.agents.find((agent) => agent && agent.type === agentType) : undefined
}

export function getMachineAgentModels(machine: Machine | undefined, agentType: AgentType): ModelInfo[] {
  return normalizeModelInfos(getMachineAgentInfo(machine, agentType)?.models)
}

export function isDefaultModel(model: ModelInfo): boolean {
  return model.isDefault === true || model.id === 'default'
}

export function hasDefaultModel(models: ModelInfo[]): boolean {
  return models.some(isDefaultModel)
}

export function isModelSelected(model: ModelInfo, selectedModelId?: string | null): boolean {
  return selectedModelId === model.id || (!selectedModelId && isDefaultModel(model))
}

export function modelSelectionValue(model: ModelInfo): string | null {
  return isDefaultModel(model) ? null : model.id
}

export function supportsReasoningEffort(agentType: AgentType, model: ModelInfo | undefined): boolean {
  return (
    (agentType === 'claude' || agentType === 'codex' || agentType === 'workbuddy') &&
    Boolean(normalizeReasoningEfforts(model?.supportedReasoningEfforts).length)
  )
}

export function resolveReasoningEffort(
  agentType: AgentType,
  model: ModelInfo | undefined,
  preferred?: string | null,
): string | undefined {
  if (!supportsReasoningEffort(agentType, model)) return undefined
  const supported = normalizeReasoningEfforts(model?.supportedReasoningEfforts)
  const preferredEffort = typeof preferred === 'string' ? preferred.trim() : undefined
  if (preferredEffort && supported.some((effort) => effort.id === preferredEffort)) {
    return preferredEffort
  }
  const defaultEffort = typeof model?.defaultReasoningEffort === 'string' ? model.defaultReasoningEffort.trim() : undefined
  if (agentType === 'codex') {
    const isExpensiveDefault =
      defaultEffort === 'ultra' || defaultEffort === 'max' || defaultEffort === 'xhigh'
    if (
      defaultEffort &&
      !isExpensiveDefault &&
      supported.some((effort) => effort.id === defaultEffort)
    ) {
      return defaultEffort
    }
    const safeDefault = ['medium', 'low'].find((effortId) =>
      supported.some((effort) => effort.id === effortId),
    )
    if (safeDefault) return safeDefault
  }
  if (defaultEffort && supported.some((effort) => effort.id === defaultEffort)) {
    return defaultEffort
  }
  return supported[0]?.id
}

export function getDefaultModel(models: ModelInfo[]): ModelInfo | undefined {
  const safe = normalizeModelInfos(models)
  return safe.find((model) => model.isDefault) ?? safe[0]
}

export function findModel(models: ModelInfo[], modelId?: string | null): ModelInfo | undefined {
  if (!modelId) return undefined
  return normalizeModelInfos(models).find((model) => model.id === normalizeModelId(modelId))
}

export function resolveModel(models: ModelInfo[], modelId?: string | null): ModelInfo | undefined {
  return findModel(models, modelId) ?? getDefaultModel(models)
}

export function resolveModelId(models: ModelInfo[], preferredModelId?: string | null): string | undefined {
  return resolveModel(models, preferredModelId)?.id
}

export function getModelDisplayName(models: ModelInfo[], modelId?: string | null): string | undefined {
  return resolveModel(models, modelId)?.name ?? (normalizeDisplayText(modelId) || undefined)
}

export function buildAgentModelLabel(agentLabel: string, modelName?: string): string {
  if (!modelName) return agentLabel
  const normalizedAgent = agentLabel.trim().toLowerCase()
  const normalizedModel = modelName.trim().toLowerCase()
  if (normalizedModel.includes(normalizedAgent)) {
    return modelName
  }
  return `${agentLabel} ${modelName}`
}
