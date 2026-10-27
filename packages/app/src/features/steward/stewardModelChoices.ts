// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-model-choices.test.ts
import type { ModelInfo } from '@shennian/wire'

/** A default flag describes a concrete model, not a follow-default choice. */
export function stewardModelChoices(models: readonly ModelInfo[]) {
  const explicitModels = models.filter((model) => model.id !== 'default')
  const defaultModel = explicitModels.find((model) => model.isDefault)
  return { explicitModels, defaultModel }
}
