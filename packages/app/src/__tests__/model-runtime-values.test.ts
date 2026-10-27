// @covers ../utils/models.ts
// @covers ../components/headEllipsis.ts
import { describe, expect, it } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Machine, ModelInfo } from '@shennian/wire'
import { getMachineAgentModels, getModelDisplayName, normalizeModelId, normalizeModelInfos, resolveModel } from '../utils/models'
import { resolveHeadEllipsisText } from '../components/headEllipsis'

const selection = { id: 'deepseek-chat', name: 'DeepSeek Chat' }
// Shape emitted by the old custom discovery's {id, name: id} mapping when id is an object.
const polluted = [{ id: selection, name: selection, isDefault: false }] as unknown as ModelInfo[]

describe('model runtime values at conversation entry', () => {
  it('reproduces both the detail summary symptom and original native Text crash', () => {
    expect(['Dsh', polluted[0]!.name].join(' · ')).toContain('[object Object]')
    expect(() => renderToStaticMarkup(createElement('span', null, polluted[0]!.name as ReactNode)))
      .toThrow('Objects are not valid as a React child')
  })

  it('repairs cached machine models on read and uses string IDs for model selection', () => {
    const machine = { agents: [{ type: 'custom:dsh', models: polluted }] } as unknown as Machine
    const models = getMachineAgentModels(machine, 'custom:dsh')
    expect(models).toEqual([{ id: 'deepseek-chat', name: 'DeepSeek Chat', isDefault: false }])
    expect(normalizeModelId(selection)).toBe('deepseek-chat')
    expect(resolveModel(models, selection as unknown as string)?.id).toBe('deepseek-chat')
    expect(getModelDisplayName(polluted, selection as unknown as string)).toBe('DeepSeek Chat')
    expect(['Dsh', getModelDisplayName(models)].join(' · ')).toBe('Dsh · DeepSeek Chat')
    expect(renderToStaticMarkup(createElement('span', null, resolveHeadEllipsisText(models[0]!.name, 'ios').text)))
      .toBe('<span>DeepSeek Chat</span>')
    expect(polluted[0]!.id).toBe(selection) // no storage mutation
  })

  it('filters invalid IDs and retains valid metadata and string models', () => {
    const model = { id: 'model-a', name: 'Model A', isDefault: true,
      supportedReasoningEfforts: [{ id: 'low', name: 'Low' }] }
    const validModels = [model]
    expect(normalizeModelInfos(validModels)).toBe(validModels)
    expect(normalizeModelInfos([null, {}, { id: {} }, model])).toEqual([model])
    expect(normalizeModelId({ name: 'Not an ID' })).toBeUndefined()
    expect(getModelDisplayName([], selection as unknown as string)).toBe('DeepSeek Chat')
    expect(normalizeModelInfos([{ id: 'fallback', name: null }])).toEqual([{ id: 'fallback', name: 'fallback' }])
  })
})

describe('malformed optional model metadata', () => {
  it('filters invalid reasoning entries and does not pass object descriptions to Text', () => {
    const models = normalizeModelInfos([{ id: 'model', name: 'Model', description: { bad: true },
      isDefault: {}, defaultReasoningEffort: {}, supportedReasoningEfforts: [null, {}, { id: 'low', name: { id: 'low', name: 'Low' } }] }])
    expect(models[0]?.description).toBeUndefined()
    expect(models[0]?.isDefault).toBe(false)
    expect(models[0]?.defaultReasoningEffort).toBeUndefined()
    expect(models[0]?.supportedReasoningEfforts).toEqual([{ id: 'low', name: 'Low' }])
  })
  it('does not trust a machine agents field to be an array', () => {
    expect(getMachineAgentModels({ agents: {} } as Machine, 'codex')).toEqual([])
    expect(getMachineAgentModels({ agents: [null] } as unknown as Machine, 'codex')).toEqual([])
  })
})
