// @covers src/features/machines/utils/setupClipboard.ts
// @covers src/features/machines/utils/agentPreparation.ts
import { describe, expect, it, vi } from 'vitest'
import { copySetupText } from '../features/machines/utils/setupClipboard'
import { getAgentPreparationLinks, needsWindowsCodexHint } from '../features/machines/utils/agentPreparation'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
import en from '../../../../open-source/packages/shared/src/i18n/en'

describe('AI preparation instructions', () => {
  it('copies the complete instruction and waits for an affirmative clipboard result', async () => {
    let finish!: (value: boolean) => void
    const write = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const text = 'Install on the target computer.\nKeep my current task.'
    const result = copySetupText(text, write)
    expect(write).toHaveBeenCalledExactlyOnceWith(text)
    finish(true)
    expect(await result).toBe('copied')
  })
  it.each(['false','rejection'])('shows a failure on %s and permits a retry', async failure => {
    const write = vi.fn().mockImplementationOnce(async () => { if (failure === 'rejection') throw new Error('denied'); return false }).mockResolvedValue(true)
    expect(await copySetupText('instructions', write)).toBe('failed')
    expect(await copySetupText('instructions', write)).toBe('copied')
  })
  it('uses official per-provider guides, including the catalog aliases', () => {
    expect(getAgentPreparationLinks('builtin:codex')).toEqual(getAgentPreparationLinks('catalog:codex-acp'))
    expect(getAgentPreparationLinks('claude')?.command).toBe('claude auth login')
    expect(getAgentPreparationLinks('codex')?.command).toBe('codex login')
    expect(new URL(getAgentPreparationLinks('claude')!.install).hostname).toBe('code.claude.com')
    expect(getAgentPreparationLinks('custom:unknown')).toBeNull()
  })
  it('explains a missing Windows Codex only where the WSL fallback no longer applies', () => {
    expect(needsWindowsCodexHint('Windows 11', 'codex', 'missing')).toBe(true)
    expect(needsWindowsCodexHint('win32', 'builtin:codex', 'missing')).toBe(true)
    expect(needsWindowsCodexHint('macOS 15', 'codex', 'missing')).toBe(false)
    expect(needsWindowsCodexHint('Windows 11', 'claude', 'missing')).toBe(false)
    expect(needsWindowsCodexHint('Windows 11', 'codex', 'login')).toBe(false)
    for (const locale of [zh, en]) {
      expect(locale.ai_setup_codex_windows).toContain('SHENNIAN_CODEX_PATH')
      expect(locale.ai_setup_codex_wsl).toBeTruthy()
    }
  })
  it('gives both languages a manual path and does not equate sign-in with a working model', () => {
    for (const locale of [zh,en]) {
      expect(locale.ai_setup_entry).toBeTruthy()
      expect(locale.ai_setup_step_install).toBeTruthy()
      expect(locale.ai_setup_step_login).toBeTruthy()
      expect(locale.ai_setup_first_task).toBeTruthy()
      expect(locale.ai_setup_check_failed).toBeTruthy()
      expect(locale.ai_setup_prompt).toContain('{{machine}}')
    }
  })
})
