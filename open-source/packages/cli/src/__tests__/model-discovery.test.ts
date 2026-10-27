/**
 * Claude model discovery compatibility fallbacks.
 * @covers src/agents/model-registry/discovery.ts
 */
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockResolveBuiltinCommand = vi.hoisted(() => vi.fn())
const mockSpawnResolvedCommand = vi.hoisted(() => vi.fn())
const mockRunResolvedCommand = vi.hoisted(() => vi.fn())
const mockReadLatestUserEnv = vi.hoisted(() => vi.fn(() => ({})))
const mockDiscoverOpenCodeModelsViaApi = vi.hoisted(() => vi.fn())

vi.mock('../agents/command-spec.js', () => ({
  resolveBuiltinCommand: mockResolveBuiltinCommand,
  spawnResolvedCommand: mockSpawnResolvedCommand,
}))

vi.mock('../agents/model-registry/runner.js', () => ({
  runResolvedCommand: mockRunResolvedCommand,
}))

vi.mock('../agents/model-registry/opencode-api.js', () => ({
  discoverOpenCodeModelsViaApi: mockDiscoverOpenCodeModelsViaApi,
}))

vi.mock('../agent-env.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../agent-env.js')>()
  return {
    ...orig,
    readLatestUserEnv: mockReadLatestUserEnv,
  }
})

import { discoverModelsForAgent } from '../agents/model-registry/discovery.js'
import { parseOpenCodeProviderModels } from '../agents/model-registry/parsers.js'
import { ModelDiscoveryFallbackError } from '../agents/model-registry/types.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenCode connected model discovery', () => {
  it('keeps configured coding models first and excludes unconnected or non-chat models', () => {
    const coding = (id: string) => ({ id, name: id, status: 'active', capabilities: {
      input: { text: true }, output: { text: true }, toolcall: true,
    } })
    const models = parseOpenCodeProviderModels({
      connected: ['opencode', 'custom'],
      all: [
        { id: 'openai', models: { 'gpt-5': coding('gpt-5') } },
        { id: 'opencode', models: { free: coding('free') } },
        { id: 'custom', models: {
          'my-model': coding('my-model'),
          'embedding': { ...coding('embedding'), capabilities: { input: { text: true }, output: { text: false }, toolcall: false } },
        } },
      ],
    }, { model: 'custom/my-model', provider: { custom: { models: { 'my-model': {} } } } })
    expect(models.map((model) => model.id)).toEqual(['custom/my-model', 'opencode/free'])
    expect(models[0]?.isDefault).toBe(true)
  })

  it('uses the scoped provider API instead of the unranked CLI catalog', async () => {
    vi.clearAllMocks()
    mockResolveBuiltinCommand.mockReturnValue({ command: 'opencode', args: [], kind: 'native' })
    mockDiscoverOpenCodeModelsViaApi.mockResolvedValue([{ id: 'custom/model', name: 'Model' }])
    const models = await discoverModelsForAgent({ type: 'opencode', command: 'opencode', args: [] }, {})
    expect(models.map((model) => model.id)).toEqual(['custom/model'])
    expect(mockRunResolvedCommand).not.toHaveBeenCalled()
  })

  it('places explicitly configured custom models ahead of other connected models', () => {
    const model = (id: string) => ({ id, capabilities: {
      input: { text: true }, output: { text: true }, toolcall: true,
    } })
    const result = parseOpenCodeProviderModels({
      connected: ['openai', 'custom'],
      all: [
        { id: 'openai', models: { 'gpt-5': model('gpt-5') } },
        { id: 'custom', models: { z: model('z'), a: model('a') } },
      ],
    }, { provider: { custom: { models: { z: {} } } } })
    expect(result.map(({ id }) => id)).toEqual(['custom/z', 'custom/a', 'openai/gpt-5'])
  })
})

describe('discoverClaudeModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadLatestUserEnv.mockReturnValue({})
    vi.stubEnv('ANTHROPIC_MODEL', '')
    vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', '')
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', '')
    vi.stubEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL', '')
    vi.stubEnv('ANTHROPIC_BASE_URL', '')
    vi.stubEnv('CLAUDE_CODE_EFFORT_LEVEL', '')
    mockRunResolvedCommand.mockResolvedValue({
      stdout: "--model <model> Provide an alias such as 'fable', 'opus', or 'sonnet'",
      stderr: '',
      exitCode: 0,
    })
    mockResolveBuiltinCommand.mockReturnValue({
      command: 'claude',
      args: [],
      display: 'claude',
      kind: 'native',
      path: '/usr/local/bin/claude',
    })
  })

  it('returns conservative Claude aliases without PTY probing', async () => {
    const models = await discoverModelsForAgent(
      { type: 'claude', command: 'claude', args: [], version: '2.1.72' },
      {},
    )

    expect(mockRunResolvedCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'claude' }),
      ['--help'],
      3_000,
    )
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
  })

  it('hides Fable when an older Claude Code help page does not advertise it', async () => {
    mockRunResolvedCommand.mockResolvedValue({
      stdout: "--model <model> Provide an alias such as 'opus' or 'sonnet'",
      stderr: '',
      exitCode: 0,
    })

    const models = await discoverModelsForAgent(
      { type: 'claude', command: 'claude', args: [], version: '2.0.0' },
      {},
    )

    expect(models.some((model) => model.id === 'fable')).toBe(false)
  })

  it('returns DeepSeek provider models from Claude Code shell env overrides', async () => {
    mockReadLatestUserEnv.mockReturnValue({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
    })

    const models = await discoverModelsForAgent(
      { type: 'claude', command: 'claude', args: [], version: '2.1.72' },
      {},
    )

    expect(models.map((model) => model.id)).toEqual(['deepseek-v4-pro[1m]', 'deepseek-v4-flash'])
    expect(models[0]).toMatchObject({
      id: 'deepseek-v4-pro[1m]',
      provider: 'deepseek',
      isDefault: true,
      defaultReasoningEffort: 'max',
    })
    expect(mockRunResolvedCommand).not.toHaveBeenCalled()
  })

  it('returns no Claude models when the binary is not installed', async () => {
    mockResolveBuiltinCommand.mockReturnValueOnce(null)
    const models = await discoverModelsForAgent(
      { type: 'claude', command: 'claude', args: [], version: '2.1.72' },
      {},
    )

    expect(models).toEqual([])
  })
})

describe('discoverCodexModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveBuiltinCommand.mockReturnValue({
      command: 'codex',
      args: [],
      display: 'codex',
      kind: 'native',
      path: '/usr/local/bin/codex',
    })
  })

  it('uses app-server model/list and supplements current Codex models without PTY fallback', async () => {
    const stdout = new PassThrough()
    const stdin = new PassThrough()
    const proc = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      kill: ReturnType<typeof vi.fn>
    }
    proc.stdin = stdin
    proc.stdout = stdout
    proc.kill = vi.fn()
    const requests: Array<{ id: number; method: string; params?: unknown }> = []

    stdin.on('data', (chunk) => {
      const lines = chunk.toString().trim().split('\n').filter(Boolean)
      for (const line of lines) {
        const msg = JSON.parse(line) as { id: number; method: string; params?: unknown }
        requests.push(msg)
        if (msg.method === 'initialize') {
          stdout.write(`${JSON.stringify({ id: msg.id, result: {} })}\n`)
        } else if (msg.method === 'model/list') {
          stdout.write(`${JSON.stringify({
            id: msg.id,
            result: {
              data: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }],
            },
          })}\n`)
        } else if (msg.method === 'config/read') {
          stdout.write(`${JSON.stringify({
            id: msg.id,
            result: { config: { model: 'gpt-5-codex' } },
          })}\n`)
        }
      }
    })

    mockSpawnResolvedCommand.mockReturnValue(proc)

    const models = await discoverModelsForAgent(
      { type: 'codex', command: 'codex', args: [], version: '0.125.0' },
      {},
    )

    expect(requests.find((request) => request.method === 'initialize')?.params).toEqual({
      clientInfo: { name: 'codex-tui', title: 'Codex TUI', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    })
    expect(models.map((model) => model.id)).toEqual([
      'gpt-5-codex',
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ])
  })

  it('surfaces a non-cacheable emergency list when app-server discovery fails', async () => {
    mockSpawnResolvedCommand.mockImplementation(() => {
      throw new Error('app-server unavailable')
    })

    const error = await discoverModelsForAgent(
        { type: 'codex', command: 'codex', args: [], version: '0.125.0' },
        {},
      )
      .then(() => null)
      .catch((value: unknown) => value)

    expect(error).toBeInstanceOf(ModelDiscoveryFallbackError)
    expect(error).toMatchObject({
      agentType: 'codex',
      failureCode: 'app_server_unavailable',
    })
    expect((error as ModelDiscoveryFallbackError).fallbackModels.map((model) => model.id)).toEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ])
    expect((error as ModelDiscoveryFallbackError).fallbackModels[0]).toMatchObject({
      id: 'gpt-6-astra',
      isDefault: true,
      defaultReasoningEffort: 'medium',
    })
  })
})

describe('discoverGeminiModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveBuiltinCommand.mockReturnValue({
      command: 'gemini',
      args: [],
      display: 'gemini',
      kind: 'native',
      path: '/usr/local/bin/gemini',
    })
  })

  it('returns conservative Gemini models without PTY probing', async () => {
    const models = await discoverModelsForAgent(
      { type: 'gemini', command: 'gemini', args: [], version: '0.1.0' },
      {},
    )

    expect(mockRunResolvedCommand).not.toHaveBeenCalled()
    expect(models.map((model) => model.id)).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'auto-gemini-2.5',
    ])
  })
})

describe('discoverPiModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps same-name Pi models distinct by provider and identifies the exact default', async () => {
    mockResolveBuiltinCommand.mockReturnValue({ command: 'pi', args: [], kind: 'native' })
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const proc = Object.assign(new EventEmitter(), { stdin, stdout, kill: vi.fn() })
    const available = ['provider-a', 'provider-b'].map((provider) => ({
      provider, id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', reasoning: false,
    }))
    stdin.on('data', (chunk) => {
      for (const line of chunk.toString().trim().split('\n')) {
        const request = JSON.parse(line)
        const data = request.type === 'get_available_models'
          ? { models: available }
          : { model: available[1] }
        stdout.write(`${JSON.stringify({ type: 'response', id: request.id, success: true, data })}\n`)
      }
    })
    mockSpawnResolvedCommand.mockReturnValue(proc)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const models = await discoverModelsForAgent({ type: 'pi-coding-agent', command: 'pi', args: [] }, {})
    expect(models).toEqual([
      { id: 'provider-a/deepseek-flash', name: 'DeepSeek V4.1 Flash', provider: 'provider-a', isDefault: false },
      { id: 'provider-b/deepseek-flash', name: 'DeepSeek V4.1 Flash', provider: 'provider-b', isDefault: true },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('loads Nian models from the production API path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', provider: 'dashscope' },
        ],
        default: 'qwen3.6-plus',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const models = await discoverModelsForAgent(
      { type: 'pi', command: 'shennian', args: [] },
      { serverUrl: 'https://shennian.net/', authToken: 'machine-token' },
    )

    expect(fetchMock).toHaveBeenCalledWith('https://shennian.net/api/models', {
      headers: { Authorization: 'Bearer machine-token' },
    })
    expect(models.map((model) => model.id)).toEqual(['qwen3.6-plus'])
    expect(models[0]?.isDefault).toBe(true)
  })

  it('falls back to built-in Nian models when discovery fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    }))

    const models = await discoverModelsForAgent(
      { type: 'pi', command: 'shennian', args: [] },
      { serverUrl: 'https://shennian.net', authToken: 'machine-token' },
    )

    expect(models.map((model) => model.id)).toEqual(['qwen3.6-plus'])
    expect(models[0]?.isDefault).toBe(true)
  })
})
