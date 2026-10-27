// @arch open-source/docs/cli-runtime.md
// @covers src/agents/codex.ts

import { CODEX_DESKTOP_SEND_UNAVAILABLE } from '@shennian/wire'
import fs from 'node:fs'
import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import type { CodexManagedRoomToolBinding } from '../agents/codex-managed-room-tools.js'
import {
  CodexAdapter,
  buildCodexQueueArgs,
  buildCodexQueuedText,
  isCodexActiveWriterError,
  isCodexExcludeTurnsUnsupportedError,
  isCodexPaginatedHistoryUnsupportedError,
  isCodexProjectApiUnsupportedError,
  isCodexUnsupportedEffortError,
  isMissingCodexRolloutError,
  normalizeCodexModelId,
  normalizeCodexReasoningEffort,
  selectCodexProjectIdForWorkDir,
} from '../agents/codex.js'
import { spawnEnoentError } from '../agents/spawn-errors.js'
import { composeManagedRoomPrompt } from '../room/managed-prompt-composer.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 0 })),
  }
})

type TestableCodexAdapter = {
  runId: string
  seq: number
  agentSessionId: string | null
  activeTurnId: string | null
  process: unknown
  appServerReady: Promise<void> | null
  appServerStartupError: Error | null
  agentSystemPrompt: string
  managedAgentPolicy: CompiledManagedAgentPolicy | null
  managedPermissionConfig: { profileId: string; threadConfig: Record<string, unknown> } | null
  managedRoomToolThreadId: string | null
  managedRoomCapabilityExpectedForTurn: boolean
  managedTurnReplay: {
    text: string
    modelId?: string
    reasoningEffort?: string
    attachments?: unknown[]
    recoveryCount: number
  } | null
  managedAsyncRecovery: Promise<void> | null
  buildProcessEnv(runtimeEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  configurationRestartRequired: boolean
  managedRoomTools: CodexManagedRoomToolBinding
  forceCloseTimer: NodeJS.Timeout | null
  handleAppServerNonJsonStdout(line: string): void
  handleAppServerMessage(msg: unknown): void
  handleStreamEvent(obj: unknown): void
  handleProcessClose(code: number | null, stderrBuf: string): void
  sendRpc(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  startTurnWithRecovery(
    threadId: string,
    text: string,
    codexModelId?: string,
    reasoningEffort?: string,
    attachments?: unknown[],
  ): Promise<{ turn?: { id?: string } }>
  startTurn(
    threadId: string,
    text: string,
    codexModelId?: string,
    reasoningEffort?: string,
    attachments?: unknown[],
  ): Promise<{ turn?: { id?: string } }>
  recoverManagedTurnAfterAsyncRolloutFailure(): Promise<void>
  initializeAppServer(modelId?: string): Promise<void>
  resolveCodexProjectId(): Promise<string | undefined>
  ensureAppServer(modelId?: string): Promise<void>
  spawnAppServer(): void
  interruptActiveTurn(): Promise<void>
  killProcess(preserveConfiguredManagedRoomContext?: boolean): Promise<void>
  enqueueForExternalOwner(
    threadId: string,
    text: string,
    attachments?: unknown[],
  ): Promise<string | undefined>
  getStatus(): Promise<{ active: boolean; runPhase?: string | null; canStop?: boolean }>
}

function compiledManagedPolicy(
  workDir: string,
  fileAccess: CompiledManagedAgentPolicy['adapterPolicy']['fileAccess'] = 'workspace-write',
  version = 3,
): CompiledManagedAgentPolicy {
  const externalCapabilities = {
    commandNetwork: false,
    webSearch: false,
    browser: false,
    computerUse: false,
    mcp: false,
  }
  const effectivePolicy = { version, fileAccess, externalCapabilities }
  return {
    requestedPolicy: effectivePolicy,
    enforcement: {
      level: 'hard',
      effectivePolicy,
      unsupportedCapabilities: [],
      runtimeVersion: '0.152.1',
      platform: 'darwin',
    },
    adapterPolicy: {
      version,
      workDir,
      fileAccess,
      externalCapabilities,
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: ['OPENAI_BASE_URL', 'OPENAI_API_KEY'],
      sessionEnvKeys: ['SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
      shellSubprocess: {
        inherit: 'none',
        allowedEnvKeys: [
          'PATH',
          'HOME',
          'SHENNIAN_MANAGED_ROOM_CONTEXT',
          'SHENNIAN_MANAGED_ROOM_IPC_ROOT',
        ],
        deniedEnvKeys: ['OPENAI_BASE_URL', 'OPENAI_API_KEY'],
      },
    },
  }
}

function createHarness() {
  const adapter = new CodexAdapter()
  const internal = adapter as unknown as TestableCodexAdapter
  internal.runId = 'run-codex-test'
  internal.seq = 0

  const events: AgentEvent[] = []
  adapter.on('agentEvent', (event) => events.push(event))

  return { internal, events }
}

describe('CodexAdapter', () => {
  it('injects owner input into the exact active turn', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    internal.agentSessionId = 'thread-active'
    internal.activeTurnId = 'turn-active'
    internal.process = {}
    internal.sendRpc = vi.fn(async () => ({ turnId: 'turn-active' }))
    await adapter.injectActiveInput({ text: 'correct course', clientMessageId: 'message-c' })
    expect(internal.sendRpc).toHaveBeenCalledWith('turn/steer', expect.objectContaining({
      threadId: 'thread-active', expectedTurnId: 'turn-active', clientUserMessageId: 'message-c',
    }))
  })
  it('recognizes missing Codex project protocol methods', () => {
    expect(isCodexProjectApiUnsupportedError(new Error('Method not found: project/list'))).toBe(
      true,
    )
    expect(isCodexProjectApiUnsupportedError(new Error('authentication failed'))).toBe(false)
  })

  it('matches the most specific Codex project root for a work directory', () => {
    expect(
      selectCodexProjectIdForWorkDir(
        [
          { id: 'projects-root', roots: [{ path: '/repo' }] },
          { id: 'shennian-root', roots: [{ path: '/repo/shennian' }] },
        ],
        '/repo/shennian/open-source/packages/cli',
      ),
    ).toBe('shennian-root')
  })

  it('keeps the managed Room instructions separate from the Codex user turn', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    internal.ensureAppServer = vi.fn(async () => {
      internal.agentSessionId = 'codex-managed-thread'
    })
    internal.sendRpc = vi.fn(async () => ({}))
    internal.startTurnWithRecovery = vi.fn(async () => ({ turn: { id: 'turn-1' } }))
    const managed = composeManagedRoomPrompt({
      runtimeAdapter: 'codex',
      agent: { displayName: '代码助手', systemPrompt: '修改前先阅读架构文档。' },
      room: { name: '工程群', activationMode: 'auto_follow', members: [] },
    }).systemPrompt
    const roomMessage = '[群消息] <李辰>\n请修复构建。'

    await adapter.send(roomMessage, 'gpt-5.6-sol', undefined, undefined, managed)

    expect(internal.agentSystemPrompt).toBe(managed)
    expect(internal.startTurnWithRecovery).toHaveBeenCalledWith(
      'codex-managed-thread',
      roomMessage,
      'gpt-5.6-sol',
      undefined,
      undefined,
    )
    expect(internal.sendRpc).not.toHaveBeenCalledWith('thread/name/set', expect.anything())
    expect(managed).toContain('修改前先阅读架构文档。')
    expect(managed).toContain('shennian_room_send')
    expect(managed).not.toContain('Shennian CLI')
    expect(managed).not.toContain(roomMessage)
  })

  it('applies managed Room instructions during preparation without restarting the empty thread on send', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    const managed = composeManagedRoomPrompt({
      agent: { displayName: '代码助手', systemPrompt: '修改前先阅读架构文档。' },
      room: { name: '工程群', activationMode: 'mention_only', members: [] },
    }).systemPrompt
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: vi.fn(async () => ({})),
    })
    await adapter.start('shennian-session', directory)
    internal.managedPermissionConfig = { profileId: 'managed-profile', threadConfig: {} }
    internal.ensureAppServer = vi.fn(async () => {
      expect(internal.agentSystemPrompt).toBe(managed)
      internal.agentSessionId = 'new-empty-thread'
      internal.process = {}
    })
    internal.startTurnWithRecovery = vi.fn(async () => ({ turn: {} }))
    internal.killProcess = vi.fn(async () => {})

    await adapter.prepareSend?.(
      '[群消息] <李辰>\n继续',
      'gpt-6-astra',
      'medium',
      undefined,
      managed,
      { source: 'room_activation' },
    )
    await adapter.send(
      '[群消息] <李辰>\n继续',
      'gpt-6-astra',
      'medium',
      undefined,
      managed,
      { source: 'room_activation' },
    )

    expect(internal.killProcess).not.toHaveBeenCalled()
    expect(internal.startTurnWithRecovery).toHaveBeenCalledWith(
      'new-empty-thread',
      '[群消息] <李辰>\n继续',
      'gpt-6-astra',
      'medium',
      undefined,
    )
  })

  it('refuses a managed Room turn when no compiled permission snapshot is attached', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    internal.ensureAppServer = vi.fn(async () => {
      internal.agentSessionId = 'must-not-start'
    })

    await expect(
      adapter.send('[群消息] <李辰>\n读取文件', undefined, undefined, undefined, 'managed prompt', {
        source: 'room_activation',
      }),
    ).rejects.toThrow('managed_agent_policy_missing')
    expect(internal.ensureAppServer).not.toHaveBeenCalled()
  })

  it('starts a managed Codex thread with a verified permission profile', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    const roomExecutor = vi.fn(async () => ({}))
    adapter.configure({
      sessionId: 'managed-session',
      managedAgentPolicy: compiledManagedPolicy(directory, 'workspace-read'),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: roomExecutor,
    })
    await adapter.start('managed-session', directory)
    internal.resolveCodexProjectId = vi.fn(async () => 'project-managed')
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'config/read') {
        return { config: { mcp_servers: { github: { enabled: true } } } }
      }
      if (method === 'thread/start') {
        return {
          thread: { id: 'thread-managed', name: null },
          activePermissionProfile: { id: 'shennian-managed', extends: null },
        }
      }
      return {}
    })

    await internal.initializeAppServer('gpt-5.6-sol')

    expect(internal.sendRpc).toHaveBeenCalledWith('config/read', { cwd: directory })
    expect(internal.sendRpc).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        cwd: directory,
        approvalPolicy: 'never',
        historyMode: 'paginated',
        config: expect.objectContaining({
          default_permissions: 'shennian-managed',
          web_search: 'disabled',
          mcp_servers: { github: { enabled: false } },
        }),
        dynamicTools: expect.arrayContaining([
          expect.objectContaining({
            type: 'namespace', name: 'shennian',
            tools: expect.arrayContaining([
              expect.objectContaining({ name: 'shennian_room_status' }),
              expect.objectContaining({ name: 'shennian_room_read' }),
            ]),
          }),
        ]),
      }),
    )
    const startCall = (internal.sendRpc as ReturnType<typeof vi.fn>).mock.calls.find(
      ([method]) => method === 'thread/start',
    )
    expect(startCall?.[1]).not.toHaveProperty('sandbox')
    expect(roomExecutor).toHaveBeenCalledWith(
      { context: `mrc_${'a'.repeat(43)}`, action: 'status' },
      { signal: expect.any(AbortSignal) },
    )
    expect(internal.agentSessionId).toBe('thread-managed')
  })

  it('fails before thread creation when the current managed Binding cannot be verified', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    const executor = vi.fn(async () => {
      throw Object.assign(new Error('membership missing'), {
        code: 'managed_room_membership_unavailable',
      })
    })
    adapter.configure({
      sessionId: 'managed-session',
      managedAgentPolicy: compiledManagedPolicy(directory, 'workspace-read'),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: executor,
    })
    await adapter.start('managed-session', directory)
    internal.sendRpc = vi.fn(async (method: string) =>
      method === 'config/read' ? { config: {} } : {})

    await expect(internal.initializeAppServer()).rejects.toThrow(
      'codex_managed_room_capability_unavailable:managed_room_membership_unavailable',
    )
    expect(internal.sendRpc).not.toHaveBeenCalledWith('thread/start', expect.anything())
    expect(internal.sendRpc).not.toHaveBeenCalledWith('thread/resume', expect.anything())
  })

  it('starts a managed Manager Worker without granting or requiring Room tools', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    adapter.configure({
      sessionId: 'managed-worker-session',
      managedAgentPolicy: compiledManagedPolicy(directory, 'workspace-read'),
    })
    await adapter.start('managed-worker-session', directory)
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/start') {
        return {
          thread: { id: 'thread-managed-worker' },
          activePermissionProfile: { id: 'shennian-managed' },
        }
      }
      return {}
    })

    await expect(internal.initializeAppServer('gpt-5.6-sol')).resolves.toBeUndefined()

    const startCall = (internal.sendRpc as ReturnType<typeof vi.fn>).mock.calls.find(
      ([method]) => method === 'thread/start',
    )
    expect(startCall?.[1]).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ default_permissions: 'shennian-managed' }),
      }),
    )
    expect(startCall?.[1]).toHaveProperty('threadSource', 'shennian_internal')
    expect(startCall?.[1]).not.toHaveProperty('dynamicTools')
    expect(internal.agentSessionId).toBe('thread-managed-worker')
    expect(internal.managedRoomToolThreadId).toBeNull()

    internal.ensureAppServer = vi.fn(async () => {})
    internal.startTurnWithRecovery = vi.fn(async () => ({ turn: { id: 'turn-managed-worker' } }))
    await expect(adapter.send('只读检查 AGENTS.md')).resolves.toEqual({ deliveryMode: 'direct' })
    expect(internal.activeTurnId).toBe('turn-managed-worker')
  })

  it('binds restricted dynamic tools for a private Manager turn before turn/started', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    const directory = fs.realpathSync(os.tmpdir())
    const token = `mrc_${'a'.repeat(43)}`
    const roomExecutor = vi.fn(async () => ({ roomId: 'room-1' }))
    const policy = compiledManagedPolicy(directory, 'workspace-read')

    adapter.configure({
      sessionId: 'manager-session',
      managedAgentPolicy: policy,
      managedRoomContextToken: token,
      managedRoomExecutor: roomExecutor,
    })
    await adapter.start('manager-session', directory, 'manager-thread')
    internal.managedRoomTools.configure(token, roomExecutor)
    internal.managedRoomTools.bindThread('manager-thread')
    internal.managedRoomToolThreadId = 'manager-thread'

    // queue.ts reconfigures a Worker completion with a fresh restricted token.
    // It keeps Manager tools callable; the authority, not Codex, enforces that
    // an owner-private token has no Room actions.
    adapter.configure({
      sessionId: 'manager-session',
      managedAgentPolicy: policy,
      managedRoomContextToken: token,
      managedRoomExecutor: roomExecutor,
    })
    expect(internal.managedRoomTools.isConfigured()).toBe(false)
    expect(internal.managedRoomToolThreadId).toBe('manager-thread')

    internal.ensureAppServer = vi.fn(async () => {})
    internal.startTurnWithRecovery = vi.fn(async () => {
      internal.handleAppServerMessage({
        method: 'turn/started',
        params: { threadId: 'manager-thread', turn: { id: 'manager-event-turn' } },
      })
      return { turn: { id: 'manager-event-turn' } }
    })
    await expect(
      adapter.send(
        '[Agent 完成 · Worker](shennian://session/worker-session)\n\ndone',
        undefined,
        undefined,
        undefined,
        'manager prompt',
        { source: 'managed_private' },
      ),
    ).resolves.toEqual({ deliveryMode: 'direct' })
    expect(internal.activeTurnId).toBe('manager-event-turn')
    expect(internal.managedRoomTools.isConfigured()).toBe(true)
    expect(events).not.toContainEqual(expect.objectContaining({ state: 'error' }))

    // A later real Room activation can install fresh full Room authority and
    // bind the same native thread.
    internal.activeTurnId = null
    adapter.configure({
      sessionId: 'manager-session',
      managedAgentPolicy: policy,
      managedRoomContextToken: token,
      managedRoomExecutor: roomExecutor,
    })
    internal.startTurnWithRecovery = vi.fn(async () => {
      internal.handleAppServerMessage({
        method: 'turn/started',
        params: { threadId: 'manager-thread', turn: { id: 'room-turn' } },
      })
      return { turn: { id: 'room-turn' } }
    })
    await expect(
      adapter.send(
        '[群消息] <李辰>\n汇报结果',
        undefined,
        undefined,
        undefined,
        'manager prompt',
        { source: 'room_activation' },
      ),
    ).resolves.toEqual({ deliveryMode: 'direct' })

    await expect(
      internal.managedRoomTools.execute({
        threadId: 'manager-thread',
        turnId: 'room-turn',
        callId: 'call-1',
        namespace: 'shennian',
        tool: 'shennian_room_status',
        arguments: {},
      }),
    ).resolves.toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: '{"roomId":"room-1"}' }],
    })
    expect(roomExecutor).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a real Room activation cannot bind its dynamic tools', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const events: AgentEvent[] = []
    adapter.on('agentEvent', (event) => events.push(event))
    const directory = fs.realpathSync(os.tmpdir())
    const token = `mrc_${'b'.repeat(43)}`
    const roomExecutor = vi.fn(async () => ({}))

    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory, 'workspace-read'),
      managedRoomContextToken: token,
      managedRoomExecutor: roomExecutor,
    })
    await adapter.start('manager-session', directory, 'manager-thread')
    // Simulate a corrupt/stale host invariant: the public marker says this
    // thread has the tool surface, while the capability binding has no thread.
    internal.managedRoomToolThreadId = 'manager-thread'
    internal.ensureAppServer = vi.fn(async () => {})
    internal.killProcess = vi.fn(async () => {})
    internal.startTurnWithRecovery = vi.fn(async () => {
      internal.handleAppServerMessage({
        method: 'turn/started',
        params: { threadId: 'manager-thread', turn: { id: 'room-turn' } },
      })
      return { turn: { id: 'room-turn' } }
    })

    await expect(
      adapter.send(
        '[群消息] <李辰>\n继续',
        undefined,
        undefined,
        undefined,
        'manager prompt',
        { source: 'room_activation' },
      ),
    ).rejects.toThrow('codex_managed_room_turn_binding_failed')
    expect(events).toContainEqual(expect.objectContaining({
      state: 'error',
      message: expect.stringContaining('codex_managed_room_turn_binding_failed'),
    }))
  })

  it('starts managed Codex with only allowlisted provider and Room environment values', () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory),
      env: {
        OPENAI_API_KEY: 'provider-key',
        SHENNIAN_MANAGED_ROOM_CONTEXT: `mrc_${'a'.repeat(43)}`,
        DATABASE_URL: 'must-not-leak',
      },
    })

    const env = internal.buildProcessEnv({ NO_COLOR: '1', ALSO_SECRET: 'must-not-leak' })

    expect(env.OPENAI_API_KEY).toBe('provider-key')
    expect(env.SHENNIAN_MANAGED_ROOM_CONTEXT).toBeUndefined()
    expect(env.SHENNIAN_MANAGED_ROOM_IPC_ROOT).toBeUndefined()
    expect(env.NO_COLOR).toBe('1')
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.ALSO_SECRET).toBeUndefined()
  })

  it('requires an app-server restart when the managed Agent policy version changes', () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory, 'workspace-write', 3),
    })
    internal.process = {} as never

    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory, 'workspace-write', 4),
    })

    expect(internal.configurationRestartRequired).toBe(true)
  })

  it('preserves a freshly configured Room capability across a pre-turn restart', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: vi.fn(async () => ({})),
    })
    await internal.killProcess(true)
    await adapter.start('managed-session', directory)
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/start') {
        return {
          thread: { id: 'thread-after-restart' },
          activePermissionProfile: { id: 'shennian-managed' },
        }
      }
      return {}
    })

    await expect(internal.initializeAppServer()).resolves.toBeUndefined()
    expect(internal.agentSessionId).toBe('thread-after-restart')
  })

  it('omits legacy turn sandbox overrides when a managed permission profile is active', async () => {
    const { internal } = createHarness()
    internal.managedPermissionConfig = {
      profileId: 'shennian-managed',
      threadConfig: { default_permissions: 'shennian-managed' },
    }
    internal.sendRpc = vi.fn(async () => ({ turn: { id: 'turn-managed' } }))

    await internal.startTurn('thread-managed', '执行测试')

    const params = (internal.sendRpc as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    expect(params).not.toHaveProperty('sandboxPolicy')
    expect(params).toMatchObject({ approvalPolicy: 'never' })
  })

  it('serializes queued images into the same text message without duplicating visible paths', () => {
    const image = {
      path: '/repo/.uploads/screenshot.png',
      name: 'screenshot.png',
      mimeType: 'image/png',
      kind: 'image' as const,
    }

    expect(buildCodexQueuedText('请分析这个报错', [image])).toBe(
      '请分析这个报错\n\n![screenshot.png](</repo/.uploads/screenshot.png>)',
    )
    expect(
      buildCodexQueuedText('![screenshot.png](</repo/.uploads/screenshot.png>)\n\n请分析这个报错', [
        image,
      ]),
    ).toBe('![screenshot.png](</repo/.uploads/screenshot.png>)\n\n请分析这个报错')
    expect(buildCodexQueueArgs('thread-desktop', '请分析这个报错', [image])).toEqual([
      'queue',
      '--thread',
      'thread-desktop',
      '--message',
      '请分析这个报错\n\n![screenshot.png](</repo/.uploads/screenshot.png>)',
    ])
  })

  it('does not treat the OpenAI provider label as a Codex model id', () => {
    expect(normalizeCodexModelId('OpenAI')).toBeUndefined()
    expect(normalizeCodexModelId(' openai ')).toBeUndefined()
    expect(normalizeCodexModelId('gpt-5.5')).toBe('gpt-5.5')
    expect(normalizeCodexModelId(' gpt-5.6-sol ')).toBe('gpt-5.6-sol')
    expect(normalizeCodexModelId('gpt-5.6-terra')).toBe('gpt-5.6-terra')
    expect(normalizeCodexModelId('gpt-5.6-luna')).toBe('gpt-5.6-luna')
  })

  it('normalizes optional Codex reasoning effort without constraining future values', () => {
    expect(normalizeCodexReasoningEffort(' xhigh ')).toBe('xhigh')
    expect(normalizeCodexReasoningEffort('')).toBeUndefined()
  })

  it('recognizes app-server effort compatibility failures', () => {
    expect(isCodexUnsupportedEffortError(new Error('unknown field `effort`'))).toBe(true)
    expect(isCodexUnsupportedEffortError(new Error('unsupported reasoning effort'))).toBe(true)
    expect(isCodexUnsupportedEffortError(new Error('thread not found'))).toBe(false)
  })

  it('recognizes Codex missing rollout errors as recoverable', () => {
    expect(isMissingCodexRolloutError(new Error('no rollout found for thread id 019e1c62'))).toBe(
      true,
    )
    expect(isMissingCodexRolloutError(new Error('thread not found'))).toBe(false)
  })

  it('recognizes Codex per-thread writer ownership conflicts', () => {
    expect(
      isCodexActiveWriterError(new Error('thread thread-1 already has an active writer')),
    ).toBe(true)
    expect(isCodexActiveWriterError(new Error('thread-store conflict'))).toBe(true)
    expect(isCodexActiveWriterError(new Error('thread not found'))).toBe(false)
  })

  it('blames a missing work directory, not the CLI, when any adapter spawn reports ENOENT', () => {
    const existing = fs.mkdtempSync(`${os.tmpdir()}/shennian-codex-cwd-`)
    try {
      const missing = `${existing}/deleted`
      const notFound = 'codex_command_unavailable: x'
      expect(spawnEnoentError(missing, notFound).message).toMatch(/^agent_workdir_not_found: .*deleted/)
      expect(spawnEnoentError(existing, notFound).message).toBe(notFound)
      expect(spawnEnoentError(null, notFound).message).toBe(notFound)
    } finally {
      fs.rmSync(existing, { recursive: true, force: true })
    }
  })

  it('recognizes only explicit paginated history compatibility failures', () => {
    expect(
      isCodexPaginatedHistoryUnsupportedError(
        new Error('thread-store unsupported operation: paginated_threads'),
      ),
    ).toBe(true)
    expect(
      isCodexPaginatedHistoryUnsupportedError(new Error('paginated history is unavailable')),
    ).toBe(true)
    expect(isCodexPaginatedHistoryUnsupportedError(new Error('thread/start failed'))).toBe(false)
  })

  it('recognizes only excludeTurns field compatibility failures', () => {
    expect(isCodexExcludeTurnsUnsupportedError(new Error('unknown field `excludeTurns`'))).toBe(
      true,
    )
    expect(isCodexExcludeTurnsUnsupportedError(new Error('excludeTurns is not supported'))).toBe(
      true,
    )
    expect(
      isCodexExcludeTurnsUnsupportedError(new Error('thread already has an active writer')),
    ).toBe(false)
  })

  it('queues a message for the existing Codex Desktop owner instead of failing resume', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('shennian-session', '/repo', 'thread-desktop')
    internal.ensureAppServer = vi.fn(async () => {
      throw new Error('thread thread-desktop already has an active writer')
    })
    internal.enqueueForExternalOwner = vi.fn(async () => 'queued-native-1')

    await expect(adapter.send('继续修复')).resolves.toEqual({
      deliveryMode: 'external_owner_queue',
      queuedSubmissionId: 'queued-native-1',
    })
    expect(internal.enqueueForExternalOwner).toHaveBeenCalledWith(
      'thread-desktop',
      '继续修复',
      undefined,
    )
  })

  it('rejects before queueing when the Desktop-owned thread was manually stopped', async () => {
    const adapter = new CodexAdapter({ isThreadTailInterrupted: () => true })
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('shennian-session', '/repo', 'thread-desktop')
    internal.ensureAppServer = vi.fn(async () => {
      throw new Error('thread thread-desktop already has an active writer')
    })
    internal.enqueueForExternalOwner = vi.fn(async () => 'must-not-queue')

    await expect(adapter.prepareSend?.('继续修复')).rejects.toThrow(
      CODEX_DESKTOP_SEND_UNAVAILABLE,
    )
    expect(internal.enqueueForExternalOwner).not.toHaveBeenCalled()
  })

  it('does not queue a managed Room message into a Desktop-owned unsandboxed thread', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: vi.fn(async () => ({})),
    })
    await adapter.start('shennian-session', directory, 'thread-desktop')
    internal.ensureAppServer = vi.fn(async () => {
      throw new Error('thread thread-desktop already has an active writer')
    })
    internal.enqueueForExternalOwner = vi.fn(async () => 'must-not-queue')

    await expect(
      adapter.send('[群消息] <李辰>\n继续修复', undefined, undefined, undefined, 'managed prompt', {
        source: 'room_activation',
      }),
    ).rejects.toThrow('codex_managed_thread_owned_externally')
    expect(internal.enqueueForExternalOwner).not.toHaveBeenCalled()
  })

  it('does not hide unrelated Codex resume failures behind the Desktop queue', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('shennian-session', '/repo', 'thread-missing')
    internal.ensureAppServer = vi.fn(async () => {
      throw new Error('no rollout found for thread id thread-missing')
    })
    internal.enqueueForExternalOwner = vi.fn(async () => 'should-not-run')

    await expect(adapter.send('继续修复')).rejects.toThrow('no rollout found')
    expect(internal.enqueueForExternalOwner).not.toHaveBeenCalled()
  })

  it('interrupts an active Codex turn before stopping the app-server', async () => {
    const { internal } = createHarness()
    internal.agentSessionId = 'thread-1'
    internal.activeTurnId = 'turn-1'
    internal.process = {} as never
    internal.sendRpc = vi.fn(async () => ({}))

    await internal.interruptActiveTurn()

    expect(internal.sendRpc).toHaveBeenCalledWith(
      'turn/interrupt',
      { threadId: 'thread-1', turnId: 'turn-1' },
      5_000,
    )
    expect(internal.activeTurnId).toBeNull()
  })

  it('reports waiting approval status from Codex thread state', async () => {
    const { internal } = createHarness()
    internal.agentSessionId = 'thread-1'
    internal.activeTurnId = 'turn-1'
    internal.process = {} as never
    internal.sendRpc = vi.fn(async () => ({
      thread: {
        status: { type: 'active', activeFlags: ['waitingOnApproval'] },
      },
    }))

    await expect(internal.getStatus()).resolves.toEqual({
      active: true,
      runId: 'turn-1',
      runPhase: 'waiting_approval',
      canStop: true,
    })
  })

  it('updates active turn id from app-server turn/started notifications', () => {
    const { internal } = createHarness()

    internal.handleAppServerMessage({
      method: 'turn/started',
      params: { turn: { id: 'turn-live' } },
    })

    expect(internal.activeTurnId).toBe('turn-live')
  })

  it('restarts the app-server and retries once when Codex loses the thread rollout', async () => {
    const { internal } = createHarness()
    const sendRpc = vi
      .fn()
      .mockRejectedValueOnce(new Error('no rollout found for thread id thread-1'))
      .mockResolvedValueOnce({ turn: { id: 'turn-2' } })
    internal.sendRpc = sendRpc
    internal.killProcess = vi.fn(async () => {})
    internal.ensureAppServer = vi.fn(async () => {})

    const response = await internal.startTurnWithRecovery(
      'thread-1',
      '继续',
      'gpt-5.3-codex',
      'high',
    )

    expect(internal.killProcess).toHaveBeenCalledTimes(1)
    expect(internal.ensureAppServer).toHaveBeenCalledWith('gpt-5.3-codex')
    expect(sendRpc).toHaveBeenCalledTimes(2)
    expect(response).toEqual({ turn: { id: 'turn-2' } })
  })

  it('checks fresh-thread capabilities during preparation before a queued message can be committed', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    const prepare = vi.spyOn(internal, 'ensureAppServer').mockRejectedValue(new Error('codex_managed_permission_profile_unavailable'))
    await adapter.start('preflight-session', '/tmp')
    await expect(adapter.prepareSend('original queued message')).rejects.toThrow('codex_managed_permission_profile_unavailable')
    expect(prepare).toHaveBeenCalledOnce()
  })

  it('refuses a cached WSL selection on Windows before spawning or replacing an existing thread', async () => {
    const commands = await import('../agents/command-spec.js')
    const childProcess = await import('node:child_process')
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const resolve = vi.spyOn(commands, 'resolveBuiltinCommand').mockReturnValue({
      command: 'codex', args: [], display: 'codex', path: 'wsl.exe', kind: 'wsl-bridge',
    })
    const spawn = vi.spyOn(childProcess, 'spawn')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      const adapter = new CodexAdapter()
      await adapter.start('preflight-session', 'C:\\work tree', 'original-thread')
      await expect(adapter.prepareSend('do not migrate')).rejects.toThrow('codex_windows_runtime_unavailable')
      expect(spawn).not.toHaveBeenCalled()
      expect((adapter as unknown as TestableCodexAdapter).agentSessionId).toBe('original-thread')
    } finally {
      Object.defineProperty(process, 'platform', platform)
      resolve.mockRestore()
      spawn.mockRestore()
    }
  })

})
