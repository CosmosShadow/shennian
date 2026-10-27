// @arch open-source/docs/cli-runtime.md
// @covers src/agents/pi-coding-agent.ts

import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import { PiCodingAgentAdapter } from '../agents/pi-coding-agent.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'

type TestablePiAdapter = {
  runId: string
  seq: number
  active: boolean
  terminal: boolean
  agentSessionId: string | null
  lastUsage?: AgentEvent['usage']
  processEnv: NodeJS.ProcessEnv
  extraEnv: NodeJS.ProcessEnv
  managedAgentPolicy: CompiledManagedAgentPolicy | null
  handleRpcEvent(event: Record<string, unknown>): void
  managedTools(): string[]
  ensureProcess(): Promise<void>
  spawnedRoomContext: string | null
  roomContextStale(): Promise<boolean>
  readState(): Promise<{
    isStreaming?: boolean
    messageCount?: number
    model?: { provider: string; id: string; api?: string; baseUrl?: string }
  }>
  rpc: { request: ReturnType<typeof vi.fn> } | null
  workDir: string
  shennianSessionId: string
}

function policy(fileAccess: 'workspace-read' | 'workspace-write' | 'host-full'): CompiledManagedAgentPolicy {
  const permissionPolicy = {
    version: 1,
    fileAccess,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  }
  return {
    requestedPolicy: permissionPolicy,
    enforcement: {
      level: 'partial',
      effectivePolicy: permissionPolicy,
      unsupportedCapabilities: ['sandbox.toolAllowlistOnly'],
      runtimeVersion: '0.85.1',
      platform: process.platform,
    },
    adapterPolicy: {
      version: 1,
      workDir: process.cwd(),
      fileAccess,
      externalCapabilities: { ...permissionPolicy.externalCapabilities },
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: [],
      sessionEnvKeys: [],
      shellSubprocess: { inherit: 'none', allowedEnvKeys: [], deniedEnvKeys: [] },
    },
  }
}

function harness() {
  const adapter = new PiCodingAgentAdapter()
  const internal = adapter as unknown as TestablePiAdapter
  internal.runId = 'run-pi-test'
  internal.seq = 0
  internal.active = true
  internal.terminal = false
  internal.agentSessionId = 'pi-session-1'
  internal.processEnv = { HOME: '/__shennian_pi_diagnostic_test_missing__' }
  const events: AgentEvent[] = []
  adapter.on('agentEvent', (event) => events.push(event))
  return { adapter, internal, events }
}

describe('PiCodingAgentAdapter', () => {
  it('maps text, thinking, tools and usage, and only settles once', () => {
    const { internal, events } = harness()
    internal.handleRpcEvent({
      type: 'message_update',
      usage: { input: 12, output: 4 },
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    })
    internal.handleRpcEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'private' },
    })
    internal.handleRpcEvent({
      type: 'tool_execution_start',
      toolName: 'read',
      args: { path: 'README.md' },
    })
    internal.handleRpcEvent({
      type: 'tool_execution_end',
      toolName: 'read',
      result: { content: [{ type: 'text', text: 'contents' }] },
    })
    internal.handleRpcEvent({ type: 'agent_end', willRetry: false })
    internal.handleRpcEvent({ type: 'agent_settled' })
    internal.handleRpcEvent({ type: 'agent_settled' })

    expect(events).toEqual([
      expect.objectContaining({ state: 'delta', text: 'hello' }),
      expect.objectContaining({ state: 'delta', text: 'private', thinking: true }),
      expect.objectContaining({ state: 'tool-call', name: 'read' }),
      expect.objectContaining({ state: 'tool-result', name: 'read', result: 'contents' }),
      expect.objectContaining({
        state: 'final',
        agentSessionId: 'pi-session-1',
        usage: { inputTokens: 12, outputTokens: 4 },
      }),
    ])
  })

  it('does not expose bash for a non-Room workspace-read run', () => {
    const { internal } = harness()
    internal.managedAgentPolicy = policy('workspace-read')
    internal.extraEnv = {}
    expect(internal.managedTools()).toEqual(['read', 'grep', 'find', 'ls'])
  })

  it('adds write tools for workspace-write and bash only for scoped Room or Manager work', () => {
    const { internal } = harness()
    internal.managedAgentPolicy = policy('workspace-write')
    internal.extraEnv = { SHENNIAN_MANAGED_ROOM_CONTEXT: 'short-room-capability' }
    expect(internal.managedTools()).toEqual(['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'])
  })

  it('rejects a public visitor before spawning Pi when runtime isolation is only partial', async () => {
    const { adapter, internal } = harness()
    internal.managedAgentPolicy = policy('workspace-read')
    internal.ensureProcess = vi.fn(async () => {})
    await expect(adapter.send('hello', undefined, undefined, undefined, null, {
      source: 'published_agent',
    })).rejects.toThrow('public_agent_policy_unavailable')
    expect(internal.ensureProcess).not.toHaveBeenCalled()
  })

  it('marks a verified public visitor turn when starting the Pi process', async () => {
    const { adapter, internal } = harness()
    const managed = policy('workspace-read')
    managed.enforcement.level = 'hard'
    managed.enforcement.unsupportedCapabilities = []
    managed.enforcement.executableFingerprint = 'sha256:verified-test-binary'
    internal.managedAgentPolicy = managed
    internal.workDir = process.cwd()
    internal.ensureProcess = vi.fn(async () => {})
    internal.readState = vi.fn(async () => ({ isStreaming: false, messageCount: 0 }))
    internal.rpc = { request: vi.fn(async () => ({ success: true })) }
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      await adapter.send('hello', undefined, undefined, undefined, null, {
        source: 'published_agent',
      })
      expect(internal.ensureProcess).toHaveBeenCalledWith(null, true)
      expect(internal.rpc.request).toHaveBeenCalledWith('prompt', { message: 'hello' })
    } finally {
      info.mockRestore()
    }
  })

  it('fails a model error once even if agent_settled follows', () => {
    const { internal, events } = harness()
    internal.handleRpcEvent({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'provider unavailable' },
    })
    internal.handleRpcEvent({ type: 'agent_settled' })
    expect(events).toEqual([
      expect.objectContaining({ state: 'error', message: 'Pi model request failed: Provider unavailable' }),
    ])
  })

  it('preserves a provider 403 as a model error without reclassifying it as a Room permission error', () => {
    const { internal, events } = harness()
    const message = '403 {"error":{"type":"forbidden","message":"Request not allowed"}}'
    internal.handleRpcEvent({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: message },
    })
    internal.handleRpcEvent({ type: 'agent_settled' })
    expect(events).toEqual([expect.objectContaining({
      state: 'error',
      message: 'Pi model request failed (HTTP 403): Request not allowed',
    })])
  })

  it.each([
    ['another-provider', 'deepseek-flash', 'selected-provider/deepseek-flash', 'deepseek-flash'],
    ['selected-provider', 'another-model', 'selected-provider/deepseek-flash', 'deepseek-flash'],
    ['selected-provider', 'another-model', 'selected-provider/vendor/deepseek-flash', 'vendor/deepseek-flash'],
  ])('selects the exact provider/model before prompting (%s, %s)', async (provider, id, selection, modelId) => {
    const { adapter, internal } = harness()
    internal.ensureProcess = vi.fn(async () => {})
    internal.readState = vi.fn(async () => ({ isStreaming: false, messageCount: 0, model: { provider, id } }))
    internal.rpc = { request: vi.fn(async () => ({ success: true })) }
    internal.workDir = process.cwd()
    await adapter.send('hello', selection)
    expect(internal.rpc.request.mock.calls).toEqual([
      ['set_model', { provider: 'selected-provider', modelId }],
      ['prompt', { message: 'hello' }],
    ])
  })

  it('keeps an already matching provider/model and does not switch it to a default', async () => {
    const { adapter, internal } = harness()
    internal.ensureProcess = vi.fn(async () => {})
    internal.readState = vi.fn(async () => ({
      isStreaming: false, model: { provider: 'selected-provider', id: 'deepseek-flash' },
    }))
    internal.rpc = { request: vi.fn(async () => ({ success: true })) }
    internal.workDir = process.cwd()
    await adapter.send('hello', 'selected-provider/deepseek-flash')
    expect(internal.rpc.request.mock.calls).toEqual([['prompt', { message: 'hello' }]])
  })

  it('correlates request and outcome diagnostics without logging prompt, tool arguments, or credentials', async () => {
    const { adapter, internal } = harness()
    const secret = 'synthetic-deepseek-key-never-log'
    const privatePrompt = 'private room prompt must not be logged'
    const privateToolPath = '/private/project/customer-file.txt'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    internal.ensureProcess = vi.fn(async () => {})
    internal.processEnv = { HOME: '/__shennian_pi_diagnostic_test_missing__', DEEPSEEK_API_KEY: secret }
    internal.readState = vi.fn(async () => ({
      isStreaming: false,
      messageCount: 7,
      model: { provider: 'deepseek', id: 'deepseek-flash', api: 'openai-completions', baseUrl: 'https://api.deepseek.com?token=private' },
    }))
    internal.rpc = { request: vi.fn(async () => ({ success: true })) }
    internal.workDir = process.cwd()

    await adapter.send(privatePrompt, 'deepseek/deepseek-flash', undefined, undefined, null, {
      source: 'room_activation',
      modelSelectionSource: 'room_effective_model',
    })
    internal.handleRpcEvent({ type: 'tool_execution_start', toolName: 'read', args: { path: privateToolPath } })
    internal.handleRpcEvent({ type: 'agent_settled' })

    const lines = info.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('[pi.diagnostic]'))
    expect(lines).toHaveLength(2)
    const records = lines.map((line) => JSON.parse(line.replace(/^\[pi\.diagnostic\] /, '')))
    expect(records[0]).toMatchObject({
      phase: 'request_config',
      modelSelectionSource: 'room_effective_model',
      provider: 'deepseek',
      model: 'deepseek-flash',
      historyMessageCount: 7,
      finalHttpRequestObserved: false,
    })
    expect(records[1]).toMatchObject({ phase: 'outcome', outcome: 'completed', toolCallCount: 1 })
    expect(records[1].marker).toBe(records[0].marker)
    expect(lines.join('\n')).not.toContain(secret)
    expect(lines.join('\n')).not.toContain(privatePrompt)
    expect(lines.join('\n')).not.toContain(privateToolPath)
    info.mockRestore()
  })

  it('does not prompt with the previous model when Pi rejects the selected model', async () => {
    const { adapter, internal } = harness()
    internal.ensureProcess = vi.fn(async () => {})
    internal.readState = vi.fn(async () => ({
      isStreaming: false, model: { provider: 'other-provider', id: 'deepseek-flash' },
    }))
    internal.rpc = { request: vi.fn(async () => { throw new Error('Model not found') }) }
    await expect(adapter.send('hello', 'selected-provider/deepseek-flash')).rejects.toThrow('Model not found')
    expect(internal.rpc.request.mock.calls).toEqual([
      ['set_model', { provider: 'selected-provider', modelId: 'deepseek-flash' }],
    ])
  })

  it('steers direct corrections but queues Room activation follow-ups', async () => {
    const direct = harness()
    direct.internal.ensureProcess = vi.fn(async () => {})
    direct.internal.readState = vi.fn(async () => ({ isStreaming: true }))
    direct.internal.rpc = { request: vi.fn(async () => ({ type: 'response', success: true })) }
    direct.internal.workDir = process.cwd()
    direct.internal.shennianSessionId = 'session-direct'
    await direct.adapter.send('correct course')
    expect(direct.internal.rpc.request).toHaveBeenLastCalledWith(
      'steer', expect.objectContaining({ message: 'correct course' }),
    )

    const room = harness()
    room.internal.ensureProcess = vi.fn(async () => {})
    room.internal.readState = vi.fn(async () => ({ isStreaming: true }))
    room.internal.rpc = { request: vi.fn(async () => ({ type: 'response', success: true })) }
    room.internal.workDir = process.cwd()
    room.internal.shennianSessionId = 'session-room'
    await room.adapter.send('next room message', undefined, undefined, undefined, null, {
      source: 'room_activation',
    })
    expect(room.internal.rpc.request).toHaveBeenLastCalledWith(
      'follow_up', expect.objectContaining({ message: 'next room message' }),
    )
  })

  it('injects explicitly only while the current Pi run is active', async () => {
    const { adapter, internal } = harness()
    internal.readState = vi.fn(async () => ({ isStreaming: true }))
    internal.rpc = { request: vi.fn(async () => ({ type: 'response', success: true })) }
    internal.workDir = process.cwd()
    internal.shennianSessionId = 'session-direct'
    await adapter.injectActiveInput({ text: 'new constraint' })
    expect(internal.rpc.request).toHaveBeenCalledWith(
      'steer', expect.objectContaining({ message: 'new constraint' }),
    )
  })

  it('respawns the resident process only when the Room grant changed and the run is idle', async () => {
    const { internal } = harness()
    internal.rpc = { request: vi.fn() }
    internal.spawnedRoomContext = 'grant-1'

    internal.extraEnv = { SHENNIAN_MANAGED_ROOM_CONTEXT: 'grant-1' }
    internal.readState = vi.fn(async () => ({ isStreaming: false }))
    await expect(internal.roomContextStale()).resolves.toBe(false)

    internal.extraEnv = { SHENNIAN_MANAGED_ROOM_CONTEXT: 'grant-2' }
    await expect(internal.roomContextStale()).resolves.toBe(true)

    internal.readState = vi.fn(async () => ({ isStreaming: true }))
    await expect(internal.roomContextStale()).resolves.toBe(false)
  })
})
