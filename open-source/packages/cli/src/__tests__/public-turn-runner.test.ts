// @covers open-source/packages/cli/src/agents/public-turn-runner.ts

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter } from '../agents/adapter.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import type { PublicAgentClaim } from '../agents/public-delivery-client.js'
import { preparePublicAgentWorkDir } from '../agents/public-workdir.js'
import { runPublicAgentTurn } from '../agents/public-turn-runner.js'

vi.mock('../agents/public-workdir.js', () => ({
  preparePublicAgentWorkDir: vi.fn(async (workDir: string) => workDir),
}))

const claim: PublicAgentClaim = {
  messageId: 'message-1', conversationId: 'conversation-1',
  agentIdentityId: 'agent-1', runtimeAdapter: 'codex',
  executableFingerprint: `sha256:${'a'.repeat(64)}`,
  bindingId: 'binding-1', bindingEpoch: 1, sequence: '1', text: 'hello',
  leaseToken: 'x'.repeat(43), leaseExpiresAt: '2026-09-26T00:10:00Z',
}
const policy = {
  executionMode: 'restricted',
  requestedPolicy: { version: 1, executionMode: 'restricted', fileAccess: 'workspace-read',
    externalCapabilities: { commandNetwork: false, webSearch: false, browser: false,
      computerUse: false, mcp: false } },
  enforcement: { level: 'hard', executableFingerprint: 'sha256:verified',
    effectivePolicy: { fileAccess: 'workspace-read', externalCapabilities: {
      commandNetwork: false, webSearch: false, browser: false, computerUse: false, mcp: false } },
    unsupportedCapabilities: [] },
  adapterPolicy: { workDir: '/private/owner-agent', fileAccess: 'workspace-read',
    denySensitiveFiles: true, failClosed: true, externalCapabilities: { commandNetwork: false,
      webSearch: false, browser: false, computerUse: false, mcp: false } },
  environmentPolicy: { inheritDaemonEnv: false, loadLoginShell: false },
} as unknown as CompiledManagedAgentPolicy

function fixture(sessionId = 'session-1', nativeId = 'native-1') {
  const events: string[] = []
  const emitter = new EventEmitter()
  const adapter = Object.assign(emitter, {
    type: 'codex',
    configure: vi.fn(() => events.push('configure')),
    start: vi.fn(async () => { events.push('start') }),
    send: vi.fn(async () => {
      events.push('send')
      emitter.emit('nativeSession', 'codex', nativeId)
      emitter.emit('agentEvent', { state: 'delta', runId: 'run-1', seq: 1, text: 'answer' })
      emitter.emit('agentEvent', { state: 'final', runId: 'run-1', seq: 2 })
    }),
    stop: vi.fn(async () => { events.push('stop') }),
  }) as unknown as AgentAdapter
  const delivery = {
    checkLease: vi.fn(async () => { events.push('check') }),
    prepareSession: vi.fn(async () => { events.push('prepare'); return {
      nianSessionId: sessionId, bindingId: 'binding-1', bindingEpoch: 1,
      nativeSessionId: null as string | null,
      workDir: '/private/owner-agent',
    } }),
    saveNativeSession: vi.fn(async () => { events.push('save-native') }),
    complete: vi.fn(async () => { events.push('complete'); return {
      replyMessageId: 'reply-1', sequence: '2', idempotent: false,
    } }),
    fail: vi.fn(async () => { events.push('fail') }),
  }
  return { adapter, delivery, events }
}

describe('public Agent turn runner', () => {
  it('uses an explicit probe workspace instead of a production Agent directory', async () => {
    const { adapter, delivery } = fixture()
    const probeDir = '/home/test/tmp/shennian-tests/run/conversation-1'
    const prepareWorkDir = vi.fn(async () => probeDir)
    await runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery,
      createAdapter: () => adapter, prepareWorkDir,
      compilePolicy: async () => ({ ...policy,
        adapterPolicy: { ...policy.adapterPolicy, workDir: probeDir } }),
      systemPrompt: 'Probe' })
    expect(prepareWorkDir).toHaveBeenCalledWith('conversation-1')
    expect(adapter.start).toHaveBeenCalledWith('session-1', probeDir, null,
      { nativeSessionVisibility: 'internal' })
  })

  it('starts an isolated private Session and submits only the collected reply', async () => {
    const { adapter, delivery, events } = fixture()
    await runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/private/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => policy,
      systemPrompt: 'Owner instructions' })
    expect(adapter.start).toHaveBeenCalledWith('session-1',
      '/private/owner-agent', null,
      { nativeSessionVisibility: 'internal' })
    expect(adapter.configure).toHaveBeenCalledWith(expect.objectContaining({ env: {} }))
    expect(adapter.send).toHaveBeenCalledWith('hello', undefined, undefined,
      undefined, expect.stringContaining('Owner instructions'), { source: 'published_agent' })
    expect(delivery.complete).toHaveBeenCalledWith({ machineToken: 'machine-secret',
      claim, replyText: 'answer' })
    expect(delivery.saveNativeSession).toHaveBeenCalledWith({ machineToken: 'machine-secret',
      claim, nianSessionId: 'session-1', nativeSessionId: 'native-1' })
    expect(events).toEqual(['check', 'prepare', 'check', 'configure', 'start', 'send',
      'save-native', 'check', 'complete', 'stop'])
  })

  it('uses one Agent directory while keeping two visitors in different native contexts', async () => {
    const first = fixture()
    const second = fixture('session-2', 'native-2')
    const secondClaim = { ...claim, conversationId: 'conversation-2', messageId: 'message-2', bindingId: 'binding-2' }
    for (const [turn, visitorClaim] of [[first, claim], [second, secondClaim]] as const) {
      await runPublicAgentTurn({ claim: visitorClaim, machineToken: 'machine-secret',
        delivery: turn.delivery, workDir: '/private/owner-agent',
        createAdapter: () => turn.adapter, compilePolicy: async () => policy, systemPrompt: '' })
    }
    expect(first.adapter.start).toHaveBeenCalledWith('session-1', '/private/owner-agent', null,
      { nativeSessionVisibility: 'internal' })
    expect(second.adapter.start).toHaveBeenCalledWith('session-2', '/private/owner-agent', null,
      { nativeSessionVisibility: 'internal' })
    expect(first.delivery.saveNativeSession).toHaveBeenCalledWith(expect.objectContaining({
      claim, nianSessionId: 'session-1', nativeSessionId: 'native-1',
    }))
    expect(second.delivery.saveNativeSession).toHaveBeenCalledWith(expect.objectContaining({
      claim: secondClaim, nianSessionId: 'session-2', nativeSessionId: 'native-2',
    }))
    expect(preparePublicAgentWorkDir).toHaveBeenLastCalledWith('/private/owner-agent')
  })

  it('resumes this visitor context in the Agent directory rather than starting another conversation', async () => {
    const { adapter, delivery } = fixture()
    delivery.prepareSession.mockResolvedValue({ nianSessionId: 'session-1', bindingId: 'binding-1',
      bindingEpoch: 1, nativeSessionId: 'native-1', workDir: '/private/owner-agent' })
    await runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/private/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => policy, systemPrompt: '' })
    expect(adapter.start).toHaveBeenCalledWith('session-1', '/private/owner-agent', 'native-1',
      { nativeSessionVisibility: 'internal' })
  })

  it('compiles a directory alias to its realpath but sends the saved spelling to the Server', async () => {
    const { adapter, delivery } = fixture()
    vi.mocked(preparePublicAgentWorkDir).mockResolvedValueOnce('/private/owner-agent')
    await runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/alias/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => policy, systemPrompt: '' })
    expect(delivery.prepareSession).toHaveBeenCalledWith({ claim, machineToken: 'machine-secret',
      workDir: '/alias/owner-agent' })
    expect(adapter.start).toHaveBeenCalledWith('session-1', '/private/owner-agent', null,
      { nativeSessionVisibility: 'internal' })
  })

  it('rejects a policy that would silently select an unrelated directory', async () => {
    const { adapter, delivery } = fixture()
    await expect(runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/private/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => ({ ...policy,
        adapterPolicy: { ...policy.adapterPolicy, workDir: '/private/another-agent' } }),
      systemPrompt: '' })).rejects.toThrow('public_agent_workdir_mismatch')
    expect(adapter.start).not.toHaveBeenCalled()
    expect(delivery.prepareSession).not.toHaveBeenCalled()
  })

  it('submits a scoped pause signal without exposing the private marker in the reply', async () => {
    const { adapter, delivery } = fixture()
    vi.mocked(adapter.send).mockImplementation(async (...args) => {
      const prompt = args[4] as string
      const marker = prompt.match(/\[\[SHENNIAN_PAUSE_VISITOR:[A-Za-z0-9_-]+\]\]/)![0]
      ;(adapter as unknown as { emit: (event: string, ...payload: unknown[]) => void })
        .emit('nativeSession', 'codex', 'native-1')
      ;(adapter as unknown as { emit: (event: string, payload: unknown) => void })
        .emit('agentEvent', { state: 'delta', runId: 'run-1', seq: 1,
          text: `${marker}\n这段对话已暂停。` })
      ;(adapter as unknown as { emit: (event: string, payload: unknown) => void })
        .emit('agentEvent', { state: 'final', runId: 'run-1', seq: 2 })
    })
    await runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/private/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => policy,
      systemPrompt: 'Owner instructions' })
    expect(delivery.complete).toHaveBeenCalledWith({ machineToken: 'machine-secret',
      claim, replyText: '这段对话已暂停。', pauseConversation: true })
  })

  it('starts a partial (tool-layer-only, no full OS sandbox) Adapter the same as Room chat already accepts', async () => {
    const { adapter, delivery, events } = fixture()
    await runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/private/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => ({ ...policy,
        enforcement: { ...policy.enforcement, level: 'partial' } }),
      systemPrompt: 'Owner instructions' })
    expect(adapter.start).toHaveBeenCalled()
    expect(events).toContain('complete')
  })

  it('refuses to start an adapter when the runtime declaration is unverified', async () => {
    const { adapter, delivery } = fixture()
    await expect(runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/private/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => ({ ...policy,
        enforcement: { ...policy.enforcement, level: 'unverified' } }),
      systemPrompt: '',
    })).rejects.toThrow('public_agent_policy_unavailable')
    expect(adapter.start).not.toHaveBeenCalled()
    expect(delivery.fail).toHaveBeenCalledWith({ machineToken: 'machine-secret',
      claim, failureCode: 'runtime_unavailable' })
  })

  it('reports a sanitized provider limit failure to the visitor message', async () => {
    const { adapter, delivery } = fixture()
    vi.mocked(adapter.send).mockRejectedValue(new Error('insufficient quota for model account'))
    await expect(runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/private/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => policy,
      systemPrompt: '',
    })).rejects.toMatchObject({ code: 'provider_limit' })
    expect(delivery.fail).toHaveBeenCalledWith({ machineToken: 'machine-secret',
      claim, failureCode: 'provider_limit' })
  })

  it('reports an unauthorized_tool_attempt failure when a public turn requests interactive approval', async () => {
    const { adapter, delivery } = fixture()
    vi.mocked(adapter.send).mockImplementation(async () => {
      ;(adapter as unknown as { emit: (event: string, payload: unknown) => void })
        .emit('agentEvent', { state: 'approval-pending', runId: 'run-1', seq: 1, name: 'bash' })
    })
    await expect(runPublicAgentTurn({ claim, machineToken: 'machine-secret', delivery, workDir: '/private/owner-agent',
      createAdapter: () => adapter, compilePolicy: async () => policy,
      systemPrompt: '',
    })).rejects.toMatchObject({ code: 'unauthorized_tool_attempt' })
    expect(delivery.fail).toHaveBeenCalledWith({ machineToken: 'machine-secret',
      claim, failureCode: 'unauthorized_tool_attempt' })
    expect(adapter.stop).toHaveBeenCalled()
  })
})
