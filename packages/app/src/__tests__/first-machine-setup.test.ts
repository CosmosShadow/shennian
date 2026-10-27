/**
 * @covers app/(main)/_layout.tsx
 * @covers src/features/machines/components/FirstMachineSetupPanel.tsx
 * @covers src/components/sheets/AddMachineSheet.tsx
 * @covers src/features/machines/screens/AddMachineScreen.tsx
 * @covers src/features/machines/hooks/useMachineCodeClaim.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAppDownloads } from '../platform/appDownloads'
vi.mock('../config/server', () => ({
  getServerUrl: () => 'https://shennian.net',
  PUBLIC_SITE_URL: 'https://shennian.net',
}))
vi.mock('expo-constants', () => ({ default: { expoConfig: null } }))
import en from '../../../../open-source/packages/shared/src/i18n/en'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'

function readSource(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf-8')
}

describe('first machine setup flow', () => {
  it('renders the Web app shell directly without a first-machine gate', () => {
    const layout = readSource('../features/desktop-shell/DesktopMainLayout.tsx')

    expect(layout).toContain('<DesktopWorkspaceLayout')
    expect(layout).toContain('<Slot />')
    expect(layout).not.toContain('FirstMachineSetupGate')
  })

  it('does not start or block on legacy desktop automatic setup', () => {
    const layout = readSource('../../app/(main)/_layout.tsx')

    expect(layout).not.toContain('useDesktopAutoSetup')
    expect(layout).not.toContain('DesktopBootstrapGate')
  })

  it('keeps the projects empty state compact and opens machine setup on demand', () => {
    const source = readSource('../../app/(main)/index.tsx')
    const emptyState = readSource('../components/EmptyState.tsx')

    expect(source).toContain('machines.length === 0')
    expect(source).toContain('openAddMachine')
    expect(source).toContain("'home-add-machine'")
    expect(source).toContain("machines.length === 0 ? 'no_machines' : 'no_projects_hint'")
    expect(source).toContain(
      "machines.length === 0 ? 'first_machine_setup_title' : 'start_new_project'",
    )
    expect(source).not.toContain('FirstMachineSetupPanel')
    expect(source).not.toContain('KeyboardAvoidingView')
    expect(emptyState).not.toContain('FirstMachineSetupPanel')
    expect(emptyState).toContain('useMachinesStore')
    expect(emptyState).toContain('openMachinePicker')
    expect(emptyState).toContain('hasMachines ? openMachinePicker : openAddMachine')
    expect(emptyState).not.toContain("t('select_or_create_hint')")
    expect(source).toContain('!machinesRemoteResolved')
  })

  it('renders first-machine choices directly on the machines empty state', () => {
    const source = readSource('../features/machines/screens/MachinesScreen.tsx')

    expect(source).toContain('<FirstMachineSetupPanel')
    expect(source).toContain('onMachineInvite={(token) =>')
    expect(source).toContain("router.navigate('/(main)/scan')")
    expect(source).toContain('machineStyles.firstMachineSetup')
    expect(source).toContain('machines.length > 0 ?')
    expect(source).not.toContain("t('add_machine_cta')")
    expect(source).toContain('remoteResolved: machinesRemoteResolved')
    expect(source).not.toContain('<ActivityIndicator size="large"')
    expect(source).toContain('setMachinesRemoteResolved(true)')
  })

  it('offers setup guidance without asking an installation helper to create a room', () => {
    expect(zh.machine_picker_title).toBe('创建项目')
    expect(en.machine_picker_title).toBe('Create project')
    expect(zh.gs_ai_install_prompt).toContain('保留当前任务')
    expect(en.gs_ai_install_prompt).toContain('Preserve my current task')
    expect(zh.gs_ai_install_prompt).not.toContain('创建一个新的神念群聊')
    expect(en.gs_ai_install_prompt).not.toContain('create a new Shennian room')
  })

  it('keeps the specific-Agent handoff prompt short and delegates details to official docs', () => {
    for (const prompt of [zh.machine_agents_help_prompt, en.machine_agents_help_prompt]) {
      expect(prompt).toContain('{{agent}}')
      expect(prompt).toContain('{{skillUrl}}')
      expect(prompt).toContain('{{installUrl}}')
      expect(prompt).not.toContain('agent discover')
      expect(prompt).not.toContain('agent check')
      expect(prompt).not.toContain('Token')
    }
  })

  it('documents installation, pairing, Skill setup, and every Room action for external agents', () => {
    const guide = readSource('../../public/install.md')
    const legacyGuide = readSource('../../public/agent-install.md')

    expect(guide).not.toContain('Gemini')
    expect(guide).toContain('npm install -g shennian@latest')
    expect(guide).toContain('shennian pair --browser')
    expect(guide).toContain('shennian pair --token')
    expect(guide).toContain('https://shennian.net/skill.md')
    expect(guide).toContain('当前宿主自己的原生 Skill 或 Plugin 管理能力安装')
    expect(guide).toContain('只安装一个显示名称为 `Shennian` 的 Skill')
    expect(guide).toContain('$HOME/.agents/skills/shennian/SKILL.md')
    expect(guide).toContain('不要再写到旧的 `$HOME/.codex/skills`')
    expect(guide).toContain('Ask for approval → Full access → Confirm')
    expect(guide).toContain('必须由用户本人阅读 OpenAI 的风险说明并确认')
    expect(guide).toContain('Codex 的 **Full Auto** 仍可能运行在沙盒中')
    expect(guide).toContain('Browser 的 **Enable full CDP access** 也只控制浏览器')
    expect(guide).toContain('从同一个任务继续执行原始安装目标')
    expect(guide).toContain('当前宿主显示的原生 Skill 选择器')
    expect(guide).toContain('不要假设其他宿主使用相同前缀')
    expect(guide).toContain('输入 `$shennian`')
    expect(guide).toContain('本机执行 `shennian status`')
    expect(guide).toContain('目录中存在 `SKILL.md` 或 Agent 自报“安装成功”')
    expect(guide).not.toContain('shennian integration')
    expect(guide).not.toContain('shennian room create')
    expect(guide).not.toContain('sessionMode')
    expect(legacyGuide).toContain('https://shennian.net/install.md')
  })

  it('does not expose local detection or setup from add machine', () => {
    const source = readSource('../components/sheets/AddMachineSheet.tsx')

    expect(source).not.toContain('getDesktopControlAvailability')
    expect(source).not.toContain('local-control')
  })

  it('keeps mobile add machine to the site prompt plus in-page scan and pairing', () => {
    const source = readSource('../features/machines/screens/AddMachineScreen.tsx')
    const claim = readSource('../features/machines/hooks/useMachineCodeClaim.ts')

    expect(source).toContain("t('setup_client_install_prompt'")
    expect(source).not.toContain('SHENNIAN_MANUAL_INSTALL_URL')
    expect(source).not.toContain("t('setup_manual_install_client')")
    expect(source).not.toContain('SHENNIAN_CLI_INSTALL_COMMAND')
    expect(source).toContain("router.navigate('/(main)/scan')")
    expect(source).toContain('testID="add-machine-pair-code"')
    expect(source).not.toContain("'/(main)/machine-install'")
    expect(claim).toContain('machineAccountClient.claimPair(parsed.token)')
    expect(claim).toContain("pathname: '/(main)/machine/[machineId]'")
  })

  it('includes the explicit self-hosted pairing target in both languages', () => {
    for (const template of [
      zh.setup_selfhost_client_install_prompt,
      en.setup_selfhost_client_install_prompt,
    ]) {
      const prompt = template.replaceAll('{{server}}', 'https://192.168.20.30')
      expect(prompt).toContain('shennian pair --server https://192.168.20.30 --token')
      expect(prompt).not.toContain('shennian.net')
    }
  })

  it('points both mobile AI install prompts to the public guide', async () => {
    const { SHENNIAN_AGENT_INSTALL_DOC_URL, SHENNIAN_MANUAL_INSTALL_URL } =
      await import('../features/machines/installPrompt')
    const render = (template: string) => template.replace('{{url}}', SHENNIAN_AGENT_INSTALL_DOC_URL)

    expect(render(zh.setup_client_install_prompt)).toContain(SHENNIAN_AGENT_INSTALL_DOC_URL)
    expect(render(en.setup_client_install_prompt)).toContain(SHENNIAN_AGENT_INSTALL_DOC_URL)
    expect(SHENNIAN_MANUAL_INSTALL_URL).toBe('https://shennian.net/docs#manual-install')
  })
})

// @covers src/platform/appDownloads.ts
describe('platform download metadata', () => {
  const desktop = {
    url: 'v0.4.1/mac.dmg',
    version: '0.4.1',
    size: 123,
    arch: 'arm64',
    status: 'preview',
    sha256: 'a'.repeat(64),
  }
  it('does not label a legacy desktop package using the shared mobile version', () => {
    const releases = parseAppDownloads({
      version: '0.5.0',
      platforms: {
        android: { url: 'v0.4.0/a.apk', size: 10 },
        windows: { url: 'v0.1.21/a.exe', size: 8 },
        macos: desktop,
      },
    })
    expect(releases.android?.version).toBe('0.4.0')
    expect(releases.macos?.version).toBe('0.4.1')
    expect(releases.windows).toBeUndefined()
  })
  it.each([
    { arch: 'bogus' },
    { status: 'unknown' },
    { sha256: 'invalid' },
    { size: -1 },
    { version: 'not a version' },
  ])('hides invalid releases: %j', (patch) => {
    expect(
      parseAppDownloads({ platforms: { macos: { ...desktop, ...patch } } }).macos,
    ).toBeUndefined()
  })
  it('rejects malformed metadata and excludes unknown platforms', () => {
    expect(() => parseAppDownloads(null)).toThrow()
    expect(() => parseAppDownloads({})).toThrow()
    expect(parseAppDownloads({ platforms: { linux: desktop } })).toEqual({})
  })
})
