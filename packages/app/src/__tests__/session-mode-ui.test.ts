// @covers packages/app/src/features/machines/components/SessionModeSelector.tsx
// @covers packages/app/src/features/machines/components/AdvancedSessionSettings.tsx
// @covers packages/app/src/features/machines/hooks/useMachineLaunchState.ts
// @covers packages/app/src/features/machines/utils/sessionLaunchPayload.ts
// @covers packages/app/src/features/machines/components/sessionModeChoice.ts
// @covers packages/app/src/features/agents/confirmChoice.ts
// @covers packages/app/src/features/agents/AgentWorkspaceForm.tsx
// @covers packages/app/src/features/desktop-agents/DesktopAgentWorkspaceForm.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enCorePart3 } from '../../../../open-source/packages/shared/src/i18n/en-core-part-3'
import { zhCorePart3 } from '../../../../open-source/packages/shared/src/i18n/zh-core-part-3'
import { buildSessionLaunchPayload } from '../features/machines/utils/sessionLaunchPayload'

const platform = vi.hoisted(() => ({ OS: 'ios' as string }))
const alert = vi.hoisted(() => ({ alert: vi.fn() }))
vi.mock('react-native', () => ({ Platform: platform, Alert: alert }))

import { confirmChoice } from '../features/agents/confirmChoice'
import { requestSessionMode } from '../features/machines/components/sessionModeChoice'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('Manager session mode UI', () => {
  it('offers standard/manager as a session mode and gates it by provider capability', () => {
    const advanced = read('../features/machines/components/AdvancedSessionSettings.tsx')
    const state = read('../features/machines/hooks/useMachineLaunchState.ts')

    expect(advanced).not.toContain("t('session_advanced_settings')")
    expect(advanced).not.toContain('expanded')
    expect(advanced).toContain('<SessionModeSelector')
    expect(state).toContain('supportsManagerMode')
    expect(state).toContain(
      "if (sessionMode === 'manager' && !supportsManagerMode) setSessionMode('standard')",
    )
    expect(state).toContain('buildSessionLaunchPayload({')
  })

  it('uses the selected Manager provider and model for workers without a second picker', () => {
    const launch = read('../features/machines/hooks/useMachineLaunchState.ts')
    const sheet = read('../components/sheets/ProjectLaunchSheet.tsx')
    const project = read('../features/projects/screens/ProjectScreen.tsx')
    const panel = read('../features/machines/components/MachineLaunchPanel.tsx')

    const payload = buildSessionLaunchPayload({
      machineId: 'machine-1',
      agentType: 'codex',
      workDir: '/workspace',
      modelId: 'gpt-5.6-sol',
      sessionMode: 'manager',
    })
    expect(payload.managerConfig).toEqual({
      defaultWorkerAgentType: 'codex',
      defaultWorkerModelId: 'gpt-5.6-sol',
    })
    expect(payload.managerDefaultWorkerAgentType).toBe('codex')
    expect(payload.managerDefaultWorkerModelId).toBe('gpt-5.6-sol')
    expect(launch).not.toContain('selectedManagerWorkerAgent')
    expect(launch).not.toContain('managerWorkerFollowsCurrent')
    expect(sheet).not.toContain('ManagerWorkerSelector')
    expect(project).not.toContain('ManagerWorkerSelector')
    expect(panel).not.toContain('ManagerWorkerSelector')
    expect(launch).not.toContain("selectedAgent === 'manager'")
  })
})

const copy = { title: '使用分工协作？', message: '请谨慎选择', confirmLabel: '仍然使用', cancelLabel: '取消' }

describe('delegated work confirmation', () => {
  it('asks before leaving work-independently and applies only after confirmation', () => {
    const apply = vi.fn()
    let proceed: (() => void) | undefined
    requestSessionMode('standard', 'manager', (confirmed) => { proceed = confirmed }, apply)

    expect(apply).not.toHaveBeenCalled()
    proceed?.()
    expect(apply).toHaveBeenCalledExactlyOnceWith('manager')
  })

  it('keeps the current mode when the confirmation is cancelled', () => {
    const apply = vi.fn()
    const confirmManager = vi.fn()
    requestSessionMode('standard', 'manager', confirmManager, apply)

    expect(confirmManager).toHaveBeenCalledTimes(1)
    expect(apply).not.toHaveBeenCalled()
  })

  it('never prompts when returning to standard or re-picking the current mode', () => {
    const apply = vi.fn()
    const confirmManager = vi.fn()
    requestSessionMode('manager', 'standard', confirmManager, apply)
    requestSessionMode('standard', 'standard', confirmManager, apply)
    requestSessionMode('manager', 'manager', confirmManager, apply)

    expect(confirmManager).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledExactlyOnceWith('standard')
  })
})

describe('confirmChoice platform dialogs', () => {
  beforeEach(() => {
    alert.alert.mockReset()
    platform.OS = 'ios'
    vi.unstubAllGlobals()
  })

  it('uses a native alert whose cancel button does nothing and confirm proceeds', () => {
    const proceed = vi.fn()
    confirmChoice(copy, proceed)

    const [title, message, buttons] = alert.alert.mock.calls[0]!
    expect([title, message]).toEqual([copy.title, copy.message])
    expect(buttons[0]).toMatchObject({ text: '取消', style: 'cancel' })
    expect(buttons[0].onPress).toBeUndefined()
    expect(proceed).not.toHaveBeenCalled()
    buttons[1].onPress()
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  it('uses the browser confirm on Web / Desktop and honours cancel', () => {
    platform.OS = 'web'
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('window', { confirm })
    const proceed = vi.fn()

    confirmChoice(copy, proceed)
    expect(proceed).not.toHaveBeenCalled()
    confirmChoice(copy, proceed)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith('使用分工协作？\n\n请谨慎选择')
    expect(alert.alert).not.toHaveBeenCalled()
  })
})

describe('agent collaboration entry points', () => {
  it('routes App and Desktop agent forms through the confirming selector without a bypass', () => {
    const selector = read('../features/machines/components/SessionModeSelector.tsx')
    const app = read('../features/agents/AgentWorkspaceForm.tsx')
    const desktop = read('../features/desktop-agents/DesktopAgentWorkspaceForm.tsx')

    expect(selector).toContain('onPress={() => chooseMode(mode)}')
    expect(selector).not.toContain('onPress={() => props.onChange(mode)}')
    expect(selector).toContain("t('session_mode_manager_confirm_message')")
    expect(app).toContain('<SessionModeSelector')
    expect(desktop).toContain('<SessionModeSelector')
    // The forms only ever start from standard when creating; the selector is their sole way to change it.
    expect(app).toContain("useState<SessionMode>(initial?.sessionMode ?? 'standard')")
    expect(app).toContain('DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY')
  })

  it('does not reset a saved collaboration mode when Desktop switches machine', () => {
    const desktop = read('../features/desktop-agents/DesktopAgentWorkspaceForm.tsx')
    const chooseMachine = desktop.slice(desktop.indexOf('const chooseMachine'), desktop.indexOf('return (\n    <View\n      testID="desktop-agent-workspace-form"'))

    expect(chooseMachine).toContain("selected && selected.supportsManagerMode !== true ? 'standard' : draft.sessionMode")
    expect(chooseMachine).not.toContain("sessionMode: 'standard',")
    expect(chooseMachine).not.toContain('permissionPolicy')
  })

  it('hides collaboration mode by default and only reveals it for an already-saved Manager agent', () => {
    const app = read('../features/agents/AgentWorkspaceForm.tsx')
    const desktop = read('../features/desktop-agents/DesktopAgentWorkspaceForm.tsx')

    expect(app).toContain("const showSessionModeSection = initial?.sessionMode === 'manager'")
    expect(app).toContain('{showSessionModeSection ? (')
    expect(app.indexOf('{showSessionModeSection ? (')).toBeLessThan(app.indexOf('<SessionModeSelector'))
    expect(desktop).toContain("const showSessionModeSection = initial?.sessionMode === 'manager'")
    expect(desktop).toContain('{showSessionModeSection ? (')
    expect(desktop.indexOf('{showSessionModeSection ? (')).toBeLessThan(
      desktop.indexOf('<SessionModeSelector'),
    )
  })

  it('ships matching Chinese and English warnings that say results may be unstable', () => {
    expect(zhCorePart3.session_mode_manager_confirm_title).toBe('使用分工协作？')
    expect(zhCorePart3.session_mode_manager_confirm_message).toContain('不够稳定')
    expect(zhCorePart3.session_mode_manager_confirm_message).toContain('谨慎')
    expect(enCorePart3.session_mode_manager_confirm_message).toContain('less stable')
    expect(enCorePart3.session_mode_manager_confirm_message).toContain('carefully')
    for (const key of ['title', 'message', 'action'] as const) {
      expect(zhCorePart3[`session_mode_manager_confirm_${key}`]).toBeTruthy()
      expect(enCorePart3[`session_mode_manager_confirm_${key}`]).toBeTruthy()
    }
  })
})
