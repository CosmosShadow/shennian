// @arch open-source/docs/cli-runtime.md
// @covers src/agents/claude.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentEvent } from '../agents/adapter.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import {
  ClaudeAdapter,
  normalizeClaudeModelId,
  normalizeClaudeReasoningEffort,
  resetClaudeCapabilityCacheForTests,
  resolveClaudeShennianCliReadPaths,
  shouldForwardClaudeStderrLine,
  supportsClaudeReasoningEffort,
} from '../agents/claude.js'
import { composeManagedRoomPrompt } from '../room/managed-prompt-composer.js'

const mockResolveBuiltinCommand = vi.hoisted(() => vi.fn())
const mockSpawnResolvedCommandSync = vi.hoisted(() => vi.fn())

vi.mock('../agents/command-spec.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/command-spec.js')>()
  return {
    ...actual,
    resolveBuiltinCommand: mockResolveBuiltinCommand,
    spawnResolvedCommandSync: mockSpawnResolvedCommandSync,
  }
})

const CLAUDE_SPEC = {
  command: 'claude',
  args: [],
  display: 'claude',
  kind: 'native' as const,
  path: '/usr/local/bin/claude',
}

type TestableClaudeAdapter = {
  runId: string
  seq: number
  agentSessionId: string | null
  pendingSuccess: unknown
  handleStreamEvent(obj: unknown): void
  handleProcessClose(code: number | null, stderrBuf: string): void
  killProcess(): Promise<void>
  spawnAndParse(args: string[]): void
  buildProcessEnv(): NodeJS.ProcessEnv
}

function compiledManagedPolicy(workDir: string): CompiledManagedAgentPolicy {
  const externalCapabilities = {
    commandNetwork: false,
    webSearch: false,
    browser: false,
    computerUse: false,
    mcp: false,
  }
  const effectivePolicy = {
    version: 4,
    fileAccess: 'workspace-write' as const,
    externalCapabilities,
  }
  return {
    requestedPolicy: effectivePolicy,
    enforcement: {
      level: 'hard',
      effectivePolicy,
      unsupportedCapabilities: [],
      runtimeVersion: '2.1.260',
      platform: 'darwin',
    },
    adapterPolicy: {
      version: 4,
      workDir,
      fileAccess: 'workspace-write',
      externalCapabilities,
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY'],
      sessionEnvKeys: ['SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
      shellSubprocess: {
        inherit: 'none',
        allowedEnvKeys: [
          'PATH',
          'HOME',
          'SHENNIAN_MANAGED_ROOM_CONTEXT',
          'SHENNIAN_MANAGED_ROOM_IPC_ROOT',
        ],
        deniedEnvKeys: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY'],
      },
    },
  }
}

function createHarness() {
  const adapter = new ClaudeAdapter()
  const internal = adapter as unknown as TestableClaudeAdapter
  internal.runId = 'run-claude-test'
  internal.seq = 0

  const events: AgentEvent[] = []
  adapter.on('agentEvent', (event) => events.push(event))

  return { internal, events }
}

describe('ClaudeAdapter', () => {
  beforeEach(() => {
    resetClaudeCapabilityCacheForTests()
    mockResolveBuiltinCommand.mockReturnValue(CLAUDE_SPEC)
    mockSpawnResolvedCommandSync.mockReturnValue({
      status: 0,
      stdout: '--effort <level>',
      stderr: '',
    })
  })

  it('normalizes missing Claude model ids to the stable default alias', () => {
    expect(normalizeClaudeModelId()).toBe('default')
    expect(normalizeClaudeModelId('')).toBe('default')
    expect(normalizeClaudeModelId('   ')).toBe('default')
    expect(normalizeClaudeModelId('sonnet')).toBe('sonnet')
  })

  it('validates Claude reasoning effort values', () => {
    expect(normalizeClaudeReasoningEffort(' medium ')).toBe('medium')
    expect(normalizeClaudeReasoningEffort(null)).toBeUndefined()
    expect(() => normalizeClaudeReasoningEffort('extreme')).toThrow(
      'Unsupported Claude reasoning effort "extreme"',
    )
  })

  it('disables native session persistence only when explicitly requested', async () => {
    const adapter = new ClaudeAdapter()
    const internal = adapter as unknown as TestableClaudeAdapter
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()
    await adapter.start('test-claude', '/tmp', null, { persistNativeSession: false })

    await adapter.send('test prompt')

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining(['--no-session-persistence']),
    )
  })

  it('fails closed when a managed Room activation has no compiled policy', async () => {
    const adapter = new ClaudeAdapter()
    await expect(
      adapter.send('untrusted Room message', undefined, undefined, undefined, undefined, {
        source: 'room_activation',
      }),
    ).rejects.toThrow('managed_agent_policy_missing')
  })

  it('uses invocation-scoped Claude restrictions and an allowlisted process environment', async () => {
    const workDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'shennian-claude-adapter-'),
    )
    try {
      const adapter = new ClaudeAdapter()
      const internal = adapter as unknown as TestableClaudeAdapter
      internal.killProcess = vi.fn(async () => {})
      internal.spawnAndParse = vi.fn()
      adapter.configure({
        managedAgentPolicy: compiledManagedPolicy(workDir),
        env: {
          ANTHROPIC_API_KEY: 'provider-secret',
          SHENNIAN_MANAGED_ROOM_CONTEXT: 'room-capability',
          SHOULD_NOT_LEAK: 'daemon-secret',
        },
      })
      await adapter.start('managed-room', workDir)

      await adapter.send(
        'untrusted Room message',
        'sonnet',
        undefined,
        undefined,
        'managed system prompt',
        { source: 'room_activation' },
      )

      const args = vi.mocked(internal.spawnAndParse).mock.calls[0]?.[0] ?? []
      expect(args).toEqual(
        expect.arrayContaining([
          '--restricted',
          '--setting-sources',
          '',
          '--permission-mode',
          'dontAsk',
          '--strict-mcp-config',
          '--no-chrome',
        ]),
      )
      expect(args).not.toContain('--dangerously-skip-permissions')

      const env = internal.buildProcessEnv()
      expect(env.ANTHROPIC_API_KEY).toBe('provider-secret')
      expect(env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBe('room-capability')
      expect(env.SHOULD_NOT_LEAK).toBeUndefined()
      expect(env.NO_COLOR).toBe('1')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('allows the installed Shennian package root so Claude can load CLI dependencies', async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'shennian-claude-cli-runtime-'),
    )
    const packageRoot = path.join(root, 'lib', 'node_modules', 'shennian')
    const executable = path.join(packageRoot, 'dist', 'bin', 'shennian.js')
    const commandPath = path.join(root, 'bin', 'shennian')
    const workDir = path.join(root, 'workspace')
    try {
      fs.mkdirSync(path.dirname(executable), { recursive: true })
      fs.mkdirSync(path.join(packageRoot, 'node_modules', 'commander'), { recursive: true })
      fs.mkdirSync(path.dirname(commandPath), { recursive: true })
      fs.mkdirSync(workDir)
      fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'shennian' }))
      fs.writeFileSync(executable, '#!/usr/bin/env node\n')
      fs.symlinkSync(executable, commandPath)

      expect(resolveClaudeShennianCliReadPaths(commandPath)).toEqual(
        expect.arrayContaining([commandPath, executable, packageRoot]),
      )
      expect(resolveClaudeShennianCliReadPaths(commandPath)).not.toContain(
        path.join(root, 'lib', 'node_modules'),
      )

      mockResolveBuiltinCommand.mockImplementation((agentType: string) =>
        agentType === 'pi'
          ? { ...CLAUDE_SPEC, command: 'shennian', display: 'shennian', path: commandPath }
          : CLAUDE_SPEC,
      )
      const adapter = new ClaudeAdapter()
      const internal = adapter as unknown as TestableClaudeAdapter
      internal.killProcess = vi.fn(async () => {})
      internal.spawnAndParse = vi.fn()
      adapter.configure({ managedAgentPolicy: compiledManagedPolicy(workDir) })
      await adapter.start('managed-room', workDir)

      await adapter.send('reply in the Room', 'sonnet', undefined, undefined, 'managed prompt', {
        source: 'room_activation',
      })

      const args = vi.mocked(internal.spawnAndParse).mock.calls[0]?.[0] ?? []
      const settings = JSON.parse(args[args.indexOf('--settings') + 1]) as {
        sandbox: { filesystem: { allowRead: string[] } }
      }
      expect(settings.sandbox.filesystem.allowRead).toContain(packageRoot)
      expect(settings.sandbox.filesystem.allowRead).not.toContain(
        path.join(root, 'lib', 'node_modules'),
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the Room CLI and daemon socket out of public visitor turns', async () => {
    const workDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'shennian-claude-public-'),
    )
    try {
      const adapter = new ClaudeAdapter()
      const internal = adapter as unknown as TestableClaudeAdapter
      internal.killProcess = vi.fn(async () => {})
      internal.spawnAndParse = vi.fn()
      const policy = compiledManagedPolicy(workDir)
      policy.enforcement.executableFingerprint = 'claude-test-fingerprint'
      policy.requestedPolicy.fileAccess = 'workspace-read'
      policy.enforcement.effectivePolicy.fileAccess = 'workspace-read'
      policy.adapterPolicy.fileAccess = 'workspace-read'
      adapter.configure({ managedAgentPolicy: policy, env: {} })
      await adapter.start('published-conversation', workDir)

      await adapter.send('visitor message', undefined, undefined, undefined, undefined, {
        source: 'published_agent',
      })

      const args = vi.mocked(internal.spawnAndParse).mock.calls[0]?.[0] ?? []
      const settings = JSON.parse(args[args.indexOf('--settings') + 1]) as {
        sandbox: {
          filesystem: { allowRead: string[] }
          network: { allowUnixSockets: string[]; allowAllUnixSockets: boolean }
        }
      }
      expect(settings.sandbox.filesystem.allowRead).toEqual([workDir])
      expect(settings.sandbox.network.allowUnixSockets).toEqual([])
      expect(settings.sandbox.network.allowAllUnixSockets).toBe(false)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('routes a native-full managed session through the phone-answerable MCP permission relay instead of bypassing permissions', async () => {
    const workDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'shennian-claude-native-full-'),
    )
    const adapter = new ClaudeAdapter()
    const internal = adapter as unknown as TestableClaudeAdapter & { permissionBridge: { stop(): Promise<void> } | null }
    try {
      internal.killProcess = vi.fn(async () => {})
      internal.spawnAndParse = vi.fn()
      const policy = compiledManagedPolicy(workDir)
      policy.executionMode = 'native-full'
      policy.requestedPolicy.executionMode = 'native-full'
      adapter.configure({ managedAgentPolicy: policy })
      await adapter.start('managed-native-full', workDir)

      await adapter.send('do something risky', 'sonnet', undefined, undefined, undefined, {
        source: 'room_activation',
      })

      const args = vi.mocked(internal.spawnAndParse).mock.calls[0]?.[0] ?? []
      expect(args).not.toContain('--dangerously-skip-permissions')
      expect(args).toEqual(expect.arrayContaining(['--disallowedTools', 'AskUserQuestion']))
      expect(args).toContain('--permission-prompts')
      expect(args[args.indexOf('--permission-prompts') + 1]).toBe('host')
      expect(args).toContain('--permission-prompt-tool')
      expect(args[args.indexOf('--permission-prompt-tool') + 1]).toBe('mcp__shennianPermission__approve')
      const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1]) as {
        mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
      }
      const server = mcpConfig.mcpServers.shennianPermission
      expect(server.command).toBe(process.execPath)
      expect(server.args[0]).toMatch(/claude-permission-relay-server\.js$/)
      expect(server.env.SHENNIAN_CLAUDE_PERMISSION_SOCKET).toBeTruthy()
    } finally {
      await internal.permissionBridge?.stop()
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('resolves a pending Claude permission request only once the phone answers it', async () => {
    const { internal, events } = createHarness()
    const withPermission = internal as unknown as TestableClaudeAdapter & {
      requestClaudePermission(toolName: unknown, input: unknown): Promise<{ behavior: string }>
      respondToPermission(permissionId: string, optionId: string): Promise<void>
    }

    const decision = withPermission.requestClaudePermission('Write', { file_path: '/tmp/x', content: 'hi' })
    const pending = events.find((event) => event.state === 'approval-pending')
    expect(pending?.approval).toEqual(
      expect.objectContaining({ title: 'Write', content: '/tmp/x', source: 'claude' }),
    )
    expect(pending?.permission?.options.map((option) => option.id)).toEqual(['allow', 'deny'])

    await withPermission.respondToPermission(pending!.permission!.id, 'allow')
    await expect(decision).resolves.toEqual({ behavior: 'allow' })
    await expect(withPermission.respondToPermission(pending!.permission!.id, 'allow')).rejects.toThrow(
      'no longer pending',
    )
  })

  it('detects whether the installed Claude CLI supports reasoning effort', () => {
    mockSpawnResolvedCommandSync.mockReturnValueOnce({
      status: 0,
      stdout: 'Usage: claude\n  --model <model>',
      stderr: '',
    })
    expect(supportsClaudeReasoningEffort()).toBe(false)

    resetClaudeCapabilityCacheForTests()
    mockSpawnResolvedCommandSync.mockReturnValueOnce({
      status: 0,
      stdout: 'Usage: claude\n  --effort <level>',
      stderr: '',
    })
    expect(supportsClaudeReasoningEffort()).toBe(true)
    expect(mockSpawnResolvedCommandSync).toHaveBeenLastCalledWith(
      CLAUDE_SPEC,
      ['--help'],
      expect.objectContaining({ env: process.env, timeout: 3000 }),
    )
  })

  it('emits final only once when success is followed by process close fallback', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'result',
      subtype: 'success',
      session_id: 'claude-session-1',
      result: 'completed response',
      usage: { input_tokens: 12, output_tokens: 34 },
    })
    expect(events.some((event) => event.state === 'final')).toBe(false)
    internal.handleProcessClose(0, '')

    expect(events.filter((event) => event.state === 'final')).toEqual([
      expect.objectContaining({
        state: 'final',
        agentSessionId: 'claude-session-1',
        usage: { inputTokens: 12, outputTokens: 34 },
      }),
    ])
  })

  it('pairs a tool_result user frame with its tool_use so the card completes', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/x' } },
        ],
      },
    })
    internal.handleStreamEvent({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt\nb.txt' },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_2',
            is_error: true,
            content: [{ type: 'text', text: 'ENOENT' }, { type: 'image', source: {} }],
          },
        ],
      },
    })

    expect(events.filter((event) => event.state !== 'delta')).toEqual([
      expect.objectContaining({ state: 'tool-call', name: 'Bash', toolCallId: 'toolu_1' }),
      expect.objectContaining({ state: 'tool-call', name: 'Read', toolCallId: 'toolu_2' }),
      expect.objectContaining({
        state: 'tool-result',
        name: 'Bash',
        toolCallId: 'toolu_1',
        toolStatus: 'completed',
        result: 'a.txt\nb.txt',
      }),
      expect.objectContaining({
        state: 'tool-result',
        name: 'Read',
        toolCallId: 'toolu_2',
        toolStatus: 'failed',
        result: 'ENOENT\n[image]',
      }),
    ])
  })

  it('uses the structured success result when the assistant stream omitted its text frame', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'result',
      subtype: 'success',
      session_id: 'claude-session-result-only',
      result: 'provider final answer',
    })
    internal.handleProcessClose(0, '')

    expect(events).toEqual([
      expect.objectContaining({ state: 'delta', text: 'provider final answer' }),
      expect.objectContaining({ state: 'final', agentSessionId: 'claude-session-result-only' }),
    ])
  })

  it('reports an empty structured success as an error when the stream closes', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'result',
      subtype: 'success',
      session_id: 'claude-session-empty',
      result: '',
    })
    expect(events).toEqual([])
    internal.handleProcessClose(0, '')

    expect(events).toEqual([
      expect.objectContaining({
        state: 'error',
        message: 'Claude completed without response text',
      }),
    ])
  })

  it('never lets a usage-only success overtake a later assistant text frame', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'system', subtype: 'init', session_id: 'claude-session-late-text',
    })
    internal.handleStreamEvent({
      type: 'result', subtype: 'success', session_id: 'claude-session-late-text',
      usage: { input_tokens: 8, output_tokens: 1 },
    })
    internal.handleStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    })

    expect(events.map((event) => event.state)).toEqual(['start', 'delta'])
    internal.handleProcessClose(0, '')
    expect(events.map((event) => event.state)).toEqual(['start', 'delta', 'final'])
    expect(events.at(-1)).toMatchObject({
      agentSessionId: 'claude-session-late-text',
      usage: { inputTokens: 8, outputTokens: 1 },
    })
  })

  it('reports a clean process close with no response as an error', () => {
    const { internal, events } = createHarness()
    internal.agentSessionId = 'claude-session-2'

    internal.handleProcessClose(0, '')

    expect(events).toEqual([
      expect.objectContaining({ state: 'error', message: 'Claude completed without response text' }),
    ])
  })

  it('suppresses close fallback errors after a terminal stream error', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'result',
      subtype: 'error',
      error: 'rate limited',
    })
    internal.handleProcessClose(1, 'claude exited with code 1')

    expect(events.filter((event) => event.state === 'error')).toEqual([
      expect.objectContaining({
        state: 'error',
        message: 'rate limited',
      }),
    ])
  })

  it('keeps authentication_failed api retries non-terminal when Claude recovers', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'system',
      subtype: 'api_retry',
      error: 'authentication_failed',
      error_status: 401,
    })
    internal.handleStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'recovered result' }] },
    })
    internal.handleStreamEvent({ type: 'result', subtype: 'success', result: 'recovered result' })
    internal.handleProcessClose(0, '')

    expect(events.filter((event) => event.state === 'error')).toEqual([])
    expect(events.map((event) => event.state)).toEqual(['heartbeat', 'delta', 'final'])
    expect(events[0]).toMatchObject({ errorCode: 'auth_retrying', runPhase: 'thinking' })
  })

  it('reports authentication retry exhaustion only when the process fails', () => {
    const { internal, events } = createHarness()
    internal.handleStreamEvent({
      type: 'system', subtype: 'api_retry', error: 'authentication_failed', error_status: 401,
    })
    internal.handleProcessClose(1, 'authentication failed')

    expect(events.filter((event) => event.state === 'error')).toEqual([
      expect.objectContaining({
        state: 'error',
        message: 'authentication failed',
        errorCode: 'auth_required',
      }),
    ])
  })

  it('suppresses the harmless connector warning when API credentials are configured', () => {
    expect(
      shouldForwardClaudeStderrLine(
        '⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set',
      ),
    ).toBe(false)
    expect(shouldForwardClaudeStderrLine('authentication failed')).toBe(true)
  })

  it('injects manager instructions through Claude system prompt flags', async () => {
    const adapter = new ClaudeAdapter({ systemPrompt: 'stable manager instructions', hidden: true })
    const internal = adapter as unknown as TestableClaudeAdapter
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()

    await adapter.send('列出 worker', 'sonnet', 'high')

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining([
        '-p',
        '列出 worker',
        '--append-system-prompt',
        'stable manager instructions',
        '--name',
        'Shennian Manager Substrate',
        '--model',
        'sonnet',
        '--effort',
        'high',
      ]),
    )
  })

  it('keeps a managed Room prompt in the system channel and the Room message in user input', async () => {
    const adapter = new ClaudeAdapter()
    const internal = adapter as unknown as TestableClaudeAdapter
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()
    const managed = composeManagedRoomPrompt({
      agent: { displayName: '研发助手', systemPrompt: '先核对事实，再简洁回答。' },
      room: { name: '研发群', activationMode: 'auto_follow', members: [] },
    }).systemPrompt
    const roomMessage = '[群消息] <李辰>\n请发送周报和两份附件。'

    await adapter.send(roomMessage, 'sonnet', undefined, undefined, managed)

    const args = vi.mocked(internal.spawnAndParse).mock.calls[0]?.[0] ?? []
    expect(args.slice(0, 2)).toEqual(['-p', roomMessage])
    const systemPrompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(systemPrompt).toContain('先核对事实，再简洁回答。')
    expect(systemPrompt).toContain('shennian room send [--text <内容>] [--file <本地文件路径> ...]')
    expect(systemPrompt).not.toContain(roomMessage)
    expect(systemPrompt.indexOf('[神念受管会话规则]')).toBeLessThan(
      systemPrompt.indexOf('[智能体私有系统提示词]'),
    )
    expect(systemPrompt.indexOf('[智能体私有系统提示词]')).toBeLessThan(
      systemPrompt.indexOf('[当前群聊]'),
    )
  })

  it('omits Claude reasoning effort for older Claude CLI builds', async () => {
    mockSpawnResolvedCommandSync.mockReturnValueOnce({
      status: 0,
      stdout: 'Usage: claude\n  --model <model>',
      stderr: '',
    })
    const adapter = new ClaudeAdapter({ systemPrompt: 'stable manager instructions' })
    const internal = adapter as unknown as TestableClaudeAdapter
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()

    await adapter.send('列出 worker', 'sonnet', 'high')

    const args = vi.mocked(internal.spawnAndParse).mock.calls[0]?.[0] ?? []
    expect(args).toContain('--model')
    expect(args).toContain('sonnet')
    expect(args).not.toContain('--effort')
  })

  it('passes Claude reasoning effort when the installed Claude CLI supports it', async () => {
    const adapter = new ClaudeAdapter({ systemPrompt: 'stable manager instructions' })
    const internal = adapter as unknown as TestableClaudeAdapter
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()

    await adapter.send('列出 worker', 'sonnet', 'high')

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining(['--effort', 'high']),
    )
  })

  it('injects Shennian file-link output rules for normal Claude sessions', async () => {
    const adapter = new ClaudeAdapter()
    const internal = adapter as unknown as TestableClaudeAdapter
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()
    await adapter.start('normal-session', '/repo')

    await adapter.send('生成 HTML 文件', 'sonnet')

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining([
        '--append-system-prompt',
        expect.stringContaining('Do not use file:// URLs for local files.'),
      ]),
    )
  })
})
