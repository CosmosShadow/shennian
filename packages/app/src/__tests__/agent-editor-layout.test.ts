// @covers packages/app/src/features/desktop-agents/DesktopAgentWorkspaceForm.tsx
// @covers packages/app/src/features/agents/AgentWorkspaceForm.tsx
// @covers packages/app/src/features/agents/screens/AgentEditScreen.tsx
// @covers packages/app/src/features/machines/screens/MachineAgentsScreen.tsx

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('Desktop Agent editor information architecture', () => {
  it('keeps Native persistence out of every Metro-scanned base editor route', () => {
    for (const [route, screen, desktop] of [
      ['new', 'AgentNewScreen', 'DesktopNewAgentScreen'],
      ['[agentId]/settings', 'AgentEditScreen', 'DesktopEditAgentScreen'],
    ]) {
      const entry = read(`../../app/(main)/agents/${route}.tsx`)
      expect(entry).toContain(`features/agents/screens/${screen}`)
      expect(entry).not.toMatch(/agentEditorModel|accountRuntime|AgentWorkspaceForm/)
      const web = read(`../features/agents/screens/${screen}.web.tsx`)
      expect(web).toContain(`${desktop} as default`)
      expect(web).toContain('desktop-agents/DesktopAgentEditorScreen')
      expect(web).not.toMatch(/agentEditorModel|\.native|db\./)
    }
  })
  it('keeps responsive layout in the independent Desktop form, not a mobile compatibility branch', () => {
    const form = read('../features/desktop-agents/DesktopAgentWorkspaceForm.tsx')
    expect(form).toContain('wide && styles.columns')
    expect(read('../features/agents/AgentWorkspaceForm.tsx')).not.toMatch(/isDesktopControlSurfaceEnabled|usesDesktopAgentEditorColumns/)
    expect(existsSync(resolve(__dirname, '../features/agents/agentEditorLayout.ts'))).toBe(false)
    expect(existsSync(resolve(__dirname, '../features/agents/agentEditorModel.web.ts'))).toBe(false)
    expect(read('../../app/(main)/agents/new.web.tsx')).toContain('DesktopNewAgentScreen')
    expect(read('../../app/(main)/agents/[agentId]/settings.web.tsx')).toContain('DesktopEditAgentScreen')
  })

  it('labels the public and private sections without changing their field semantics', () => {
    const form = read('../features/desktop-agents/DesktopAgentWorkspaceForm.tsx')

    expect(form).toContain('testID="desktop-agent-public-profile"')
    expect(form).toContain('testID="desktop-agent-runtime-settings"')
    expect(form).not.toContain("t('agents_public_section')")
    expect(form).not.toContain("t('agents_desktop_internal_section')")
    expect(form).toContain('accessibilityLabel={label}')
    expect(form).toContain('accessibilityRole="radio"')
    expect(form).toContain('accessibilityState={{ checked: selected, disabled }}')
    expect(form).toContain("label={t('agents_project_quick_select')}")
    expect(form).not.toContain("t('ai_setup_entry')")
    expect(form).not.toContain('DesktopMachineAgents')
    expect(form.indexOf('desktop-agent-public-profile')).toBeLessThan(
      form.indexOf('desktop-agent-runtime-settings'),
    )
  })

  it('keeps external runtimes and sessions outside the managed workspace editor', () => {
    const settings = read('../features/agents/screens/AgentEditScreen.tsx')
    const machineAgents = read('../features/machines/screens/MachineAgentsScreen.tsx')

    expect(settings).toContain('createAgentEditorModel({')
    expect(settings).toContain('accountId, agentId,')
    expect(settings).not.toContain('agentAccountClient')
    expect(settings).not.toContain('authApi<{ agent: AgentWorkspace }>')
    expect(settings).toContain('<AgentWorkspaceForm')
    expect(machineAgents).not.toContain('AgentWorkspaceForm')
    expect(machineAgents).not.toContain('/agents/${')
    expect(machineAgents).not.toContain('/agents/')
  })

  it('shows the account-level delete action only for existing Agents on both surfaces', () => {
    const nativeEdit = read('../features/agents/screens/AgentEditScreen.tsx')
    const nativeNew = read('../features/agents/screens/AgentNewScreen.tsx')
    const desktopEditor = read('../features/desktop-agents/DesktopAgentEditorScreen.tsx')

    expect(nativeEdit).toContain('testID="agent-delete-action"')
    expect(nativeEdit).toContain("t('agents_delete_confirm')")
    expect(nativeNew).not.toContain('agent-delete-action')
    expect(desktopEditor).toContain('{initial ? (')
    expect(desktopEditor).toContain('desktopAgentPort.deleteAgent(initial.id)')
    expect(desktopEditor).toContain("router.replace('/(main)/agents')")
    expect(desktopEditor).toContain('busy={deleting}')
  })
})
