// @arch docs/architecture/cli/model-discovery.md
// @covers packages/app/src/utils/composerActions.ts

import { describe, expect, it } from 'vitest'
import en from '../../../../open-source/packages/shared/src/i18n/en'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
import { getComposerActionIds } from '../utils/composerActions'

describe('getComposerActionIds', () => {
  it('uses a single plus entry on native so secondary tools can be progressively disclosed', () => {
    expect(getComposerActionIds('native', true)).toEqual(['plus', 'model'])
  })

  it('uses a single plus entry on web so desktop can open a lightweight popover', () => {
    expect(getComposerActionIds('web', true)).toEqual(['plus', 'model'])
  })

  it('omits the model trigger when the machine has no model list', () => {
    expect(getComposerActionIds('native', false)).toEqual(['plus'])
    expect(getComposerActionIds('web', false)).toEqual(['plus'])
  })
})

// @arch docs/features/codex-conversation-settings.md
it('provides matching Chinese and English labels for Codex conversation settings', () => {
  const keys = Object.keys(zh).filter((key) => key.startsWith('codex_') || key.startsWith('conversation_settings_'))
  for (const key of keys) expect((en as Record<string, string>)[key]).toBeTruthy()
  expect(zh.codex_home_locked_hint).toContain('新建对话')
  expect(en['codex_sandbox_read-only']).toBe('Read only')
})
