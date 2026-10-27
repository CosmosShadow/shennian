// @arch open-source/docs/cli-runtime.md
// @covers src/agents/workbuddy.ts

import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'

import {
  normalizeWorkBuddyModelId,
  normalizeWorkBuddyReasoningEffort,
  sanitizeWorkBuddyError,
  terminateWorkBuddyProcess,
  workBuddyRoomActivationText,
  workBuddySystemPromptArgs,
  WorkBuddyAdapter,
} from '../agents/workbuddy.js'
import { composeManagedRoomPrompt } from '../room/managed-prompt-composer.js'

type TestableWorkBuddyAdapter = {
  runId: string
  seq: number
  agentSessionId: string | null
  terminalState: 'open' | 'final' | 'error'
  handleStreamEvent(event: unknown): void
  handleProcessClose(code: number | null, stderr: string): void
  killProcess(): Promise<void>
  spawnAndParse(args: string[]): void
  buildProcessEnv(): NodeJS.ProcessEnv
}

function compiledManagedPolicy(): CompiledManagedAgentPolicy {
  const workDir = fs.realpathSync(process.cwd())
  const policy = {
    version: 1,
    fileAccess: 'workspace-write' as const,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  }
  return {
    requestedPolicy: policy,
    enforcement: {
      level: 'partial',
      effectivePolicy: policy,
      unsupportedCapabilities: ['fileAccess.outsideWorkspaceRead'],
      runtimeVersion: '2.115.0',
      platform: 'darwin',
    },
    adapterPolicy: {
      version: 1,
      workDir,
      fileAccess: 'workspace-write',
      externalCapabilities: { ...policy.externalCapabilities },
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: [],
      sessionEnvKeys: ['SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
      shellSubprocess: {
        inherit: 'none',
        allowedEnvKeys: ['PATH', 'SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
        deniedEnvKeys: [],
      },
    },
  }
}

function createHarness() {
  const adapter = new WorkBuddyAdapter()
  const internal = adapter as unknown as TestableWorkBuddyAdapter
  internal.runId = 'workbuddy-run'
  internal.seq = 0
  internal.terminalState = 'open'
  const events: AgentEvent[] = []
  adapter.on('agentEvent', (event) => events.push(event))
  return { adapter, internal, events }
}

describe('WorkBuddyAdapter', () => {
  it('uses stable public WorkBuddy defaults and validates effort', () => {
    expect(normalizeWorkBuddyModelId()).toBeUndefined()
    expect(normalizeWorkBuddyModelId(' auto ')).toBeUndefined()
    expect(normalizeWorkBuddyModelId(' kimi-k2.5 ')).toBe('kimi-k2.5')
    expect(normalizeWorkBuddyReasoningEffort(' medium ')).toBe('medium')
    expect(normalizeWorkBuddyReasoningEffort()).toBeUndefined()
    expect(() => normalizeWorkBuddyReasoningEffort('ultra')).toThrow(
      'Unsupported WorkBuddy reasoning effort',
    )
  })

  it('starts the structured CLI with usable built-in tools and an exact resume id', async () => {
    const { adapter, internal } = createHarness()
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()
    await adapter.start('nian-session', '/repo', 'workbuddy-session-1')

    await adapter.send('继续工作', 'auto', 'high')

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining([
        '-p',
        '继续工作',
        '--output-format',
        'stream-json',
        '--permission-mode',
        'bypassPermissions',
        '--setting-sources',
        'user,project,local',
        '--tools',
        'default',
        '--effort',
        'high',
        '--resume',
        'workbuddy-session-1',
      ]),
    )
    const args = (internal.spawnAndParse as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(args).not.toContain('--model')
  })

  it('passes through an explicitly selected concrete WorkBuddy model', async () => {
    const { adapter, internal } = createHarness()
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()
    await adapter.start('nian-session', '/repo')

    await adapter.send('继续工作', ' kimi-k2.5 ')

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining(['--model', 'kimi-k2.5']),
    )
  })

  it('disables native session persistence only when explicitly requested', async () => {
    const { adapter, internal } = createHarness()
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()
    await adapter.start('test-workbuddy', '/tmp', null, { persistNativeSession: false })

    await adapter.send('test prompt')

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining(['--no-session-persistence']),
    )
  })

  it('keeps the Windows managed bootstrap command below the cmd.exe limit', async () => {
    const { adapter, internal } = createHarness()
    internal.spawnAndParse = vi.fn()
    adapter.configure({
      sessionId: 'room-managed-bootstrap-1',
      managedAgentPolicy: compiledManagedPolicy(),
    })
    await adapter.start('room-managed-bootstrap-1', '/repo')

    await adapter.send('初始化受管 Agent 对话', 'auto')

    const args = (internal.spawnAndParse as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(args).not.toContain('--append-system-prompt')
    expect(args).not.toContain('bypassPermissions')
    await adapter.stop()
  })

  it('passes Windows Room instructions by file instead of the cmd.exe command line', () => {
    const prompt = 'x'.repeat(12_000)
    expect(workBuddySystemPromptArgs(prompt, 'win32', 'C:\\private\\room-prompt.md')).toEqual([
      '--system-prompt-file',
      'C:\\private\\room-prompt.md',
    ])
    expect(workBuddySystemPromptArgs(prompt, 'win32', 'C:\\private\\room-prompt.md')).not.toContain(
      prompt,
    )
    expect(workBuddySystemPromptArgs('short', 'darwin')).toEqual([
      '--append-system-prompt',
      'short',
    ])
  })

  it('delivers only the addressed Room block without the CodeBuddy-conflicting speaker envelope', () => {
    expect(
      workBuddyRoomActivationText(
        '[群消息]\n<甲>\n前置上下文\n\n<Windows WorkBuddy>\n@Windows WorkBuddy Reply exactly OK',
      ),
    ).toBe('@Windows WorkBuddy Reply exactly OK')
    expect(workBuddyRoomActivationText('[群消息] <甲>\n单条消息')).toBe('单条消息')
  })

  it('terminates the complete WorkBuddy process tree on Windows', () => {
    const kill = vi.fn()
    const terminateTree = vi.fn(() => true)

    terminateWorkBuddyProcess({ pid: 4321, kill }, 'win32', terminateTree)

    expect(terminateTree).toHaveBeenCalledWith(4321)
    expect(kill).not.toHaveBeenCalled()
  })

  it('falls back to the child process signal when tree termination is unavailable', () => {
    const kill = vi.fn()

    terminateWorkBuddyProcess({ pid: 4321, kill }, 'win32', () => false)

    expect(kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('uses the native sandbox and strict empty MCP config for a daemon-managed activation', async () => {
    const { adapter, internal } = createHarness()
    internal.spawnAndParse = vi.fn()
    adapter.configure({ managedAgentPolicy: compiledManagedPolicy() })
    await adapter.start('nian-session', '/repo', 'workbuddy-session-1')

    await adapter.send('处理群聊消息', 'auto', undefined, undefined, '只处理当前 Room 激活。', {
      source: 'room_activation',
    })

    expect(internal.spawnAndParse).toHaveBeenCalledWith(
      expect.arrayContaining([
        '--permission-mode',
        'dontAsk',
        '--strict-mcp-config',
        '--mcp-config',
        '{}',
        '--max-turns',
        '8',
      ]),
    )
    const args = (internal.spawnAndParse as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(args).not.toContain('bypassPermissions')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('none')
    expect(args[args.indexOf('--tools') + 1]).toContain('Bash')
    expect(args[args.indexOf('--tools') + 1]).toContain('Read')
    expect(args).not.toContain('--plugin-dir')
    await adapter.stop()
  })

  it('preserves the managed Room layers and multi-file CLI command outside the user message', async () => {
    const { adapter, internal } = createHarness()
    internal.spawnAndParse = vi.fn()
    adapter.configure({ managedAgentPolicy: compiledManagedPolicy() })
    await adapter.start('nian-session', '/repo', 'workbuddy-session-1')
    const managed = composeManagedRoomPrompt({
      agent: { displayName: '发布助手', systemPrompt: '发布前必须检查变更。' },
      room: { name: '发布群', activationMode: 'mention_only', members: [] },
    }).systemPrompt
    const roomMessage = '[群消息] <李辰>\n@发布助手 请发送结果和两个文件。'

    await adapter.send(roomMessage, 'auto', undefined, undefined, managed, {
      source: 'room_activation',
    })

    const args = (internal.spawnAndParse as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(args.slice(0, 2)).toEqual(['-p', '@发布助手 请发送结果和两个文件。'])
    const systemFlag =
      process.platform === 'win32' ? '--system-prompt-file' : '--append-system-prompt'
    const systemValue = args[args.indexOf(systemFlag) + 1]
    if (process.platform !== 'win32') {
      expect(systemValue).toContain('发布前必须检查变更。')
      expect(systemValue).toContain(
        'shennian room send [--text <内容>] [--file <本地文件路径> ...]',
      )
      expect(systemValue).not.toContain(roomMessage)
    }
    expect(args).toEqual(expect.arrayContaining(['--max-turns', '8', '--strict-mcp-config']))
    expect(args[args.indexOf('--tools') + 1]).toContain('Bash')
    expect(args).not.toContain('bypassPermissions')
    expect(args).not.toContain('--plugin-dir')
    await adapter.stop()
  })

  it('fails closed when a managed Room invocation has no compiled policy', async () => {
    const { adapter, internal } = createHarness()
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()
    await adapter.start('nian-session', '/repo', 'workbuddy-session-1')

    await expect(
      adapter.send('处理群聊消息', 'auto', undefined, undefined, '只处理当前 Room 激活。', {
        source: 'room_activation',
      }),
    ).rejects.toThrow('managed_agent_policy_missing')
    expect(internal.spawnAndParse).not.toHaveBeenCalled()
  })

  it('filters the daemon environment for managed WorkBuddy while keeping scoped Room context', async () => {
    const { adapter, internal } = createHarness()
    internal.spawnAndParse = vi.fn()
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(),
      env: {
        SHENNIAN_MANAGED_ROOM_CONTEXT: 'room-capability',
        DATABASE_URL: 'must-not-pass',
        AWS_SECRET_ACCESS_KEY: 'must-not-pass',
        CODEBUDDY_IS_SANDBOX: 'must-not-pass',
      },
    })
    await adapter.start('nian-session', '/repo', 'workbuddy-session-1')
    await adapter.send('处理群聊消息', 'auto', undefined, undefined, '只处理当前 Room 激活。', {
      source: 'room_activation',
    })

    const env = internal.buildProcessEnv()
    expect(env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBe('room-capability')
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.CODEBUDDY_IS_SANDBOX).toBeUndefined()
    expect(env.CODEBUDDY_DISABLE_SHELL_SNAPSHOT).toBe('1')
    await adapter.stop()
  })

  it('does not infer managed Room privileges from an ordinary system prompt', async () => {
    const { adapter, internal } = createHarness()
    internal.killProcess = vi.fn(async () => {})
    internal.spawnAndParse = vi.fn()
    await adapter.start('nian-session', '/repo')

    await adapter.send('普通消息', 'auto', undefined, undefined, '你是一个普通智能体。')

    const args = (internal.spawnAndParse as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
    expect(args).toEqual(expect.arrayContaining(['--permission-mode', 'bypassPermissions']))
    expect(args).toEqual(expect.arrayContaining(['--tools', 'default']))
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('--max-turns')
  })

  it('normalizes init, text, tool and final events while preserving the vendor session id', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({ type: 'system', subtype: 'init', session_id: 'wb-session-2' })
    internal.handleStreamEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '第一段' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/a.ts' } },
          { type: 'text', text: '第二段' },
        ],
      },
    })
    internal.handleStreamEvent({
      type: 'result',
      subtype: 'success',
      session_id: 'wb-session-2',
      usage: { input_tokens: 12, output_tokens: 8 },
    })
    internal.handleProcessClose(0, '')

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'start', agentSessionId: 'wb-session-2' }),
        expect.objectContaining({ state: 'delta', text: '第一段' }),
        expect.objectContaining({ state: 'tool-call', name: 'Read' }),
        expect.objectContaining({ state: 'delta', text: '\n\n第二段' }),
        expect.objectContaining({
          state: 'final',
          agentSessionId: 'wb-session-2',
          usage: { inputTokens: 12, outputTokens: 8 },
        }),
      ]),
    )
    expect(events.filter((event) => event.state === 'final')).toHaveLength(1)
  })

  it('maps structured permission requests without approving them', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'control_request',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'git status' } },
    })

    expect(events).toEqual([
      expect.objectContaining({
        state: 'approval-pending',
        name: 'Bash',
        args: { command: 'git status' },
        approval: expect.objectContaining({ source: 'workbuddy' }),
      }),
    ])
  })

  it('redacts credential-shaped stderr before it reaches the App', () => {
    expect(sanitizeWorkBuddyError('Authorization: Bearer secret-value')).toBe(
      'Authorization: Bearer [redacted]',
    )
    expect(sanitizeWorkBuddyError('connector_token=top-secret failed')).toBe(
      'connector_token=[redacted] failed',
    )
  })
})
