// @arch open-source/docs/cli-runtime.md
// @covers src/agents/codex.ts

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import type { CodexManagedRoomToolBinding } from '../agents/codex-managed-room-tools.js'
import { CodexAdapter } from '../agents/codex.js'
import type { ManagedRoomExecutor } from '../room/managed-room-ipc.js'
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

  it('recreates a managed thread and replays the real message once when its history is missing', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: vi.fn(async () => ({})),
    })
    await adapter.start('shennian-session', directory, 'thread-missing')
    internal.managedPermissionConfig = { profileId: 'managed-profile', threadConfig: {} }
    internal.managedRoomToolThreadId = 'thread-missing'
    internal.startTurn = vi
      .fn()
      .mockRejectedValueOnce(new Error('no rollout found for thread id thread-missing'))
      .mockResolvedValueOnce({ turn: { id: 'turn-replayed' } })
    internal.killProcess = vi.fn(async () => {})
    internal.ensureAppServer = vi.fn(async () => {
      expect(internal.agentSessionId).toBeNull()
      expect(internal.managedRoomToolThreadId).toBeNull()
      internal.agentSessionId = 'thread-recreated'
    })

    const response = await internal.startTurnWithRecovery(
      'thread-missing',
      '[群消息] <李辰>\n继续',
      'gpt-6-astra',
      'medium',
    )

    expect(internal.killProcess).toHaveBeenCalledWith(true)
    expect(internal.ensureAppServer).toHaveBeenCalledWith('gpt-6-astra')
    expect(internal.startTurn).toHaveBeenNthCalledWith(
      1,
      'thread-missing',
      '[群消息] <李辰>\n继续',
      'gpt-6-astra',
      'medium',
      undefined,
    )
    expect(internal.startTurn).toHaveBeenNthCalledWith(
      2,
      'thread-recreated',
      '[群消息] <李辰>\n继续',
      'gpt-6-astra',
      'medium',
      undefined,
    )
    expect(response).toEqual({ turn: { id: 'turn-replayed' } })
  })

  it('waits for a recreated managed rollout to become readable before replaying the turn', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new CodexAdapter({ hidden: true })
      const internal = adapter as unknown as TestableCodexAdapter
      const directory = fs.realpathSync(os.tmpdir())
      adapter.configure({
        managedAgentPolicy: compiledManagedPolicy(directory),
        managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
        managedRoomExecutor: vi.fn(async () => ({})),
      })
      await adapter.start('shennian-session', directory, 'thread-missing')
      internal.managedPermissionConfig = { profileId: 'managed-profile', threadConfig: {} }
      internal.managedRoomToolThreadId = 'thread-missing'
      internal.startTurn = vi
        .fn()
        .mockRejectedValueOnce(new Error('no rollout found for thread id thread-missing'))
        .mockRejectedValueOnce(new Error('no rollout found for thread id thread-recreated'))
        .mockResolvedValueOnce({ turn: { id: 'turn-after-rollout-ready' } })
      internal.killProcess = vi.fn(async () => {})
      internal.ensureAppServer = vi.fn(async () => {
        internal.agentSessionId = 'thread-recreated'
      })

      const pending = internal.startTurnWithRecovery(
        'thread-missing',
        '[群消息] <李辰>\n继续',
        'gpt-6-astra',
        'medium',
      )
      await vi.runAllTimersAsync()

      await expect(pending).resolves.toEqual({ turn: { id: 'turn-after-rollout-ready' } })
      expect(internal.startTurn).toHaveBeenCalledTimes(3)
      expect(internal.startTurn).toHaveBeenNthCalledWith(
        3,
        'thread-recreated',
        '[群消息] <李辰>\n继续',
        'gpt-6-astra',
        'medium',
        undefined,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers when app-server reports a missing rollout after turn/start was accepted', async () => {
    const { internal, events } = createHarness()
    internal.managedPermissionConfig = { profileId: 'managed-profile', threadConfig: {} }
    internal.managedTurnReplay = {
      text: '[群消息] <李辰>\n继续',
      modelId: 'gpt-6-astra',
      reasoningEffort: 'medium',
      recoveryCount: 0,
    }
    internal.agentSessionId = 'thread-not-materialized'
    internal.recoverManagedTurnAfterAsyncRolloutFailure = vi.fn(async () => {})

    internal.handleAppServerMessage({
      method: 'error',
      params: { message: 'no rollout found for thread id thread-not-materialized' },
    })
    await internal.managedAsyncRecovery

    expect(internal.recoverManagedTurnAfterAsyncRolloutFailure).toHaveBeenCalledTimes(1)
    expect(internal.managedTurnReplay.recoveryCount).toBe(1)
    expect(events).not.toContainEqual(expect.objectContaining({ state: 'error' }))
  })

  it('passes Codex reasoning effort to turn/start', async () => {
    const { internal } = createHarness()
    internal.sendRpc = vi.fn(async () => ({ turn: { id: 'turn-effort' } }))

    await internal.startTurn('thread-1', '实现功能', 'gpt-5.5', 'xhigh')

    expect(internal.sendRpc).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        model: 'gpt-5.5',
        effort: 'xhigh',
      }),
    )
  })

  it('passes latest GPT-5.6 Codex modelIds to turn/start without fallback', async () => {
    for (const modelId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      const { internal } = createHarness()
      internal.sendRpc = vi.fn(async () => ({ turn: { id: `turn-${modelId}` } }))

      await internal.startTurn('thread-1', '实现功能', modelId)

      expect(internal.sendRpc).toHaveBeenCalledWith(
        'turn/start',
        expect.objectContaining({
          model: modelId,
        }),
      )
    }
  })

  it('does not pass remote image urls as Codex local_images', async () => {
    const { internal } = createHarness()
    internal.sendRpc = vi.fn(async () => ({ turn: { id: 'turn-url-image' } }))

    await internal.startTurn(
      'thread-1',
      '图片文件: image.jpg\nhttps://oss.test/image.jpg',
      undefined,
      undefined,
      [
        {
          kind: 'image',
          path: 'https://oss.test/image.jpg',
          name: 'image.jpg',
          mimeType: 'image/jpeg',
        },
      ],
    )

    expect(internal.sendRpc).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        input: [
          expect.not.objectContaining({
            local_images: expect.anything(),
          }),
        ],
      }),
    )
  })

  it('appends non-image attachment paths to Codex text input', async () => {
    const { internal } = createHarness()
    internal.sendRpc = vi.fn(async () => ({ turn: { id: 'turn-file-attachment' } }))

    await internal.startTurn('thread-1', '读取附件内容', undefined, undefined, [
      {
        kind: 'file',
        path: '/tmp/brief.txt',
        name: 'brief.txt',
        mimeType: 'text/plain',
      },
    ])

    expect(internal.sendRpc).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        input: [
          expect.objectContaining({
            text: expect.stringContaining('/tmp/brief.txt'),
          }),
        ],
      }),
    )
    const call = (internal.sendRpc as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      input?: Array<{ text?: string }>
    }
    expect(call.input?.[0]?.text).toContain('[brief.txt (text/plain)](</tmp/brief.txt>)')
    expect(call.input?.[0]?.text).not.toContain('本条外部消息包含')
  })

  it('does not duplicate attachment path hints when external text already contains the attachment link', async () => {
    const { internal } = createHarness()
    internal.sendRpc = vi.fn(async () => ({ turn: { id: 'turn-file-attachment-visible' } }))

    await internal.startTurn(
      'thread-1',
      '外部对话: ABC\n同事: [brief.txt](</tmp/brief.txt>)',
      undefined,
      undefined,
      [
        {
          kind: 'file',
          path: '/tmp/brief.txt',
          name: 'brief.txt',
          mimeType: 'text/plain',
        },
      ],
    )

    const call = (internal.sendRpc as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      input?: Array<{ text?: string }>
    }
    expect(call.input?.[0]?.text).toBe('外部对话: ABC\n同事: [brief.txt](</tmp/brief.txt>)')
  })

  it('passes a generated video preview frame to Codex local_images', async () => {
    const { internal } = createHarness()
    internal.sendRpc = vi.fn(async () => ({ turn: { id: 'turn-video-attachment' } }))

    await internal.startTurn('thread-1', '判断视频主色', undefined, undefined, [
      {
        kind: 'file',
        path: '/tmp/clip.mp4',
        name: 'clip.mp4',
        mimeType: 'video/mp4',
      },
    ])

    expect(spawnSync).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['/tmp/clip.mp4', '/tmp/clip.preview.png']),
      expect.any(Object),
    )
    expect(internal.sendRpc).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        input: [
          expect.objectContaining({
            text: expect.stringContaining('/tmp/clip.mp4'),
            local_images: [{ path: '/tmp/clip.preview.png' }],
          }),
        ],
      }),
    )
  })

  it('marks new app-server threads as user-created for Codex app visibility', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('session-visible', '/repo/shennian')
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'project/list') {
        return {
          data: [{ id: 'project-shennian', roots: [{ path: '/repo/shennian' }] }],
          nextCursor: null,
        }
      }
      if (method === 'thread/start') return { thread: { id: 'thread-visible', name: null } }
      return {}
    })

    await internal.initializeAppServer('gpt-5.3-codex')

    expect(internal.sendRpc).toHaveBeenCalledWith('initialize', {
      clientInfo: { name: 'codex-tui', title: 'Codex TUI', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    })
    expect(internal.sendRpc).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        serviceName: 'Shennian',
        threadSource: 'user',
        historyMode: 'paginated',
        projectId: 'project-shennian',
        model: 'gpt-5.3-codex',
      }),
    )
    expect(internal.agentSessionId).toBe('thread-visible')
  })

  it('does not mislabel resumed internal orchestration threads as Codex subagents', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('managed-session', '/repo/shennian', 'thread-managed', {
      nativeSessionVisibility: 'internal',
    })
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'thread/resume') return { thread: { id: 'thread-managed', name: null } }
      return {}
    })

    await internal.initializeAppServer('gpt-5.3-codex')

    expect(internal.sendRpc).toHaveBeenCalledWith(
      'thread/resume',
      expect.objectContaining({
        threadId: 'thread-managed',
        excludeTurns: true,
      }),
    )
    const resumeCall = (internal.sendRpc as ReturnType<typeof vi.fn>).mock.calls.find(
      ([method]) => method === 'thread/resume',
    )
    expect(resumeCall?.[1]).not.toHaveProperty('threadSource')
    expect(internal.sendRpc).not.toHaveBeenCalledWith('project/list', expect.anything())
  })

  it('creates a native Codex project before starting a thread when no root matches', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('session-new-project', '/repo/new-project')
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'project/list') return { data: [], nextCursor: null }
      if (method === 'project/create') return { project: { id: 'project-created' } }
      if (method === 'thread/start') return { thread: { id: 'thread-created', name: null } }
      return {}
    })

    await internal.initializeAppServer()

    expect(internal.sendRpc).toHaveBeenCalledWith(
      'project/create',
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^shennian-project-[0-9a-f]{64}$/),
        name: 'new-project',
        roots: [{ path: '/repo/new-project' }],
      }),
    )
    expect(internal.sendRpc).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({ projectId: 'project-created', historyMode: 'paginated' }),
    )
  })

  it('prompts for a manual upgrade when Codex lacks the native project protocol', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    await adapter.start('session-old-codex', '/repo/shennian')
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'project/list') throw new Error('Method not found: project/list')
      if (method === 'thread/start') return { thread: { id: 'must-not-start', name: null } }
      return {}
    })

    await expect(internal.initializeAppServer()).rejects.toThrow('请手动升级 Codex CLI 后重试')
    expect(internal.sendRpc).not.toHaveBeenCalledWith('thread/start', expect.anything())
    expect(internal.agentSessionId).toBeNull()
  })

  it('prompts for a manual Codex upgrade instead of creating an invisible legacy thread', async () => {
    const { internal } = createHarness()
    internal.sendRpc = vi.fn(async (method: string, params: unknown) => {
      if (method !== 'thread/start') return {}
      if ((params as { historyMode?: string }).historyMode === 'paginated') {
        throw new Error('thread-store unsupported operation: paginated_threads')
      }
      return { thread: { id: 'must-not-create-legacy', name: null } }
    })

    await expect(internal.initializeAppServer()).rejects.toThrow('请手动升级 Codex CLI 后重试')

    expect(internal.sendRpc).toHaveBeenNthCalledWith(
      2,
      'thread/start',
      expect.objectContaining({ historyMode: 'paginated' }),
    )
    expect(internal.sendRpc).toHaveBeenCalledTimes(2)
    expect(internal.agentSessionId).toBeNull()
  })

  it('resumes stored threads without hydrating full history into the adapter', async () => {
    const { internal } = createHarness()
    internal.agentSessionId = 'thread-paginated'
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'thread/resume') {
        return { thread: { id: 'thread-paginated', name: 'Paginated thread' } }
      }
      return {}
    })

    await internal.initializeAppServer()

    expect(internal.sendRpc).toHaveBeenCalledWith(
      'thread/resume',
      expect.objectContaining({
        threadId: 'thread-paginated',
        excludeTurns: true,
      }),
    )
  })

  it('retries legacy resume without excludeTurns when an older Codex rejects the field', async () => {
    const { internal } = createHarness()
    internal.agentSessionId = 'thread-legacy'
    internal.sendRpc = vi.fn(async (method: string, params: unknown) => {
      if (method !== 'thread/resume') return {}
      if ((params as { excludeTurns?: boolean }).excludeTurns) {
        throw new Error('unknown field `excludeTurns`')
      }
      return { thread: { id: 'thread-legacy', name: 'Legacy thread' } }
    })

    await internal.initializeAppServer()

    expect(internal.sendRpc).toHaveBeenNthCalledWith(
      2,
      'thread/resume',
      expect.objectContaining({ excludeTurns: true }),
    )
    expect(internal.sendRpc).toHaveBeenNthCalledWith(
      3,
      'thread/resume',
      expect.not.objectContaining({ excludeTurns: expect.anything() }),
    )
  })

  it('replaces a stored managed thread instead of resuming one that may lack dynamic tools', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: vi.fn(async () => ({})),
    })
    await adapter.start('managed-session', directory, 'legacy-managed-thread')
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/start') {
        return {
          thread: { id: 'fresh-managed-thread' },
          activePermissionProfile: { id: 'shennian-managed' },
        }
      }
      return {}
    })

    await internal.initializeAppServer()

    expect(internal.sendRpc).not.toHaveBeenCalledWith('thread/resume', expect.anything())
    expect(internal.sendRpc).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        historyMode: 'paginated',
        dynamicTools: expect.arrayContaining([
          expect.objectContaining({
            name: 'shennian',
            tools: expect.arrayContaining([expect.objectContaining({ name: 'shennian_room_status' })]),
          }),
        ]),
      }),
    )
    expect(internal.agentSessionId).toBe('fresh-managed-thread')
  })

  it('resumes a managed thread created with dynamic tools by the same live adapter', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    const executor = vi.fn(async () => ({})) as ManagedRoomExecutor
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: executor,
    })
    await adapter.start('managed-session', directory)
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/start') {
        return {
          thread: { id: 'managed-tool-thread' },
          activePermissionProfile: { id: 'shennian-managed' },
        }
      }
      return {}
    })
    await internal.initializeAppServer()
    await internal.killProcess()
    adapter.configure({
      sessionId: 'managed-session',
      managedRoomContextToken: `mrc_${'b'.repeat(43)}`,
      managedRoomExecutor: executor,
    })
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/resume') {
        return {
          thread: { id: 'managed-tool-thread' },
          activePermissionProfile: { id: 'shennian-managed' },
        }
      }
      return {}
    })

    await internal.initializeAppServer()

    expect(internal.sendRpc).toHaveBeenCalledWith(
      'thread/resume',
      expect.objectContaining({ threadId: 'managed-tool-thread', excludeTurns: true }),
    )
    expect(internal.sendRpc).not.toHaveBeenCalledWith('thread/start', expect.anything())
  })

  it('recreates a managed thread when its required dynamic tool surface changes', async () => {
    const adapter = new CodexAdapter({ hidden: true })
    const internal = adapter as unknown as TestableCodexAdapter
    const directory = fs.realpathSync(os.tmpdir())
    const executor = vi.fn(async () => ({})) as ManagedRoomExecutor
    adapter.configure({
      managedAgentPolicy: compiledManagedPolicy(directory),
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: executor,
    })
    await adapter.start('managed-session', directory)
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/start') {
        return {
          thread: { id: 'room-tool-thread' },
          activePermissionProfile: { id: 'shennian-managed' },
        }
      }
      return {}
    })
    await internal.initializeAppServer()
    await internal.killProcess()

    adapter.configure({
      sessionId: 'managed-session',
      env: { SHENNIAN_MANAGER_SESSION_ID: 'manager-session' },
      managedRoomContextToken: `mrc_${'b'.repeat(43)}`,
      managedRoomExecutor: executor,
    })
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'config/read') return { config: {} }
      if (method === 'thread/start') {
        return {
          thread: { id: 'manager-tool-thread' },
          activePermissionProfile: { id: 'shennian-managed' },
        }
      }
      return {}
    })

    await internal.initializeAppServer()

    expect(internal.sendRpc).not.toHaveBeenCalledWith('thread/resume', expect.anything())
    expect(internal.sendRpc).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        dynamicTools: expect.arrayContaining([
          expect.objectContaining({
            name: 'shennian',
            tools: expect.arrayContaining([expect.objectContaining({ name: 'shennian_manager_sessions_start' })]),
          }),
        ]),
      }),
    )
    expect(executor).toHaveBeenCalledWith(
      { context: `mrc_${'b'.repeat(43)}`, action: 'manager.sessions.list' },
      { signal: expect.any(AbortSignal) },
    )
    expect(internal.agentSessionId).toBe('manager-tool-thread')
  })

  it('answers app-server dynamic tool requests through the bound daemon executor', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    const executor = vi.fn(async () => ({ room: { name: '安全测试群' } })) as ManagedRoomExecutor
    const write = vi.fn()
    adapter.configure({
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: executor,
    })
    internal.managedPermissionConfig = {
      profileId: 'shennian-managed',
      threadConfig: {},
    }
    internal.managedRoomTools.configure(`mrc_${'a'.repeat(43)}`, executor)
    internal.managedRoomTools.bindThread('thread-1')
    internal.managedRoomTools.bindTurn('thread-1', 'turn-1')
    internal.process = { stdin: { write } }

    internal.handleAppServerMessage({
      id: 'server-call-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', namespace: 'shennian',
        tool: 'shennian_room_status', arguments: {},
      },
    })
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))

    expect(executor).toHaveBeenCalledWith(
      {
        context: `mrc_${'a'.repeat(43)}`,
        action: 'status',
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual({
      id: 'server-call-1',
      result: {
        success: true,
        contentItems: [{ type: 'inputText', text: '{"room":{"name":"安全测试群"}}' }],
      },
    })
  })

  it('mirrors a successful managed Room send into the Agent conversation', async () => {
    const { internal, events } = createHarness()
    const executor = vi.fn(async () => ({ message: { id: 'room-message-1' } })) as ManagedRoomExecutor
    const write = vi.fn()
    internal.managedRoomTools.configure(`mrc_${'a'.repeat(43)}`, executor)
    internal.managedRoomTools.bindThread('thread-1')
    internal.managedRoomTools.bindTurn('thread-1', 'turn-1')
    internal.process = { stdin: { write } }

    internal.handleAppServerMessage({
      id: 'server-call-send',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1', turnId: 'turn-1', callId: 'call-send', namespace: 'shennian',
        tool: 'shennian_room_send', arguments: { text: '链路已通' },
      },
    })
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))

    expect(events).toContainEqual(expect.objectContaining({
      state: 'delta',
      text: '链路已通',
    }))
  })

  it('invalidates an in-flight dynamic tool result as soon as the turn token is replaced', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    let release!: () => void
    const executor = vi.fn(
      () => new Promise<Record<string, boolean>>((resolve) => {
        release = () => resolve({ ok: true })
      }),
    ) as ManagedRoomExecutor
    adapter.configure({
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedRoomExecutor: executor,
    })
    internal.managedRoomTools.configure(`mrc_${'a'.repeat(43)}`, executor)
    internal.managedRoomTools.bindThread('thread-1')
    internal.managedRoomTools.bindTurn('thread-1', 'turn-1')
    const pending = internal.managedRoomTools.execute({
      threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', namespace: 'shennian',
      tool: 'shennian_room_status', arguments: {},
    })

    adapter.configure({
      managedRoomContextToken: `mrc_${'b'.repeat(43)}`,
      managedRoomExecutor: executor,
    })
    release()

    await expect(pending).resolves.toEqual({
      success: false,
      contentItems: [{ type: 'inputText', text: 'managed_room_tool_context_revoked' }],
    })
  })

  it('does not mislabel manager substrate threads as Codex subagents', async () => {
    const adapter = new CodexAdapter({
      modelInstructionsFile: '/tmp/manager-instructions.md',
      hidden: true,
    })
    const internal = adapter as unknown as TestableCodexAdapter
    internal.sendRpc = vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread-hidden', name: null } }
      return {}
    })
    await adapter.start('manager-session', '/repo')

    await internal.initializeAppServer('gpt-5.3-codex')

    const startCall = (internal.sendRpc as ReturnType<typeof vi.fn>).mock.calls.find(
      ([method]) => method === 'thread/start',
    )
    expect(startCall?.[1]).toHaveProperty('threadSource', 'shennian_internal')
    expect(internal.sendRpc).not.toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({ historyMode: 'paginated' }),
    )
    expect(internal.sendRpc).not.toHaveBeenCalledWith('project/list', expect.anything())
  })

  it('sets Codex thread names through app-server', async () => {
    const adapter = new CodexAdapter()
    const internal = adapter as unknown as TestableCodexAdapter
    internal.ensureAppServer = vi.fn(async () => {})
    internal.sendRpc = vi.fn(async () => ({}))

    await adapter.setTitle('thread-1', '  PDF 预览 崩溃修复  ', '/repo')

    expect(internal.agentSessionId).toBe('thread-1')
    expect(internal.ensureAppServer).toHaveBeenCalled()
    expect(internal.sendRpc).toHaveBeenCalledWith('thread/name/set', {
      threadId: 'thread-1',
      name: 'PDF 预览 崩溃修复',
    })
  })
})
