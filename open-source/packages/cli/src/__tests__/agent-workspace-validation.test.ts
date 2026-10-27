// @covers src/session/handlers/agent-workspace-validation.ts

import { describe, expect, it, vi } from 'vitest'
import { AgentAdapter, type AgentEvent } from '../agents/adapter.js'
import {
  AGENT_VALIDATION_MAX_DURATION_MS,
  validateAgentWorkspaceConfiguration,
} from '../session/handlers/agent-workspace-validation.js'
import { AGENT_READINESS_IPC_TIMEOUT_MS } from '../commands/agent-readiness.js'

class ValidationAdapter extends AgentAdapter {
  readonly type = 'codex' as const
  readonly stop = vi.fn(async () => {})

  constructor(
    private readonly events: AgentEvent[] = [],
    private readonly sendError?: Error,
  ) {
    super()
  }

  async start() {}
  async resume() {}
  async send() {
    if (this.sendError) throw this.sendError
    for (const event of this.events) this.emit('agentEvent', event)
  }
}

const baseInput = {
  runtimeAdapter: 'codex' as const,
  workDir: '/workspace',
  modelId: null,
  sessionMode: 'standard' as const,
  systemPrompt: '你是测试智能体',
}

describe('managed Agent workspace validation', () => {
  it.each([
    ['429 rate limit exceeded', 'agent_validation_quota_exceeded'],
    ['insufficient credits', 'agent_validation_quota_exceeded'],
    ['quota exhausted for this account', 'agent_validation_quota_exceeded'],
    ['fetch failed: ECONNRESET', 'agent_validation_network_failed'],
    ['network connection closed during request', 'agent_validation_network_failed'],
    ['unknown model example', 'agent_validation_model_unavailable'],
    ['permission denied for model restricted-model', 'agent_validation_model_unavailable'],
    ['not logged in to provider CLI', 'agent_validation_runtime_auth_required'],
    ['403 expired token', 'agent_validation_runtime_auth_required'],
  ])('classifies a real reply-path rejection without reporting ready: %s', async (message, errorCode) => {
    const adapter = new ValidationAdapter([], new Error(message))
    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter: () => adapter, resolveWorkDir: async () => '/workspace',
    })).resolves.toEqual({ ok: false, errorCode })
    expect(adapter.stop).toHaveBeenCalled()
  })
  it('accepts hello anywhere in the final Agent response, case-insensitively', async () => {
    const adapter = new ValidationAdapter([
      { state: 'delta', runId: 'run-1', seq: 1, text: '好的，HeLLo！' },
      { state: 'final', runId: 'run-1', seq: 2, agentSessionId: 'native-1' },
    ])
    const cleanup = vi.fn()
    const ignoreNativeSession = vi.fn()

    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter: () => adapter,
      resolveWorkDir: async () => '/workspace',
      cleanupNativeSession: cleanup,
      ignoreNativeSession,
    })).resolves.toEqual({ ok: true })
    expect(adapter.stop).toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledWith('codex', 'native-1', '/workspace')
    expect(ignoreNativeSession).toHaveBeenCalledWith('codex', 'native-1')
  })

  it('rejects a completed response that does not contain hello', async () => {
    const adapter = new ValidationAdapter([
      { state: 'delta', runId: 'run-2', seq: 1, text: '你好，我准备好了。' },
      { state: 'final', runId: 'run-2', seq: 2 },
    ])

    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter: () => adapter,
      resolveWorkDir: async () => '/workspace',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_validation_response_mismatch',
    })
  })

  it('reports a missing work directory before starting an Agent', async () => {
    const createAdapter = vi.fn()
    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter,
      resolveWorkDir: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_validation_workdir_not_found',
    })
    expect(createAdapter).not.toHaveBeenCalled()
  })

  it('rejects a relative work directory before resolving or starting an Agent', async () => {
    const resolveWorkDir = vi.fn(async () => '/workspace')
    const createAdapter = vi.fn()
    await expect(validateAgentWorkspaceConfiguration(
      { ...baseInput, workDir: 'relative/project' },
      { createAdapter, resolveWorkDir },
    )).resolves.toEqual({
      ok: false,
      errorCode: 'agent_validation_workdir_invalid',
    })
    expect(resolveWorkDir).not.toHaveBeenCalled()
    expect(createAdapter).not.toHaveBeenCalled()
  })

  it('rejects a workspace that contains Shennian credentials before starting an Agent', async () => {
    const createAdapter = vi.fn()
    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter,
      resolveWorkDir: async () => '/workspace',
      validateWorkDir: async () => false,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_validation_workdir_invalid',
    })
    expect(createAdapter).not.toHaveBeenCalled()
  })

  it('returns a specific authentication error from the real send path', async () => {
    const adapter = new ValidationAdapter([], new Error('401 authentication required'))
    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter: () => adapter,
      resolveWorkDir: async () => '/workspace',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_validation_runtime_auth_required',
    })
  })

  it.each([
    ['hello', { ok: true }],
    ['ready', { ok: false, errorCode: 'agent_validation_response_mismatch' }],
  ])('requires an actual Pi reply: %s', async (text, expected) => {
    const adapter = new ValidationAdapter([{ state: 'final', runId: 'pi-run', seq: 1, text }])
    adapter.start = vi.fn(async () => {})
    const send = vi.spyOn(adapter, 'send')
    await expect(validateAgentWorkspaceConfiguration({ ...baseInput, runtimeAdapter: 'pi-coding-agent' }, {
      createAdapter: () => adapter, resolveWorkDir: async () => '/workspace',
    })).resolves.toEqual(expected)
    expect(send).toHaveBeenCalledWith('请回复 hello，用于确认你已准备好。', undefined)
    expect(adapter.start).toHaveBeenCalledWith(
      expect.stringMatching(/^agent-validation-/), '/workspace', null, { persistNativeSession: false },
    )
    expect(adapter.stop).toHaveBeenCalled()
  })

  it.each(['timeout', 'auth', 'start'])('stops Pi on %s failure and never reports ready', async (failure) => {
    const adapter = new ValidationAdapter([{ state: 'final', runId: 'pi-run', seq: 1, text: 'hello' }])
    if (failure === 'timeout') adapter.send = async () => await new Promise<void>(() => {})
    if (failure === 'auth') adapter.send = async () => { throw new Error('401 authentication required') }
    if (failure === 'start') adapter.start = async () => { throw new Error('start failed') }
    const result = await validateAgentWorkspaceConfiguration({ ...baseInput, runtimeAdapter: 'pi-coding-agent' }, {
      createAdapter: () => adapter, resolveWorkDir: async () => '/workspace', timeoutMs: 5,
    })
    expect(result.ok).toBe(false)
    expect(adapter.stop).toHaveBeenCalled()
  })

  it('times out even when an adapter never finishes dispatching the test message', async () => {
    const adapter = new ValidationAdapter()
    adapter.send = vi.fn(async () => await new Promise<void>(() => {}))
    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter: () => adapter,
      resolveWorkDir: async () => '/workspace',
      timeoutMs: 5,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_validation_response_timeout',
    })
    expect(adapter.stop).toHaveBeenCalled()
  })

  it('reports a start that never finishes as a start failure and still stops the adapter', async () => {
    const adapter = new ValidationAdapter()
    adapter.start = vi.fn(async () => await new Promise<void>(() => {}))
    const send = vi.spyOn(adapter, 'send')
    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter: () => adapter,
      resolveWorkDir: async () => '/workspace',
      timeoutMs: 5,
    })).resolves.toEqual({ ok: false, errorCode: 'agent_validation_start_failed' })
    expect(send).not.toHaveBeenCalled()
    expect(adapter.stop).toHaveBeenCalled()
  })

  it('does not wait forever for an adapter whose stop never returns', async () => {
    const adapter = new ValidationAdapter()
    adapter.send = vi.fn(async () => await new Promise<void>(() => {}))
    adapter.stop.mockImplementation(async () => await new Promise<void>(() => {}))
    const started = Date.now()
    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter: () => adapter,
      resolveWorkDir: async () => '/workspace',
      timeoutMs: 5,
      stopTimeoutMs: 20,
    })).resolves.toEqual({ ok: false, errorCode: 'agent_validation_response_timeout' })
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('skips native session cleanup after a timeout but keeps the session marked internal', async () => {
    const adapter = new ValidationAdapter()
    adapter.send = vi.fn(async () => {
      adapter.emit('agentEvent', { state: 'start', runId: 'run-3', seq: 0, agentSessionId: 'native-3' })
      await new Promise<void>(() => {})
    })
    const cleanup = vi.fn()
    const ignoreNativeSession = vi.fn()
    await expect(validateAgentWorkspaceConfiguration(baseInput, {
      createAdapter: () => adapter,
      resolveWorkDir: async () => '/workspace',
      timeoutMs: 5,
      cleanupNativeSession: cleanup,
      ignoreNativeSession,
    })).resolves.toEqual({ ok: false, errorCode: 'agent_validation_response_timeout' })
    expect(ignoreNativeSession).toHaveBeenCalledWith('codex', 'native-3')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('always answers before the CLI gives up waiting for the daemon', () => {
    expect(AGENT_VALIDATION_MAX_DURATION_MS).toBeLessThan(AGENT_READINESS_IPC_TIMEOUT_MS)
  })
})
