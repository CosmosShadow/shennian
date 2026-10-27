/**
 * Model list parsing — realistic PTY / CLI output fixtures (not single-line smoke tests).
 * @covers src/agents/model-registry.ts (parsers via modelSwitchingTestExports)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentType } from '@shennian/wire'
import { modelSwitchingTestExports } from '../agents/model-registry.js'
import { isCacheFresh } from '../agents/model-registry/cache.js'

const {
  applyClaudeModelEnvOverrides,
  discoverClaudeAliasModelsFromEnv,
  fallbackCodexModels,
  fallbackClaudeAliasModels,
  parseClaudeBinaryModels,
  parseClaudeModels,
  parseCodexModels,
  parseCodexAppServerModels,
  parseCursorModels,
  parseOpenClawModels,
  parseGeminiModels,
} = modelSwitchingTestExports

describe('dynamic provider model cache', () => {
  it.each(['opencode-connected-v1', 'pi-configured-v1'])(
    'expires %s after fifteen minutes even when the CLI version is unchanged',
    (sourceRevision) => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(16 * 60 * 1000)
      expect(isCacheFresh({
        version: '1', sourceRevision, refreshedAt: 0, models: [{ id: 'p/m', name: 'M' }],
      }, '1', sourceRevision)).toBe(false)
      now.mockRestore()
    },
  )

  it('retains stable catalogs for the generic twenty-four-hour cache window', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(16 * 60 * 1000)
    expect(isCacheFresh({
      version: '1', sourceRevision: 'codex-app-server-v2', refreshedAt: 0,
      models: [{ id: 'gpt', name: 'GPT' }],
    }, '1', 'codex-app-server-v2')).toBe(true)
    now.mockRestore()
  })
})

/** Approximate Claude `/model` picker after ANSI strip + space collapse (from PTY probes). */
const CLAUDE_MODEL_TUI_SAMPLE = `
1.Default(recommended)Usethedefaultmodel(currentlySonnet4.6)·$3/$15perMtok
2.BestUsethemostcapablemodel(currentlyOpus4.7)
3.OpusOpus4.7·Mostcapableforcomplexwork
4.Opus(1Mcontext)Opus4.7with1Mcontext
❯5.SonnetSonnet4.6fordailycoding
6.Sonnet(1Mcontext)Sonnet4.6forlongsessions·$3/$15perMtok
7.HaikuHaiku4.5·Fastestforquickanswers·$1/$5perMtok
8.OpusPlanOpus4.7forplanning·Sonnetforexecution
`

const CODEX_SCROLL_CAPTURE = `
Select Model
1.gpt-5.6-sol Latest GPT-5.6 Codex model.
2.gpt-5.6-terra Latest GPT-5.6 Codex model.
3.gpt-5.6-luna Latest GPT-5.6 Codex model.
4.gpt-5.3-codex (current) Latest frontier agentic coding model.
5.gpt-5.4 Latest frontier agentic coding model.
6.gpt-5.2-codex Frontier agentic coding model.
7.gpt-5.1-codex-max Codex-optimized flagship for deep and fast reasoning.
8.gpt-5.2 Latest frontier model with improvements
9.gpt-5.1-codex-mini Optimized for codex. Cheaper, faster, but less capable.
`

const CODEX_UPDATE_PROMPT_AND_SCROLL_CAPTURE = `
Update available! 0.118.0 -> 0.121.0
Release notes: https://github.com/openai/codex/releases/latest
1. Update now (runs npm install -g @openai/codex )
2. Skip
3. Skip until next version
Press enter to continue
Select Model
1.gpt-5.3-codex (current) Latest frontier agentic coding model.
2.gpt-5.4 Latest frontier agentic coding model.
3.gpt-5.2-codex Frontier agentic coding model.
4.gpt-5.1-codex-max Codex-optimized flagship for deep and fast reasoning.
5.gpt-5.2 Latest frontier model with improvements
6.gpt-5.1-codex-mini Optimized for codex. Cheaper, faster, but less capable.
`

const CURSOR_LIST_SAMPLE = `auto             - Auto
composer-2-fast  - Composer 2 Fast  (current, default)
gpt-5.3-codex    - GPT-5.3 Codex
claude-4.6-sonnet-medium - Sonnet 4.6 1M
`

const CLAUDE_BINARY_STRINGS_SAMPLE = `
/model
Select model
default
sonnet
opus
haiku
claude-sonnet-4-5
claude-sonnet-4-6
claude-opus-4-5
claude-opus-4-6
claude-haiku-4-5
`

describe('model-switching parsers (realistic fixtures)', () => {
  it('parseClaudeModels returns CLI aliases for --model', () => {
    const models = parseClaudeModels(CLAUDE_MODEL_TUI_SAMPLE)
    const ids = models.map((m) => m.id).sort()
    expect(ids).toEqual(['best', 'default', 'haiku', 'opus', 'opus[1m]', 'opusplan', 'sonnet', 'sonnet[1m]'])
    const sonnet = models.find((m) => m.id === 'sonnet')
    expect(sonnet?.name).toBe('Sonnet')
    expect(sonnet?.description).toContain('4.6')
    expect(models.find((m) => m.id === 'default')?.isDefault).toBe(true)
    expect(models.find((m) => m.id === 'opus[1m]')?.name).toBe('Opus (1M context)')
    expect(models.find((m) => m.id === 'opusplan')?.description).toContain('Sonnet for execution')
  })

  it('fallbackClaudeAliasModels exposes current stable Claude Code aliases', () => {
    const models = fallbackClaudeAliasModels({})
    expect(models.map((model) => model.id)).toEqual([
      'default',
      'sonnet',
      'fable',
      'opus',
      'haiku',
      'best',
      'opus[1m]',
      'sonnet[1m]',
      'opusplan',
    ])
    expect(models.find((model) => model.id === 'default')).toMatchObject({
      isDefault: true,
      description: 'Recommended model for your account',
    })
    expect(models.find((model) => model.id === 'fable')?.supportedReasoningEfforts).toHaveLength(5)
    expect(models.find((model) => model.id === 'haiku')?.supportedReasoningEfforts).toBeUndefined()
  })

  it('parseClaudeBinaryModels extracts conservative alias fallback from binary strings', () => {
    const models = parseClaudeBinaryModels(CLAUDE_BINARY_STRINGS_SAMPLE)
    expect(models.map((model) => model.id)).toEqual(['default', 'sonnet', 'opus', 'haiku'])
    expect(models.find((model) => model.id === 'default')).toMatchObject({
      name: 'Default (recommended)',
      description: 'v4.6',
      isDefault: true,
    })
    expect(models.find((model) => model.id === 'haiku')?.description).toBe('v4.5')
  })

  it('applyClaudeModelEnvOverrides preserves Claude Code aliases for compatibility', () => {
    const models = applyClaudeModelEnvOverrides(
      [
        { id: 'default', name: 'Default (recommended)', provider: 'anthropic', isDefault: true },
        { id: 'sonnet', name: 'Sonnet', provider: 'anthropic' },
        { id: 'opus', name: 'Opus', provider: 'anthropic' },
        { id: 'haiku', name: 'Haiku', provider: 'anthropic' },
      ],
      {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
      },
    )

    expect(models.find((model) => model.id === 'default')).toMatchObject({
      id: 'default',
      name: 'deepseek-v4-pro[1m]',
      provider: 'deepseek',
      isDefault: true,
    })
    expect(models.find((model) => model.id === 'sonnet')?.name).toBe('deepseek-v4-pro[1m]')
    expect(models.find((model) => model.id === 'haiku')?.name).toBe('deepseek-v4-flash')
    expect(models.find((model) => model.id === 'opus')?.name).toBe('Opus')
    expect(models.find((model) => model.id === 'sonnet')?.description).toContain(
      'Claude Code alias: Sonnet',
    )
  })

  it('fallbackClaudeAliasModels shows DeepSeek Claude Code integration models as selectable ids', () => {
    const models = fallbackClaudeAliasModels({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
    })

    expect(models.map((model) => model.id)).toEqual(['deepseek-v4-pro[1m]', 'deepseek-v4-flash'])
    expect(models[0]).toMatchObject({
      id: 'deepseek-v4-pro[1m]',
      name: 'deepseek-v4-pro[1m]',
      provider: 'deepseek',
      isDefault: true,
      defaultReasoningEffort: 'max',
    })
    expect(models[0]?.supportedReasoningEfforts?.map((effort) => effort.id)).toEqual(['max'])
  })

  it('discoverClaudeAliasModelsFromEnv returns empty when Claude Code has no provider override', () => {
    expect(
      discoverClaudeAliasModelsFromEnv({ ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' }),
    ).toEqual([])
  })

  it('parseCodexModels extracts all gpt-* ids from scroll-captured TUI text', () => {
    const models = parseCodexModels(CODEX_SCROLL_CAPTURE)
    const ids = models.map((m) => m.id).sort()
    expect(ids).toEqual([
      'gpt-5.1-codex-max',
      'gpt-5.1-codex-mini',
      'gpt-5.2',
      'gpt-5.2-codex',
      'gpt-5.3-codex',
      'gpt-5.4',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
    ])
    expect(models.find((m) => m.id === 'gpt-5.3-codex')?.isDefault).toBe(true)
  })

  it('parseCodexModels tolerates upgrade prompts before the model picker', () => {
    const models = parseCodexModels(CODEX_UPDATE_PROMPT_AND_SCROLL_CAPTURE)
    expect(models.map((m) => m.id)).toContain('gpt-5.3-codex')
    expect(models.map((m) => m.id)).toContain('gpt-5.4')
  })

  it('parseCodexAppServerModels maps model/list reasoning metadata', () => {
    const models = parseCodexAppServerModels({
      config: { model: 'gpt-5.5', model_reasoning_effort: 'medium' },
      data: [
        {
          id: 'gpt-5.5',
          model: 'gpt-5.5',
          displayName: 'GPT-5.5',
          description: 'Frontier model for complex coding, research, and real-world work.',
          hidden: false,
          isDefault: false,
          supportedReasoningEfforts: [
            { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
            {
              reasoningEffort: 'medium',
              description: 'Balances speed and reasoning depth for everyday tasks',
            },
            {
              reasoningEffort: 'high',
              description: 'Greater reasoning depth for complex problems',
            },
            {
              reasoningEffort: 'xhigh',
              description: 'Extra high reasoning depth for complex problems',
            },
          ],
          defaultReasoningEffort: 'medium',
          additionalSpeedTiers: ['fast'],
        },
      ],
    })

    expect(models.map((model) => model.id)).toEqual([
      'gpt-5.5',
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ])
    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      provider: 'openai',
      isDefault: true,
      defaultReasoningEffort: 'medium',
      additionalSpeedTiers: ['fast'],
    })
    expect(models[0]?.supportedReasoningEfforts?.map((effort) => effort.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(models[0]?.supportedReasoningEfforts?.[3]?.name).toBe('Extra High')
  })

  it('parseCodexAppServerModels adds the current config model when model/list omits it', () => {
    const models = parseCodexAppServerModels({
      config: { model: 'gpt-5.5', model_reasoning_effort: 'medium' },
      data: [
        {
          id: 'gpt-5.3-codex',
          model: 'gpt-5.3-codex',
          displayName: 'gpt-5.3-codex',
          description: 'Latest frontier agentic coding model.',
          isDefault: true,
          defaultReasoningEffort: 'medium',
        },
        {
          id: 'gpt-5.4',
          model: 'gpt-5.4',
          displayName: 'gpt-5.4',
          description: 'Latest frontier agentic coding model.',
          isDefault: false,
          defaultReasoningEffort: 'medium',
        },
      ],
    })

    expect(models.map((model) => model.id)).toEqual([
      'gpt-5.5',
      'gpt-5.3-codex',
      'gpt-5.4',
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ])
    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      provider: 'openai',
      isDefault: true,
      defaultReasoningEffort: 'medium',
    })
    expect(models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(['gpt-5.5'])
  })

  it('fallbackCodexModels exposes current Codex models with reasoning metadata', () => {
    const models = fallbackCodexModels()
    expect(models.map((model) => model.id)).toEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ])
    expect(models[0]).toMatchObject({
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      provider: 'openai',
      isDefault: true,
      defaultReasoningEffort: 'medium',
    })
    expect(models[0]?.supportedReasoningEfforts?.map((effort) => effort.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ])
  })

  it('parseCursorModels parses agent --list-models lines (flat list)', () => {
    const models = parseCursorModels(CURSOR_LIST_SAMPLE)
    expect(models).toHaveLength(4)
    expect(models.map((m) => m.id)).toContain('auto')
    expect(models.map((m) => m.id)).toContain('composer-2-fast')
    expect(models.find((m) => m.id === 'composer-2-fast')?.isDefault).toBe(true)
  })

  it('parseOpenClawModels keeps only available models from JSON', () => {
    const raw = JSON.stringify({
      models: [
        { key: 'a/b', name: 'A', available: false },
        {
          key: 'deepseek/deepseek-chat',
          name: 'DeepSeek Chat',
          available: true,
          tags: ['default'],
        },
      ],
    })
    const models = parseOpenClawModels(raw)
    expect(models).toHaveLength(1)
    expect(models[0]!.id).toBe('deepseek/deepseek-chat')
    expect(models[0]!.isDefault).toBe(true)
  })

  it('parseGeminiModels finds gemini-* and Auto Gemini patterns', () => {
    const raw = 'auto-gemini-3 gemini-2.5-pro Auto Gemini 2.5'
    const models = parseGeminiModels(raw)
    const ids = models.map((m) => m.id)
    expect(ids).toContain('auto-gemini-3')
    expect(ids).toContain('gemini-2.5-pro')
    expect(ids).toContain('auto-gemini-2.5')
  })
})

const mockDetectAgents = vi.hoisted(() => vi.fn())
const mockRefreshAgentInfos = vi.hoisted(() =>
  vi.fn(async () => [
    { type: 'claude' as const, models: [{ id: 'opus', name: 'Opus', isDefault: true }] },
  ]),
)
const mockResetCommandSpecCache = vi.hoisted(() => vi.fn())
const mockGetRegisteredAgents = vi.hoisted(() => vi.fn(() => [] as AgentType[]))
const mockUnregisterAgent = vi.hoisted(() => vi.fn())
const mockRegisterCustomAgent = vi.hoisted(() => vi.fn())
const mockLoadConfig = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('../agents/detect.js', () => ({
  detectAgents: mockDetectAgents,
}))

vi.mock('../agents/command-spec.js', () => ({
  resetCommandSpecCache: mockResetCommandSpecCache,
}))

vi.mock('../agents/adapter.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../agents/adapter.js')>()
  return {
    ...orig,
    getRegisteredAgents: mockGetRegisteredAgents,
    unregisterAgent: mockUnregisterAgent,
  }
})

vi.mock('../agents/custom.js', () => ({
  registerCustomAgent: mockRegisterCustomAgent,
}))

vi.mock('../config/index.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../config/index.js')>()
  return {
    ...orig,
    loadConfig: mockLoadConfig,
  }
})

vi.mock('../agents/model-registry.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../agents/model-registry.js')>()
  return {
    ...orig,
    refreshAgentInfos: mockRefreshAgentInfos,
  }
})

import { SessionManager } from '../session/manager.js'

describe('SessionManager models.refresh (CLI → relay event chain)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadConfig.mockReturnValue({})
    mockGetRegisteredAgents.mockReturnValue([])
    mockDetectAgents.mockReturnValue([
      { type: 'claude', version: '2.0', command: 'claude', models: [] },
    ])
    mockRefreshAgentInfos.mockResolvedValue([
      { type: 'claude', models: [{ id: 'opus', name: 'Opus', isDefault: true }] },
    ])
  })

  it('re-probes models, responds ok, and emits machine.agents for App sync', async () => {
    const client = { sendRes: vi.fn(), sendEvent: vi.fn() }
    const manager = new SessionManager(client as never)

    await manager.handleReq({
      type: 'req',
      id: 'mr-1',
      method: 'models.refresh',
      params: {},
    })

    expect(mockDetectAgents).toHaveBeenCalled()
    expect(mockRefreshAgentInfos).toHaveBeenCalled()
    expect(client.sendRes).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'res',
        id: 'mr-1',
        ok: true,
        payload: expect.objectContaining({
          agentList: ['claude'],
          agents: expect.arrayContaining([
            expect.objectContaining({ type: 'claude', models: expect.any(Array) }),
          ]),
        }),
      }),
    )
    expect(client.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'event',
        event: 'machine.agents',
        payload: expect.objectContaining({
          agentList: ['claude'],
          agents: expect.arrayContaining([expect.objectContaining({ type: 'claude' })]),
        }),
      }),
    )
  })

  it('returns empty payload when no agents detected', async () => {
    mockDetectAgents.mockReturnValue([])
    const client = { sendRes: vi.fn(), sendEvent: vi.fn() }
    const manager = new SessionManager(client as never)

    await manager.handleReq({
      type: 'req',
      id: 'mr-2',
      method: 'models.refresh',
      params: {},
    })

    expect(mockRefreshAgentInfos).not.toHaveBeenCalled()
    expect(client.sendRes).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        payload: { agentList: [], agents: [] },
      }),
    )
    expect(client.sendEvent).toHaveBeenCalledWith({
      type: 'event', event: 'machine.agents', payload: { agentList: [], agents: [] },
    })
  })
})

describe('SessionManager agents.refresh (runtime re-detect + custom reload)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadConfig.mockReturnValue({})
    mockGetRegisteredAgents.mockReturnValue([])
    mockDetectAgents.mockReturnValue([
      { type: 'claude', version: '2.0', command: 'claude', models: [] },
    ])
    mockRefreshAgentInfos.mockResolvedValue([
      { type: 'claude', models: [{ id: 'opus', name: 'Opus', isDefault: true }] },
    ])
  })

  it('clears command caches, reloads custom agents, and emits refreshed machine.agents', async () => {
    const customEntry = {
      command: 'node /tmp/custom-agent.mjs',
      caps: {
        name: 'My Agent',
        models: ['my-agent-v1'],
        defaultModel: 'my-agent-v1',
        mode: 'spawn' as const,
      },
    }
    mockLoadConfig.mockReturnValue({
      customAgents: {
        'my-agent': customEntry,
      },
    })
    mockGetRegisteredAgents.mockReturnValue(['claude', 'custom:stale-agent'] as AgentType[])

    const client = { sendRes: vi.fn(), sendEvent: vi.fn() }
    const manager = new SessionManager(client as never)

    await manager.handleReq({
      type: 'req',
      id: 'ar-1',
      method: 'agents.refresh',
      params: {},
    })

    expect(mockResetCommandSpecCache).toHaveBeenCalledTimes(1)
    expect(mockUnregisterAgent).toHaveBeenCalledWith('custom:stale-agent')
    expect(mockRegisterCustomAgent).toHaveBeenCalledWith('my-agent', customEntry)
    expect(mockDetectAgents).toHaveBeenCalled()
    expect(mockRefreshAgentInfos).toHaveBeenCalled()
    expect(client.sendRes).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'res',
        id: 'ar-1',
        ok: true,
        payload: expect.objectContaining({
          agentList: ['claude'],
        }),
      }),
    )
    expect(client.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'event',
        event: 'machine.agents',
      }),
    )
  })
})
