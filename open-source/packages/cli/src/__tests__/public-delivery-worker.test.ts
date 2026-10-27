// @covers open-source/packages/cli/src/agents/public-delivery-worker.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
  DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY } from '@shennian/wire'

const mocks = vi.hoisted(() => ({ claim: vi.fn(), fail: vi.fn(), run: vi.fn(), compile: vi.fn() }))
vi.mock('../agents/public-delivery-client.js', () => ({
  HttpPublicAgentDeliveryClient: class {
    claim = mocks.claim
    fail = mocks.fail
  },
}))
vi.mock('../agents/public-turn-runner.js', () => ({ runPublicAgentTurn: mocks.run }))
vi.mock('../security/managed-agent-policy.js', () => ({ compileManagedAgentPolicy: mocks.compile }))

import { PublicAgentDeliveryWorker } from '../agents/public-delivery-worker.js'

describe('public Agent delivery worker lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('claims only while the paired daemon is connected and resumes after reconnect', async () => {
    vi.useFakeTimers()
    mocks.claim.mockResolvedValue(null)
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token',
      getDetectedAgents: async () => [],
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.claim).toHaveBeenCalledTimes(1)
    worker.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.claim).toHaveBeenCalledTimes(1)
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.claim).toHaveBeenCalledTimes(2)
    worker.stop()
  })

  it('releases a claim that arrives after the daemon disconnects', async () => {
    vi.useFakeTimers()
    let resolveClaim!: (claim: object) => void
    mocks.claim.mockImplementation(() => new Promise((resolve) => { resolveClaim = resolve }))
    mocks.fail.mockResolvedValue(undefined)
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token', getDetectedAgents: async () => [],
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    worker.stop()
    const claim = { messageId: 'message-1' }
    resolveClaim(claim)
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.fail).toHaveBeenCalledWith({
      machineToken: 'paired-machine-token', claim, failureCode: 'execution_failed',
    })
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('aborts Agent definition loading when the daemon disconnects', async () => {
    vi.useFakeTimers()
    const claim = { messageId: 'message-1', agentIdentityId: 'agent-1' }
    mocks.claim.mockResolvedValue(claim)
    mocks.fail.mockResolvedValue(undefined)
    const fetchMock = vi.fn((_url: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }))
    vi.stubGlobal('fetch', fetchMock)
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token', getDetectedAgents: async () => [],
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    worker.stop()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true)
    expect(mocks.fail).toHaveBeenCalledWith({ machineToken: 'paired-machine-token',
      claim, failureCode: 'runtime_unavailable' })
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('rejects a changed executable before starting the public Agent', async () => {
    vi.useFakeTimers()
    const claim = { messageId: 'message-1', agentIdentityId: 'agent-1',
      runtimeAdapter: 'codex', executableFingerprint: `sha256:${'a'.repeat(64)}` }
    mocks.claim.mockResolvedValue(claim)
    mocks.fail.mockResolvedValue(undefined)
    const onRuntimeChanged = vi.fn(async () => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ agent: {
      id: 'agent-1', machineId: 'machine-1', runtimeAdapter: 'codex',
      status: 'active', sessionMode: 'standard', systemPrompt: '', modelId: null, workDir: '/tmp/owner-agent',
      permissionPolicy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
    } }), { status: 200 })))
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token',
      getDetectedAgents: async () => [{ type: 'codex', version: '1.0.0',
        executableFingerprint: `sha256:${'b'.repeat(64)}` }] as never,
      onRuntimeChanged,
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(onRuntimeChanged).toHaveBeenCalledTimes(1)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledWith({ machineToken: 'paired-machine-token',
      claim, failureCode: 'runtime_unavailable' })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.claim).toHaveBeenCalledTimes(1)
  })

  it('rejects an Agent that changed to Manager mode before execution', async () => {
    vi.useFakeTimers()
    const claim = { messageId: 'message-1', agentIdentityId: 'agent-1',
      runtimeAdapter: 'codex', executableFingerprint: `sha256:${'a'.repeat(64)}` }
    mocks.claim.mockResolvedValueOnce(claim).mockResolvedValue(null)
    mocks.fail.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ agent: {
      id: 'agent-1', machineId: 'machine-1', runtimeAdapter: 'codex',
      status: 'active', sessionMode: 'manager', systemPrompt: '', modelId: null, workDir: '/tmp/owner-agent',
      permissionPolicy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
    } }), { status: 200 })))
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token', getDetectedAgents: async () => [],
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledWith({ machineToken: 'paired-machine-token',
      claim, failureCode: 'runtime_unavailable' })
    worker.stop()
  })

  it('uses the saved Agent permission policy instead of a public default', async () => {
    vi.useFakeTimers()
    const fingerprint = `sha256:${'a'.repeat(64)}`
    const claim = { messageId: 'message-1', agentIdentityId: 'agent-1',
      runtimeAdapter: 'codex', executableFingerprint: fingerprint }
    const permissionPolicy = { ...DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
      version: 3, fileAccess: 'workspace-write' as const }
    mocks.claim.mockResolvedValueOnce(claim).mockResolvedValue(null)
    mocks.compile.mockResolvedValue({ ok: true, value: {} })
    mocks.run.mockImplementation(async (input: { compilePolicy: (workDir: string) => Promise<unknown> }) => {
      await input.compilePolicy('/tmp/public-agent-test')
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ agent: {
      id: 'agent-1', machineId: 'machine-1', runtimeAdapter: 'codex',
      status: 'active', sessionMode: 'standard', systemPrompt: '', modelId: null, workDir: '/tmp/owner-agent',
      permissionPolicy,
    } }), { status: 200 })))
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token',
      getDetectedAgents: async () => [{ type: 'codex', version: '1.0.0',
        executableFingerprint: fingerprint }] as never,
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ workDir: '/tmp/owner-agent' }))
    expect(mocks.compile).toHaveBeenCalledWith(expect.objectContaining({ policy: permissionPolicy }))
    worker.stop()
  })

  it('passes the Owner-approved native-full permission to the public compiler', async () => {
    vi.useFakeTimers()
    const fingerprint = `sha256:${'a'.repeat(64)}`
    const claim = { messageId: 'message-1', agentIdentityId: 'agent-1',
      runtimeAdapter: 'opencode', executableFingerprint: fingerprint }
    mocks.claim.mockResolvedValueOnce(claim).mockResolvedValue(null)
    mocks.compile.mockResolvedValue({ ok: true, value: {} })
    mocks.run.mockImplementation(async (input: { compilePolicy: (workDir: string) => Promise<unknown> }) => {
      await input.compilePolicy('/tmp/public-agent-test')
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ agent: {
      id: 'agent-1', machineId: 'machine-1', runtimeAdapter: 'opencode',
      status: 'active', sessionMode: 'standard', systemPrompt: '', modelId: null, workDir: '/tmp/owner-agent',
      permissionPolicy: DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
      permissionConfirmation: { policyVersion: 1, runtimeAdapter: 'opencode',
        runtimeVersion: '1.18.30', platform: 'win32', executableFingerprint: fingerprint,
        executionMode: 'native-full', hostFullAccess: true, limitedProtection: false,
        confirmedAt: '2026-09-26T00:00:00Z' },
    } }), { status: 200 })))
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token',
      getDetectedAgents: async () => [{ type: 'opencode', version: '2.0.14',
        runtimePlatform: 'linux', executableFingerprint: fingerprint }] as never,
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.compile).toHaveBeenCalledWith(expect.objectContaining({
      policy: DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
      hostFullAccessConfirmed: true, channel: 'public',
    }))
    worker.stop()
  })

  it.each([undefined, ''])('does not fall back to a visitor directory when saved workDir is %j', async (workDir) => {
    vi.useFakeTimers()
    const fingerprint = `sha256:${'a'.repeat(64)}`
    const claim = { messageId: 'message-1', agentIdentityId: 'agent-1',
      runtimeAdapter: 'codex', executableFingerprint: fingerprint }
    mocks.claim.mockResolvedValueOnce(claim).mockResolvedValue(null)
    mocks.fail.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ agent: {
      id: 'agent-1', machineId: 'machine-1', runtimeAdapter: 'codex',
      status: 'active', sessionMode: 'standard', systemPrompt: '', modelId: null, workDir,
      permissionPolicy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
    } }), { status: 200 })))
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token', getDetectedAgents: async () => [],
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledWith({ machineToken: 'paired-machine-token',
      claim, failureCode: 'runtime_unavailable' })
    worker.stop()
  })

  it('fails closed when the machine receives an incomplete Agent definition', async () => {
    vi.useFakeTimers()
    const claim = { messageId: 'message-1', agentIdentityId: 'agent-1' }
    mocks.claim.mockResolvedValueOnce(claim).mockResolvedValue(null)
    mocks.fail.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ agent: {
      id: 'agent-1', machineId: 'machine-1', runtimeAdapter: 'codex',
      status: 'active', sessionMode: 'standard', systemPrompt: '', modelId: null, workDir: '/tmp/owner-agent',
    } }), { status: 200 })))
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token', getDetectedAgents: async () => [],
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledWith({ machineToken: 'paired-machine-token',
      claim, failureCode: 'runtime_unavailable' })
    worker.stop()
  })

  it('can resume only after the changed runtime report is acknowledged', async () => {
    vi.useFakeTimers()
    let acknowledge!: () => void
    const committed = new Promise<void>((resolve) => { acknowledge = resolve })
    mocks.claim.mockResolvedValueOnce({ messageId: 'message-1', agentIdentityId: 'agent-1',
      runtimeAdapter: 'codex', executableFingerprint: `sha256:${'a'.repeat(64)}` })
      .mockResolvedValue(null)
    mocks.fail.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ agent: {
      id: 'agent-1', machineId: 'machine-1', runtimeAdapter: 'codex',
      status: 'active', sessionMode: 'standard', systemPrompt: '', modelId: null, workDir: '/tmp/owner-agent',
      permissionPolicy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
    } }), { status: 200 })))
    const worker = new PublicAgentDeliveryWorker({
      serverUrl: 'https://shennian.net', machineId: 'machine-1',
      getMachineToken: () => 'paired-machine-token',
      getDetectedAgents: async () => [{ type: 'codex', version: '1.0.0',
        executableFingerprint: `sha256:${'b'.repeat(64)}` }] as never,
      onRuntimeChanged: async () => { await committed; worker.start() },
    })
    worker.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.claim).toHaveBeenCalledTimes(1)
    acknowledge()
    await vi.advanceTimersByTimeAsync(5_001)
    expect(mocks.claim.mock.calls.length).toBeGreaterThan(1)
    expect(mocks.run).not.toHaveBeenCalled()
    worker.stop()
  })
})
