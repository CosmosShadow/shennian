// @covers packages/app/src/features/machines/components/LaunchModelSelector.tsx
// @covers packages/app/src/components/chat/ModelSelectorSheet.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hasDefaultModel,
  INLINE_MODEL_LIMIT,
  isModelSelected,
  modelSelectionValue,
  shouldUseCollapsedModelSelector,
} from '../utils/models'

function readSource(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf-8')
}

describe('launch model selector', () => {
  it('keeps up to ten models inline and collapses larger lists', () => {
    expect(INLINE_MODEL_LIMIT).toBe(10)
    expect(shouldUseCollapsedModelSelector(10)).toBe(false)
    expect(shouldUseCollapsedModelSelector(11)).toBe(true)
  })

  it('uses one logical default option while preserving null storage compatibility', () => {
    const models = [
      { id: 'default', name: 'Default (recommended)', isDefault: true },
      { id: 'fable', name: 'Fable' },
    ]
    expect(hasDefaultModel(models)).toBe(true)
    expect(isModelSelected(models[0]!, null)).toBe(true)
    expect(modelSelectionValue(models[0]!)).toBeNull()
    expect(modelSelectionValue(models[1]!)).toBe('fable')
  })

  it('uses the shared searchable selector in launch and managed-agent surfaces', () => {
    const projectScreen = readSource('../features/projects/screens/ProjectScreen.tsx')
    const projectLaunchSheet = readSource('../components/sheets/ProjectLaunchSheet.tsx')
    const agentWorkspaceForm = readSource('../features/agents/AgentWorkspaceForm.tsx')
    const launchSelector = readSource('../features/machines/components/LaunchModelSelector.tsx')
    const selector = readSource('../components/chat/ModelSelectorSheet.tsx')

    expect(projectScreen).toContain('<LaunchModelSelector')
    expect(projectLaunchSheet).toContain('<LaunchModelSelector')
    expect(agentWorkspaceForm).toContain('<LaunchModelSelector')
    expect(agentWorkspaceForm).toContain('allowDefaultSelection')
    expect(launchSelector).toContain('models.length !== 1')
    expect(launchSelector).toContain('selectableModels.length !== 1')
    expect(launchSelector).toContain('(onSelectModel as (modelId: string | null) => void)(value)')
    expect(launchSelector).toContain('shouldUseCollapsedModelSelector(selectableModels.length)')
    expect(launchSelector).toContain('modelSelectionValue(model)')
    expect(selector).toContain("t('model_selector_recent')")
    expect(selector).toContain("t('model_selector_all')")
    expect(selector).toContain("t('model_selector_search')")
  })
})
