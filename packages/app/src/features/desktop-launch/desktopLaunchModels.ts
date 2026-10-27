// @arch docs/features/desktop-personal-session-navigation.md
// @test ../../__tests__/desktop-launch-choices.test.ts

import type { ModelInfo } from '@shennian/wire'
import { hasDefaultModel, isModelSelected } from '../../utils/models'

const IMPLICIT_DEFAULT_MODEL_ID = '__desktop_implicit_default__'

/** An unavailable configured value must not make every radio unreachable by Tab. */
export function desktopModelTabStopIndex(models: ModelInfo[], selected: string | null): number {
  if (!models.length) return -1
  const index = models.findIndex(model => isModelSelected(model, selected))
  return index < 0 ? 0 : index
}

export function buildDesktopLaunchModelOptions(models: ModelInfo[], defaultLabel: string): ModelInfo[] {
  if (models.length === 1 || hasDefaultModel(models)) return models
  return [{ id: IMPLICIT_DEFAULT_MODEL_ID, name: defaultLabel, isDefault: true }, ...models]
}

export function nextDesktopLaunchChoiceIndex(key: string, current: number, count: number): number | null {
  if (count < 1 || current < 0 || current >= count) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count
  return null
}
