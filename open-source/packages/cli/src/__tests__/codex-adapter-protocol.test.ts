// @arch open-source/docs/cli-runtime.md
// @covers src/agents/codex.ts

import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import type { CodexManagedRoomToolBinding } from '../agents/codex-managed-room-tools.js'
import { CodexAdapter } from '../agents/codex.js'
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

  it('preserves paragraph breaks between completed agent_message blocks', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: '第一段。' },
    })

    internal.handleStreamEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: '第二段。' },
    })

    expect(events.filter((event) => event.state === 'delta')).toEqual([
      expect.objectContaining({ state: 'delta', text: '第一段。' }),
      expect.objectContaining({ state: 'delta', text: '\n\n第二段。' }),
    ])
  })

  it('avoids adding an extra blank line when the previous block already ended with a newline', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: '第一段。\n' },
    })

    internal.handleStreamEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: '第二段。' },
    })

    expect(events.filter((event) => event.state === 'delta')).toEqual([
      expect.objectContaining({ state: 'delta', text: '第一段。\n' }),
      expect.objectContaining({ state: 'delta', text: '\n第二段。' }),
    ])
  })

  it('normalizes todo_list items into a markdown checklist block', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: '计划是：\n1. 先确认现状。' },
    })

    internal.handleStreamEvent({
      type: 'item.completed',
      item: {
        type: 'todo_list',
        items: [
          { text: 'Write architecture doc', completed: false },
          { text: 'Run pnpm test', completed: true },
        ],
      },
    })

    expect(events.filter((event) => event.state === 'delta')).toEqual([
      expect.objectContaining({ state: 'delta', text: '计划是：\n1. 先确认现状。' }),
      expect.objectContaining({
        state: 'delta',
        text: '\n\n- [ ] Write architecture doc\n- [x] Run pnpm test',
      }),
    ])
  })

  it('emits web_search items as block text so they do not stick to the previous paragraph', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: '先看一下资料。' },
    })

    internal.handleStreamEvent({
      type: 'item.completed',
      item: { type: 'web_search', query: 'site:help.aliyun.com DashScope response_format' },
    })

    expect(events.filter((event) => event.state === 'delta')).toEqual([
      expect.objectContaining({ state: 'delta', text: '先看一下资料。' }),
      expect.objectContaining({
        state: 'delta',
        text: '\n\n[web_search] site:help.aliyun.com DashScope response_format',
      }),
    ])
  })

  it('drops Codex file-change telemetry before it enters the sync pipeline', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: '我已经修改了这些文件：' },
    })

    internal.handleStreamEvent({
      type: 'item.completed',
      item: {
        type: 'file_change',
        changes: [
          {
            kind: 'update',
            path: '/root/shennian/packages/app/src/components/chat/ChatWebView.web.tsx',
          },
          {
            kind: 'update',
            path: '/root/shennian/packages/app/src/components/chat/webview/chat.js',
          },
        ],
      },
    })

    internal.handleAppServerMessage({
      method: 'item/completed',
      params: {
        item: {
          type: 'fileChange',
          changes: [{ kind: 'update', path: '/root/shennian/packages/shared/src/relay.ts' }],
        },
      },
    })

    expect(events.filter((event) => event.state === 'delta')).toEqual([
      expect.objectContaining({ state: 'delta', text: '我已经修改了这些文件：' }),
    ])
  })

  it('filters Codex collab agent items before they can be persisted', () => {
    const { internal, events } = createHarness()

    internal.handleAppServerMessage({
      method: 'item/completed',
      params: {
        item: {
          type: 'collabAgentToolCall',
          id: 'collab-1',
          tool: 'spawnAgent',
          status: 'completed',
          senderThreadId: 'parent-thread',
          receiverThreadIds: ['child-thread'],
          prompt: 'inspect the codebase',
          agentsStates: {
            'child-thread': { status: 'completed', message: 'done' },
          },
        },
      },
    })

    expect(events).toEqual([])
  })

  it('ignores late completed tool items after an app-server turn has finished', () => {
    const { internal, events } = createHarness()
    internal.activeTurnId = 'turn-finished'

    internal.handleAppServerMessage({
      method: 'turn/completed',
      params: { turn: { id: 'turn-finished' } },
    })
    internal.handleAppServerMessage({
      method: 'item/completed',
      params: {
        item: {
          type: 'commandExecution',
          command: 'pnpm --dir packages/app start',
          aggregatedOutput: 'Metro stopped',
          exitCode: 0,
        },
      },
    })

    expect(events).toEqual([expect.objectContaining({ state: 'final' })])
    expect(internal.activeTurnId).toBeNull()
  })

  it('stays idle after an error while app-server is still closing', async () => {
    const { internal } = createHarness()
    internal.agentSessionId = 'thread-failed'
    internal.activeTurnId = 'turn-failed'
    internal.process = {}
    internal.killProcess = vi.fn(async () => {})
    internal.sendRpc = vi.fn(async () => ({ thread: { status: { type: 'active' } } }))
    try {
      internal.handleAppServerMessage({ method: 'error', params: { message: 'unsupported model' } })
      expect(internal.activeTurnId).toBeNull()
      expect(await internal.getStatus()).toMatchObject({ active: false, canStop: false })
      expect(internal.sendRpc).not.toHaveBeenCalled()
    } finally {
      if (internal.forceCloseTimer) clearTimeout(internal.forceCloseTimer)
    }
  })

  it('ignores an active status read that finishes after a terminal error', async () => {
    const { internal } = createHarness()
    internal.agentSessionId = 'thread-failed'
    internal.activeTurnId = 'turn-failed'
    internal.process = {}
    internal.killProcess = vi.fn(async () => {})
    let resolve!: (value: unknown) => void
    internal.sendRpc = vi.fn(() => new Promise(done => { resolve = done }))
    try {
      const status = internal.getStatus()
      internal.handleAppServerMessage({ method: 'error', params: { message: 'unsupported model' } })
      resolve({ thread: { status: { type: 'active' } } })
      expect(await status).toMatchObject({ active: false, canStop: false })
    } finally {
      if (internal.forceCloseTimer) clearTimeout(internal.forceCloseTimer)
    }
  })

  it('releases the managed app-server writer after a terminal turn event', () => {
    const { internal } = createHarness()
    internal.agentSessionId = 'thread-finished'
    internal.activeTurnId = 'turn-finished'
    internal.killProcess = vi.fn(async () => {})

    internal.handleAppServerMessage({
      method: 'turn/completed',
      params: { turn: { id: 'turn-finished' } },
    })

    expect(internal.killProcess).toHaveBeenCalledTimes(1)
  })

  it('filters legacy collab agent tool call events', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'item.completed',
      item: {
        type: 'mcp_tool_call',
        tool: 'spawnAgent',
        result: { agentId: 'child-thread' },
      },
    })

    internal.handleStreamEvent({
      type: 'tool_call',
      name: 'waitAgent',
      arguments: { target: 'child-thread' },
    })

    expect(events).toEqual([])
  })

  it('strips git directives from completed agent messages', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: [
          '已提交并推送到 origin/main。',
          '',
          '::git-stage{cwd="/Users/example/Documents/code/projects/shennian"}',
          '::git-commit{cwd="/Users/example/Documents/code/projects/shennian"}',
          '::git-push{cwd="/Users/example/Documents/code/projects/shennian" branch="main"}',
        ].join('\n'),
      },
    })

    expect(events.filter((event) => event.state === 'delta')).toEqual([
      expect.objectContaining({
        state: 'delta',
        text: '已提交并推送到 origin/main。',
      }),
    ])
  })

  it('emits final on turn.completed with usage and agent session id', () => {
    const { internal, events } = createHarness()
    internal.agentSessionId = 'thread-123'

    internal.handleStreamEvent({
      type: 'turn.completed',
      usage: { input_tokens: 12, output_tokens: 34 },
    })

    expect(events).toContainEqual(
      expect.objectContaining({
        state: 'final',
        agentSessionId: 'thread-123',
        usage: { inputTokens: 12, outputTokens: 34 },
      }),
    )
    expect(internal.forceCloseTimer).toBeNull()
  })

  it('emits final only once when multiple completion events arrive', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'turn.completed',
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    })
    internal.handleStreamEvent({
      type: 'completed',
      usage: { prompt_tokens: 99, completion_tokens: 88 },
    })

    expect(events.filter((event) => event.state === 'final')).toEqual([
      expect.objectContaining({
        state: 'final',
        usage: { inputTokens: 12, outputTokens: 34 },
      }),
    ])
  })

  it('keeps close as a final fallback when protocol completion is missing', () => {
    const { internal, events } = createHarness()
    internal.agentSessionId = 'thread-456'

    internal.handleProcessClose(0, '')

    expect(events).toEqual([
      expect.objectContaining({
        state: 'final',
        agentSessionId: 'thread-456',
      }),
    ])
  })

  it('treats stderr on zero exit as an error when no terminal protocol event arrived', () => {
    const { internal, events } = createHarness()

    internal.handleProcessClose(0, 'unexpected status 401 Unauthorized')

    expect(events).toEqual([
      expect.objectContaining({
        state: 'error',
        message: 'Codex API 返回 401 Unauthorized',
      }),
    ])
  })

  it('explains Windows codex launch failures when node is missing from PATH', () => {
    const { internal, events } = createHarness()

    internal.handleProcessClose(1, '\'"node"\' �����ڲ����ⲿ���Ҳ���ǿ����еĳ���\n���������ļ���')

    expect(events).toEqual([
      expect.objectContaining({
        state: 'error',
        message: expect.stringContaining('系统找不到 node'),
      }),
    ])
  })

  it('ignores known codex tail stderr noise on zero exit', () => {
    const { internal, events } = createHarness()

    internal.handleProcessClose(
      0,
      [
        'WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)',
        'Reading additional input from stdin...',
        '2026-04-18T03:38:55.217996Z ERROR codex_core::codex: failed to record rollout items: failed to queue rollout items: channel closed',
      ].join('\n'),
    )

    expect(events).toEqual([
      expect.objectContaining({
        state: 'final',
      }),
    ])
  })

  it('suppresses close fallback after a terminal error has already been emitted', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'turn.failed',
      error: 'boom',
    })
    internal.handleProcessClose(1, 'codex exited with code 1')

    expect(events.filter((event) => event.state === 'error')).toEqual([
      expect.objectContaining({ state: 'error', message: 'boom' }),
    ])
  })

  it('clears stale app-server readiness when no process remains', async () => {
    const { internal } = createHarness()
    internal.appServerReady = Promise.resolve()

    await internal.killProcess()

    expect(internal.appServerReady).toBeNull()
  })

  it('uses nested app-server error messages instead of a generic fallback', () => {
    const { internal, events } = createHarness()

    internal.handleAppServerMessage({
      method: 'error',
      params: { error: { message: 'thread not found' } },
    })

    expect(events).toEqual([
      expect.objectContaining({ state: 'error', message: 'thread not found' }),
    ])
  })

  it('surfaces transient app-server reconnect notifications as thinking status', () => {
    const { internal, events } = createHarness()

    internal.handleAppServerMessage({
      method: 'error',
      params: { message: 'Reconnecting... 1/5' },
    })

    expect(events).toEqual([
      expect.objectContaining({
        state: 'delta',
        thinking: true,
        text: 'Codex API 暂时不可用，正在重试 1/5...\n',
      }),
    ])
  })

  it('surfaces live app-server questions without automatically answering them', () => {
    const { internal, events } = createHarness()
    const write = vi.fn()
    internal.process = { stdin: { write } }
    internal.agentSessionId = 'thread-question'
    internal.activeTurnId = 'turn-question'
    const params = { threadId: 'thread-question', turnId: 'turn-question', questions: [
      { id: 'assistant', question: 'Which assistant?', options: [{ label: 'Existing', description: 'Use mine' }] },
    ] }
    internal.handleAppServerMessage({ id: 42, method: 'item/tool/requestUserInput', params })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ state: 'approval-pending', approval: {
      title: 'Codex 等待你回答', content: 'Which assistant?',
    } })
    expect(write).not.toHaveBeenCalled()
    internal.handleAppServerMessage({ id: 43, method: 'item/tool/requestUserInput', params: { ...params, threadId: 'other-thread' } })
    expect(events).toHaveLength(1)
  })

  it('preserves question options in legacy tool-call events', () => {
    const { internal, events } = createHarness()
    internal.handleStreamEvent({ type: 'function_call', name: 'functions.request_user_input_async',
      arguments: { questions: [{ title: '选择助手', options: ['已有助手'] }] },
    })
    expect(events[0]).toMatchObject({ state: 'approval-pending', approval: { content: '选择助手\n1. 已有助手' } })
  })

  it('surfaces Codex approval requests as pending confirmation events', () => {
    const { internal, events } = createHarness()

    internal.handleAppServerMessage({
      method: 'item/completed',
      params: {
        item: {
          type: 'approvalRequest',
          command: 'rm -rf dist',
          reason: 'Codex needs permission before running this command.',
        },
      },
    })

    expect(events).toEqual([
      expect.objectContaining({
        state: 'approval-pending',
        approval: expect.objectContaining({
          title: '需要用户确认',
          content: 'Codex needs permission before running this command.',
          source: 'codex',
        }),
      }),
    ])
  })

  it('formats upstream responses api errors for display', () => {
    const { internal, events } = createHarness()

    internal.handleAppServerMessage({
      method: 'error',
      params: {
        error: {
          message:
            'unexpected status 503 Service Unavailable: Service temporarily unavailable, url: https://leleapi.top/v1/responses, request id: abc-123',
        },
      },
    })

    expect(events).toEqual([
      expect.objectContaining({
        state: 'error',
        message: [
          'Codex API 返回 503 Service Unavailable：Service temporarily unavailable',
          '上游地址：https://leleapi.top/v1/responses',
          'request id：abc-123',
        ].join('\n'),
      }),
    ])
  })

  it('detects the interactive Codex login menu as a startup error', async () => {
    const { internal } = createHarness()

    internal.handleAppServerNonJsonStdout(
      "\u001b[?25l Welcome to Codex, OpenAI's command-line coding agent",
    )

    expect(internal.appServerStartupError?.message).toBe(
      'Codex 未登录。请先在这台电脑的终端运行 `codex`，按提示完成 ChatGPT 登录或配置 API key，然后再回到神念发送消息。',
    )
    await expect(internal.sendRpc('initialize', {})).rejects.toThrow('Codex 未登录')
  })

  it('does not treat arbitrary non-json app-server stdout as auth failure', () => {
    const { internal } = createHarness()

    internal.handleAppServerNonJsonStdout('debug line that is not json')

    expect(internal.appServerStartupError).toBeNull()
  })

  it('does not turn a completed turn into an error just because stderr arrived before close', () => {
    const { internal, events } = createHarness()

    internal.handleStreamEvent({
      type: 'turn.completed',
      usage: { input_tokens: 1, output_tokens: 2 },
    })
    internal.handleProcessClose(0, 'warning text')

    expect(events.filter((event) => event.state === 'final')).toEqual([
      expect.objectContaining({
        state: 'final',
        usage: { inputTokens: 1, outputTokens: 2 },
      }),
    ])
    expect(events.filter((event) => event.state === 'error')).toHaveLength(0)
  })
  it('synchronously announces resumed and replacement IDs before any provider turn', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const registered: string[] = []
    adapter.on('nativeSession', (provider, id) => { expect(provider).toBe('codex'); registered.push(id) })
    await adapter.start('sess_worker_fence', '/repo', 'previous-thread', { nativeSessionVisibility: 'internal' })
    expect(registered).toEqual(['previous-thread'])
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'thread/resume') return { thread: { id: 'resumed-thread' } }
      if (method === 'thread/start') return { thread: { id: 'replacement-thread' } }
      return {}
    })
    await internal.initializeAppServer()
    internal.agentSessionId = null
    await internal.initializeAppServer()
    expect(registered).toEqual(['previous-thread', 'resumed-thread', 'replacement-thread'])
  })

  it('never sends a turn when durable native ownership registration fails', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('sess_worker_fence', '/repo', null, { nativeSessionVisibility: 'internal' })
    adapter.on('nativeSession', () => { throw new Error('durability-failed') })
    internal.ensureAppServer = () => internal.initializeAppServer()
    internal.sendRpc = vi.fn(async (method: string) => method === 'thread/start'
      ? { thread: { id: 'new-thread' } } : {})
    await expect(adapter.send('must not reach provider')).rejects.toThrow('durability-failed')
    expect(internal.sendRpc).not.toHaveBeenCalledWith('turn/start', expect.anything())
  })

  it('does not queue internal work to an external writer without a return channel', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('sess_worker_internal', '/repo', 'thread')
    await expect(internal.enqueueForExternalOwner('thread', 'internal payload'))
      .rejects.toThrow('codex_managed_thread_owned_externally')
  })

})
