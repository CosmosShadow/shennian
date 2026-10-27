/**
 * Cache write policy for model discovery.
 * @covers src/agents/model-registry/service.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadCache = vi.hoisted(() => vi.fn())
const mockWriteCache = vi.hoisted(() => vi.fn())
const mockIsCacheFresh = vi.hoisted(() => vi.fn())
const mockDiscoverModelsForAgent = vi.hoisted(() => vi.fn())
const mockGetAgentConfigSummary = vi.hoisted(() => vi.fn())
const mockGetAgentRuntimeSummary = vi.hoisted(() => vi.fn())

vi.mock('../agents/model-registry/cache.js', () => ({
  readCache: mockReadCache,
  writeCache: mockWriteCache,
  isCacheFresh: mockIsCacheFresh,
}))

vi.mock('../agents/model-registry/discovery.js', () => ({
  discoverModelsForAgent: mockDiscoverModelsForAgent,
}))

vi.mock('../agents/config-status.js', () => ({
  getAgentConfigSummary: mockGetAgentConfigSummary,
}))

vi.mock('../agents/runtime-compatibility.js', () => ({
  getAgentRuntimeSummary: mockGetAgentRuntimeSummary,
}))

import {
  getCachedAgentInfos,
  recordAcpAgentModels,
  refreshAgentInfos,
  resolveAgentInfos,
} from '../agents/model-registry/service.js'
import { ModelDiscoveryFallbackError } from '../agents/model-registry/types.js'
import {
  registerManagedAgentRuntimeSecurity,
  unregisterManagedAgentRuntimeSecurity,
} from '../security/managed-agent-runtime.js'

describe('resolveAgentInfos cache writes', () => {
  it('advertises the bundled runtime only for native-full agent execution, with external native-full Workers but never restricted modes', async () => {
    mockReadCache.mockReturnValue({ agents: {} })
    mockDiscoverModelsForAgent.mockResolvedValue([{ id: 'unit-model', name: 'Unit model' }])
    const infos = await resolveAgentInfos([{ type: 'shennian', command: 'node', args: [] }], {})
    expect(infos[0]).toMatchObject({ supportsFreshPersonalContext: true, supportsAgent: true, supportsManagedNativeFull: true, supportsManagedAgent: false, supportsWorker: false, supportsExternalWorkerTarget: true, supportedAgentExecutionModes: ['native-full'] })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCacheFresh.mockReturnValue(false)
    mockGetAgentConfigSummary.mockReturnValue(undefined)
    mockGetAgentRuntimeSummary.mockImplementation((agent: { version?: string }) =>
      agent.version ? { cliVersion: agent.version } : undefined,
    )
  })

  it('does not overwrite an existing non-empty cache entry when discovery returns no models', async () => {
    mockReadCache.mockReturnValue({
      version: 1,
      agents: {
        claude: {
          version: '2.1.117',
          sourceRevision: 'claude-alias-v2',
          refreshedAt: 123,
          models: [{ id: 'opus', name: 'Opus' }],
        },
      },
    })
    mockDiscoverModelsForAgent.mockResolvedValue([])

    const infos = await resolveAgentInfos(
      [{ type: 'claude', command: 'claude', args: [], version: '2.1.118' }],
      {},
    )

    expect(infos).toEqual([
      {
        type: 'claude',
        models: [{ id: 'opus', name: 'Opus' }],
        supportsStandardSession: true,
        supportsAgent: true,
        supportedAgentExecutionModes: ['native-full'],
        supportsManagedAgent: false,
        supportsManagedNativeFull: true,
        supportsRoomTools: true,
        supportsWorker: true,
        supportsManagerMode: true,
        supportsExternalWorkerTarget: true,
        managedAgentProtection: {
          level: 'unverified',
          runtimeVersion: '2.1.118',
          platform: expect.any(String),
          unsupportedCapabilities: expect.arrayContaining([
            'fileAccess.workspaceRead',
            'externalCapabilities.commandNetwork',
          ]),
        },
        runtime: { cliVersion: '2.1.118' },
      },
    ])
    expect(mockIsCacheFresh).toHaveBeenCalledWith(
      expect.objectContaining({ version: '2.1.117' }),
      '2.1.118',
      'claude-alias-v2',
    )
    expect(mockWriteCache).not.toHaveBeenCalled()
  })

  it('writes cache when discovery returns a non-empty model list', async () => {
    mockReadCache.mockReturnValue({
      version: 1,
      agents: {},
    })
    mockDiscoverModelsForAgent.mockResolvedValue([
      { id: 'default', name: 'Default (recommended)', isDefault: true },
      { id: 'sonnet', name: 'Sonnet' },
    ])

    const infos = await resolveAgentInfos(
      [{ type: 'claude', command: 'claude', args: [], version: '2.1.118' }],
      {},
    )

    expect(infos[0]?.models.map((model) => model.id)).toEqual(['default', 'sonnet'])
    expect(mockWriteCache).toHaveBeenCalledTimes(1)
    expect(mockWriteCache).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining({
          claude: expect.objectContaining({
            version: '2.1.118',
            sourceRevision: 'claude-alias-v2',
            models: expect.arrayContaining([
              expect.objectContaining({ id: 'default' }),
              expect.objectContaining({ id: 'sonnet' }),
            ]),
          }),
        }),
      }),
    )
  })

  it('versions successful Codex discovery independently from the Codex binary', async () => {
    mockReadCache.mockReturnValue({ version: 1, agents: {} })
    mockDiscoverModelsForAgent.mockResolvedValue([
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', isDefault: true },
    ])

    await resolveAgentInfos(
      [{ type: 'codex', command: 'codex', args: [], version: '0.154.0' }],
      {},
    )

    expect(mockWriteCache).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining({
          codex: expect.objectContaining({
            version: '0.154.0',
            sourceRevision: 'codex-app-server-v2',
          }),
        }),
      }),
    )
  })

  it('keeps the last live Codex result when a forced refresh falls back', async () => {
    const cachedModels = [{
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      supportedReasoningEfforts: [{ id: 'medium', name: 'Medium' }],
    }]
    mockReadCache.mockReturnValue({
      version: 1,
      agents: {
        codex: {
          version: '0.154.0',
          sourceRevision: 'codex-app-server-v2',
          refreshedAt: 123,
          models: cachedModels,
        },
      },
    })
    mockDiscoverModelsForAgent.mockRejectedValue(new ModelDiscoveryFallbackError(
      'codex',
      'app_server_timeout',
      [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }],
    ))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const infos = await refreshAgentInfos(
      [{ type: 'codex', command: 'codex', args: [], version: '0.154.0' }],
      {},
    )

    expect(infos[0]?.models).toEqual(cachedModels)
    expect(mockIsCacheFresh).not.toHaveBeenCalled()
    expect(mockWriteCache).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[model-discovery] agent=codex source=fallback reason=app_server_timeout usedCache=true',
    )
    warn.mockRestore()
  })

  it('shows but does not cache Codex fallback metadata when no trusted live result exists', async () => {
    const fallbackModels = [{
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      supportedReasoningEfforts: [{ id: 'medium', name: 'Medium' }],
    }]
    mockReadCache.mockReturnValue({
      version: 1,
      agents: {
        codex: {
          version: '0.153.4',
          refreshedAt: 123,
          models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }],
        },
      },
    })
    mockDiscoverModelsForAgent.mockRejectedValue(new ModelDiscoveryFallbackError(
      'codex',
      'app_server_unavailable',
      fallbackModels,
    ))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const infos = await resolveAgentInfos(
      [{ type: 'codex', command: 'codex', args: [], version: '0.154.0' }],
      {},
    )

    expect(infos[0]?.models).toEqual(fallbackModels)
    expect(mockWriteCache).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[model-discovery] agent=codex source=fallback reason=app_server_unavailable usedCache=false',
    )
    warn.mockRestore()
  })

  it('advertises Manager mode for every discovered real Adapter contract', async () => {
    mockReadCache.mockReturnValue({ version: 1, agents: {} })
    mockDiscoverModelsForAgent.mockResolvedValue([{ id: 'default', name: 'Default' }])

    const infos = await resolveAgentInfos(
      [
        { type: 'codex', command: 'codex', args: [], version: '1' },
        { type: 'claude', command: 'claude', args: [], version: '1' },
        { type: 'workbuddy', command: 'codebuddy', args: [], version: '1' },
        { type: 'pi-coding-agent', command: 'pi', args: [], version: '0.85.1' },
      ],
      {},
    )

    expect(infos.map(({ type, supportsManagerMode }) => ({ type, supportsManagerMode }))).toEqual([
      { type: 'codex', supportsManagerMode: true },
      { type: 'claude', supportsManagerMode: true },
      { type: 'workbuddy', supportsManagerMode: true },
      { type: 'pi-coding-agent', supportsManagerMode: true },
    ])
  })

  it('invalidates pre-removal Pi cache with the configured-provider discovery revision', async () => {
    mockReadCache.mockReturnValue({
      version: 1,
      agents: {
        'pi-coding-agent': {
          version: '0.86.1', refreshedAt: 123,
          models: [{ id: 'retired-hosted/model', name: 'Retired hosted model' }],
        },
      },
    })
    mockDiscoverModelsForAgent.mockResolvedValue([
      { id: 'user-provider/deepseek-flash', name: 'DeepSeek V4.1 Flash' },
    ])
    const [info] = await resolveAgentInfos(
      [{ type: 'pi-coding-agent', command: 'pi', args: [], version: '0.86.1' }],
      {},
    )
    expect(mockIsCacheFresh).toHaveBeenCalledWith(
      expect.any(Object), '0.86.1', 'pi-configured-v1',
    )
    expect(info?.models.map((model) => model.id)).toEqual(['user-provider/deepseek-flash'])
    expect(mockWriteCache).toHaveBeenCalledWith(expect.objectContaining({
      agents: expect.objectContaining({
        'pi-coding-agent': expect.objectContaining({ sourceRevision: 'pi-configured-v1' }),
      }),
    }))
  })

  it('does not briefly advertise a Pi cache from an obsolete discovery rule', () => {
    mockReadCache.mockReturnValue({
      version: 1,
      agents: {
        'pi-coding-agent': {
          version: '0.86.1', refreshedAt: Date.now(),
          models: [{ id: 'retired-hosted/model', name: 'Retired hosted model' }],
        },
      },
    })
    const [info] = getCachedAgentInfos([{
      type: 'pi-coding-agent', command: 'pi', args: [], version: '0.86.1',
      models: [{ id: 'detected-at-launch/model', name: 'Launch model' }],
    }])
    expect(info?.models.map((model) => model.id)).toEqual(['detected-at-launch/model'])
  })

  it('derives OpenCode auth from connected-provider models but never claims required from no models', async () => {
    mockReadCache.mockReturnValue({ version: 1, agents: {} })
    mockDiscoverModelsForAgent.mockResolvedValueOnce([{ id: 'anthropic/claude', name: 'Claude' }])
    const [withModels] = await resolveAgentInfos(
      [{ type: 'opencode', command: 'opencode', args: [], version: '1.0.0', authState: 'unknown' }],
      {},
    )
    expect(withModels).toMatchObject({ type: 'opencode', authState: 'ready' })
    expect(withModels!.models.some((model) => model.isDefault)).toBe(false)

    mockReadCache.mockReturnValue({ version: 1, agents: {} })
    mockDiscoverModelsForAgent.mockResolvedValueOnce([])
    const [noModels] = await resolveAgentInfos(
      [{ type: 'opencode', command: 'opencode', args: [], version: '1.0.0', authState: 'unknown' }],
      {},
    )
    expect(noModels).toMatchObject({ type: 'opencode', authState: 'unknown' })
  })

  it('keeps OpenCode 2.x eligible as a full-access Agent while restricted evidence is unavailable', async () => {
    mockReadCache.mockReturnValue({ version: 1, agents: {} })
    mockDiscoverModelsForAgent.mockResolvedValue([{ id: 'p/m', name: 'M' }])
    const [info] = await resolveAgentInfos(
      [{
        type: 'opencode', command: 'opencode', args: [], version: '2.0.11',
        runtimePlatform: 'darwin', executableFingerprint: `sha256:${'a'.repeat(64)}`,
      }],
      {},
    )
    expect(info).toMatchObject({
      supportsAgent: true, supportedAgentExecutionModes: ['native-full'],
      supportsManagedAgent: false, supportsManagedNativeFull: true, supportsRoomTools: true,
      managedAgentProtection: { level: 'unverified', runtimeVersion: '2.0.11' },
    })
  })

  it('allows an ACP Agent to become a native-full managed Agent without claiming sandbox support', async () => {
    mockReadCache.mockReturnValue({ version: 1, agents: {} })
    mockDiscoverModelsForAgent.mockResolvedValue([{ id: 'default', name: 'Default' }])

    const [info] = await resolveAgentInfos(
      [{
        type: 'acp:qwen-code',
        command: 'qwen',
        args: ['--acp'],
        version: '1.0.0',
        integration: 'acp',
        runtimePlatform: 'darwin',
        executableFingerprint: `sha256:${'b'.repeat(64)}`,
      }],
      {},
    )

    expect(info).toMatchObject({
      type: 'acp:qwen-code',
      integration: 'acp',
      supportsAgent: true,
      supportedAgentExecutionModes: ['native-full'],
      supportsManagedAgent: false,
      supportsManagedNativeFull: true,
      supportsRoomTools: true,
      supportsWorker: true,
      supportsManagerMode: true,
      supportsExternalWorkerTarget: true,
      managedAgentProtection: {
        level: 'unverified',
        runtimeVersion: '1.0.0',
        executableFingerprint: `sha256:${'b'.repeat(64)}`,
      },
    })
  })

  it('advertises hard protection only after the adapter registers versioned platform evidence', async () => {
    mockReadCache.mockReturnValue({ version: 1, agents: {} })
    mockDiscoverModelsForAgent.mockResolvedValue([{ id: 'default', name: 'Default' }])
    const hardProfile = {
      level: 'hard' as const,
      fileAccess: {
        'workspace-read': true,
        'workspace-write': true,
        'host-full': true,
      },
      externalCapabilities: {
        commandNetwork: { allow: true, deny: true },
        webSearch: { allow: true, deny: true },
        browser: { allow: true, deny: true },
        computerUse: { allow: true, deny: true },
        mcp: { allow: true, deny: true },
      },
    }
    registerManagedAgentRuntimeSecurity('codex', {
      minimumRuntimeVersion: '1.0.0',
      platforms: {
        darwin: hardProfile,
        linux: hardProfile,
        win32: hardProfile,
        wsl: hardProfile,
      },
    })

    try {
      const [info] = await resolveAgentInfos(
        [
          {
            type: 'codex',
            command: 'codex',
            args: [],
            version: '1.2.0',
            runtimePlatform: 'darwin',
            runtimeIsWsl: false,
            executableFingerprint: `sha256:${'a'.repeat(64)}`,
          },
        ],
        {},
      )
      expect(info?.managedAgentProtection).toEqual(
        expect.objectContaining({
          level: 'hard',
          runtimeVersion: '1.2.0',
          executableFingerprint: `sha256:${'a'.repeat(64)}`,
          unsupportedCapabilities: [],
        }),
      )
    } finally {
      unregisterManagedAgentRuntimeSecurity('codex')
    }
  })
})

describe('recordAcpAgentModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replaces the previous list with the newest one', () => {
    mockReadCache.mockReturnValue({
      version: 1,
      agents: { 'acp:qwen-code': { refreshedAt: 1, models: [{ id: 'old', name: 'Old' }] } },
    })

    expect(recordAcpAgentModels('acp:qwen-code', [{ id: 'new', name: 'New' }])).toBe(true)

    expect(mockWriteCache).toHaveBeenCalledWith({
      version: 1,
      agents: { 'acp:qwen-code': { refreshedAt: expect.any(Number), models: [{ id: 'new', name: 'New' }] } },
    })
  })

  it('does not write when the list is unchanged, empty, or not an ACP Agent', () => {
    mockReadCache.mockReturnValue({
      version: 1,
      agents: { 'acp:qwen-code': { refreshedAt: 1, models: [{ id: 'same', name: 'Same' }] } },
    })

    expect(recordAcpAgentModels('acp:qwen-code', [{ id: 'same', name: 'Same' }])).toBe(false)
    expect(recordAcpAgentModels('acp:qwen-code', [])).toBe(false)
    expect(recordAcpAgentModels('claude', [{ id: 'opus', name: 'Opus' }])).toBe(false)

    expect(mockWriteCache).not.toHaveBeenCalled()
  })

  it('serves a recorded ACP list to the machine even though probing never returns one', async () => {
    mockIsCacheFresh.mockReturnValue(false)
    mockGetAgentConfigSummary.mockReturnValue(undefined)
    mockGetAgentRuntimeSummary.mockReturnValue(undefined)
    mockReadCache.mockReturnValue({
      version: 1,
      agents: { 'acp:qwen-code': { refreshedAt: 1, models: [{ id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus' }] } },
    })
    mockDiscoverModelsForAgent.mockResolvedValue([])

    const [info] = await refreshAgentInfos(
      [{ type: 'acp:qwen-code', command: 'qwen', args: ['--acp'] }],
      {},
    )

    expect(info?.models).toEqual([{ id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus' }])
    expect(mockWriteCache).not.toHaveBeenCalled()
  })
})
