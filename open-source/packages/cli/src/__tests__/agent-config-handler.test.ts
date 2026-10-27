// @covers src/session/handlers/agent-config.ts

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AgentEvent } from '../agents/adapter.js'
import { handleAgentConfigTest } from '../session/handlers/agent-config.js'
import type { SessionManagerRuntime } from '../session/types.js'

const { mockCreateAgent } = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
}))

vi.mock('../agents/adapter.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../agents/adapter.js')>()
  return { ...original, createAgent: mockCreateAgent }
})

vi.mock('../agents/config-status.js', () => ({
  buildManagedAgentEnv: vi.fn(() => ({ OPENAI_API_KEY: 'test-key' })),
  deleteManagedAgentProviderConfig: vi.fn(),
  getAgentConfigSummary: vi.fn(() => ({ status: 'managed', source: 'shennian', tokenPresent: true })),
  upsertManagedAgentProviderConfig: vi.fn(),
}))

vi.mock('../config/index.js', () => ({
  resolveShennianPath: (...parts: string[]) => `/tmp/shennian-test/${parts.join('/')}`,
}))

function mockRuntime(): SessionManagerRuntime {
  return {
    client: {
      sendRes: vi.fn(),
    },
    pendingTransfers: new Map(),
    processedReqIds: new Set(),
    reloadCustomAgents: vi.fn(),
    resolvePath: (value: string) => value,
    resolveAuthorizedPath: (value: string) => ({ ok: true, path: value }),
    runTextAcc: new Map(),
    sessions: new Map(),
    evictIdleSessions: vi.fn(),
    nativeFusion: null,
    managerRuntime: null,
    chatQueue: null,
  } as unknown as SessionManagerRuntime
}

function mockAdapter() {
  const adapter = Object.assign(new EventEmitter(), {
    type: 'codex',
    configure: vi.fn(),
    start: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  })
  return adapter
}

describe('agent config test handler', () => {
  beforeEach(() => {
    mockCreateAgent.mockReset()
  })

  it('runs a real adapter smoke prompt through the existing config test method', async () => {
    const adapter = mockAdapter()
    adapter.send.mockImplementation(async () => {
      adapter.emit('agentEvent', {
        state: 'delta',
        runId: 'run-test',
        seq: 1,
        text: 'OK',
      } satisfies AgentEvent)
    })
    mockCreateAgent.mockReturnValue(adapter)
    const runtime = mockRuntime()

    await handleAgentConfigTest(runtime, {
      type: 'req',
      id: 'req-1',
      method: 'agent.config.test',
      params: { agent: 'codex' },
    })

    expect(adapter.configure).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringContaining('agent-test-codex-'),
      env: { OPENAI_API_KEY: 'test-key' },
    }))
    expect(adapter.start).toHaveBeenCalledWith(
      expect.stringContaining('agent-test-codex-'),
      '/tmp/shennian-test/tmp/agent-config-test',
      null,
    )
    expect(adapter.send).toHaveBeenCalledWith('这是一次神念连接测试。请只回复 OK，不要解释。')
    expect(adapter.stop).toHaveBeenCalledTimes(1)
    expect(runtime.client.sendRes).toHaveBeenCalledWith(expect.objectContaining({
      id: 'req-1',
      ok: true,
      payload: expect.objectContaining({
        agent: 'codex',
        test: { mode: 'agent-run', reply: 'OK' },
      }),
    }))
  })

  it('returns adapter errors as config test failures', async () => {
    const adapter = mockAdapter()
    adapter.send.mockImplementation(async () => {
      adapter.emit('agentEvent', {
        state: 'error',
        runId: 'run-test',
        seq: 1,
        message: 'login required',
      } satisfies AgentEvent)
    })
    mockCreateAgent.mockReturnValue(adapter)
    const runtime = mockRuntime()

    await handleAgentConfigTest(runtime, {
      type: 'req',
      id: 'req-2',
      method: 'agent.config.test',
      params: { agent: 'codex' },
    })

    expect(adapter.stop).toHaveBeenCalledTimes(1)
    expect(runtime.client.sendRes).toHaveBeenCalledWith(expect.objectContaining({
      id: 'req-2',
      ok: false,
      error: 'login required',
    }))
  })
})
