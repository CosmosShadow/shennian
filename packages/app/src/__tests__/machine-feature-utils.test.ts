/**
 * @covers src/features/machines/utils/launch.ts
 * @covers src/features/machines/utils/agentConfig.ts
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAgentInstallPrompt,
  buildCatalogAgentInstallPrompt,
  compareVersions,
  fetchLatestCliVersion,
  getAgentLaunchLabel,
  getDirLabel,
  getInstallableBuiltinAgents,
  getMachineOsLabel,
  isMachineCliVersionBlocked,
  MIN_RELAY_UPLOAD_CLI_VERSION,
  resolveInitialLaunchAgent,
} from '../features/machines/utils/launch'
import { isConfigurableAgent } from '../features/machines/utils/agentConfig'
import { buildSessionLaunchPayload } from '../features/machines/utils/sessionLaunchPayload'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('machine feature utils', () => {
  it('classifies semantic version changes', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe('major')
    expect(compareVersions('1.0.0', '1.2.0')).toBe('minor')
    expect(compareVersions('1.0.0', '1.0.1')).toBe('patch')
    expect(compareVersions('1.0.0', '1.0.0')).toBe('none')
  })

  it('matches the server relay upload minimum CLI version', () => {
    expect(MIN_RELAY_UPLOAD_CLI_VERSION).toBe('0.2.75')
    expect(isMachineCliVersionBlocked(undefined)).toBe(false)
    expect(isMachineCliVersionBlocked(null)).toBe(false)
    expect(isMachineCliVersionBlocked('0.0.0')).toBe(true)
    expect(isMachineCliVersionBlocked('0.2.74')).toBe(true)
    expect(isMachineCliVersionBlocked('0.2.75')).toBe(false)
    expect(isMachineCliVersionBlocked('0.2.78')).toBe(false)
  })

  it('can force-refresh the latest CLI version instead of reusing the cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ version: '0.2.100' }) })
      .mockResolvedValueOnce({ json: async () => ({ version: '0.2.101' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchLatestCliVersion({ force: true })).resolves.toBe('0.2.100')
    await expect(fetchLatestCliVersion()).resolves.toBe('0.2.100')
    await expect(fetchLatestCliVersion({ force: true })).resolves.toBe('0.2.101')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the main-process broker on Desktop without contacting npm from renderer', async () => {
    const getLatestCliVersion = vi.fn().mockResolvedValue({
      ok: true,
      value: { version: '0.4.31' },
    })
    vi.stubGlobal('window', { shennianDesktop: { app: { getLatestCliVersion } } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchLatestCliVersion({ force: true })).resolves.toBe('0.4.31')
    expect(getLatestCliVersion).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('formats launch labels for supported agents', () => {
    expect(getAgentLaunchLabel('claude')).toBe('Claude')
  })

  it('builds a readable directory label', () => {
    expect(getDirLabel('~', 'Home')).toBe('Home')
    expect(getDirLabel('/Users/test/project', 'Home')).toBe('project')
    expect(getDirLabel('/tmp', 'Home')).toBe('tmp')
  })

  it('formats machine OS labels', () => {
    expect(getMachineOsLabel('macos')).toBe('macOS')
    expect(getMachineOsLabel('darwin')).toBe('macOS')
    expect(getMachineOsLabel('win32')).toBe('Windows')
    expect(getMachineOsLabel('linux')).toBe('Linux')
  })

  it('lists installable built-in agents except built-in local agents', () => {
    const installableAgents = getInstallableBuiltinAgents(['claude', 'pi', 'codex'])

    expect(installableAgents).toContain('opencode')
    expect(installableAgents).not.toContain('pi')
    expect(installableAgents).toContain('pi-coding-agent')
    expect(installableAgents).not.toContain('manager')
  })

  it('marks provider-configurable agents', () => {
    expect(isConfigurableAgent('codex')).toBe(true)
    expect(isConfigurableAgent('claude')).toBe(true)
    expect(isConfigurableAgent('pi')).toBe(false)
    expect(isConfigurableAgent('gemini')).toBe(false)
  })

  it('builds an install prompt for missing agents', () => {
    const prompt = buildAgentInstallPrompt('codex')
    expect(prompt).toContain('安装 Codex CLI')
    expect(prompt).toContain('`codex`')
    expect(prompt).toContain('刷新 Agent 列表')
  })

  it('builds a generic official-source install prompt for catalog Agents', () => {
    const prompt = buildCatalogAgentInstallPrompt({
      name: 'Qwen Code',
      website: 'https://example.com/qwen',
    })
    expect(prompt).toContain('安装 Qwen Code')
    expect(prompt).toContain('https://example.com/qwen')
    expect(prompt).toContain('官方发布渠道')
  })

  it('defaults new launches to an installed external agent', () => {
    expect(
      resolveInitialLaunchAgent({
        agentList: ['claude', 'codex', 'pi'],
        lastAgentType: 'codex',
      }),
    ).toBe('codex')
    expect(
      resolveInitialLaunchAgent({
        agentList: ['claude', 'codex', 'pi'],
        initialAgentType: 'codex',
        lastAgentType: 'claude',
      }),
    ).toBe('codex')
  })

  it('builds a project-scoped launch without creation-time reasoning or agent switching fields', () => {
    const payload = buildSessionLaunchPayload({
      machineId: ' machine-1 ',
      agentType: 'codex',
      workDir: ' /workspace/project ',
      modelId: 'gpt-5.6-sol',
      sessionMode: 'standard',
    })

    expect(payload).toEqual({
      machineId: 'machine-1',
      agentType: 'codex',
      workDir: '/workspace/project',
      modelId: 'gpt-5.6-sol',
      sessionMode: 'standard',
    })
    expect(payload).not.toHaveProperty('reasoningEffort')
    expect(payload).not.toHaveProperty('nextAgentType')
  })

  it('fails closed when a new conversation has no concrete project context', () => {
    expect(() =>
      buildSessionLaunchPayload({
        machineId: 'machine-1',
        agentType: 'codex',
        workDir: '  ',
        sessionMode: 'standard',
      }),
    ).toThrow('project_context_required')
  })
})
