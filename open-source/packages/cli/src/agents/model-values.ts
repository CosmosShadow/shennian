// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-detect.test.ts
import type { ModelInfo } from '@shennian/wire'

/** Check persisted/custom runtime values before advertising the string-only wire model fields. */
export function normalizeAgentModels(values: unknown, defaultModel: unknown): ModelInfo[] {
  if (!Array.isArray(values)) return []
  const defaultId = modelId(defaultModel)
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const id = modelId(value)
    if (!id || seen.has(id)) return []
    seen.add(id)
    const name = value && typeof value === 'object' && typeof value.name === 'string'
      && value.name.trim() ? value.name : id
    return [{ id, name, isDefault: id === defaultId }]
  })
}

function modelId(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id.trim() ? value.id : undefined
  }
  return undefined
}
