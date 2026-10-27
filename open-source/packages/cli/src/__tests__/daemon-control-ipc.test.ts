// @covers src/daemon-ipc/control.ts

import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentReadinessHandlers } from '../daemon-ipc/agent-readiness.js'
import { executeAgentReadinessCommand } from '../commands/agent-readiness.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import { createDaemonControlHandlers, readDaemonLogPage } from '../daemon-ipc/control.js'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { resolveDaemonIpcPaths } from '../daemon-ipc/paths.js'
import { assertUnixSocketEndpointLength, startDaemonIpcServer } from '../daemon-ipc/server.js'

const roots: string[] = []

// The reserved Vitest unit-fixture directory (see vitest.config.ts) already
// consumes part of the macOS 104-byte sockaddr_un budget; how much is left
// depends on the OS-assigned os.tmpdir() length for this session. Probe once
// so sessions where a real Unix socket cannot fit skip instead of failing.
const socketPathTooLongForThisEnvironment = (() => {
  if (process.platform === 'win32') return false
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-'))
  try {
    assertUnixSocketEndpointLength(resolveDaemonIpcPaths(probeRoot).endpoint, process.platform)
    return false
  } catch {
    return true
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true })
  }
})()

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('daemon control IPC handlers', () => {
  it.skipIf(process.platform === 'win32' || socketPathTooLongForThisEnvironment)('serves protocol.info on the regular daemon endpoint', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-'))
    roots.push(root)
    const paths = resolveDaemonIpcPaths(root)
    const status = {
      running: true, pid: 42, stale: false, remoteAccessDisabled: false,
      launcher: 'desktop-managed' as const, platform: 'darwin' as const,
      shennianDir: root, pidFile: path.join(root, 'daemon.pid'), logFile: path.join(root, 'daemon.log'),
    }
    const server = await startDaemonIpcServer({
      paths,
      handlers: createDaemonControlHandlers({
        daemonVersion: '0.4.13', protocolVersion: 1, getStatus: () => status, getAgents: () => [],
      }),
    })
    try {
      await expect(callDaemonIpc({ method: 'protocol.info', paths })).resolves.toMatchObject({
        daemonVersion: '0.4.13',
        launcher: 'desktop-managed',
      })
    } finally {
      await server.close()
    }
  })

  it('advertises explicit capabilities and launcher ownership', async () => {
    const handlers = createDaemonControlHandlers({
      daemonVersion: '0.4.13',
      protocolVersion: 1,
      getStatus: () => ({
        running: true,
        pid: 42,
        stale: false,
        remoteAccessDisabled: false,
        launcher: 'desktop-managed',
        platform: 'darwin',
        shennianDir: '/tmp/shennian',
        pidFile: '/tmp/shennian/daemon.pid',
        logFile: '/tmp/shennian/daemon.log',
      }),
      getAgents: () => [],
    })

    expect(await handlers['protocol.info']!(undefined, { requestId: 'r1' })).toEqual({
      daemonVersion: '0.4.13',
      protocolVersion: 1,
      launcher: 'desktop-managed',
      capabilities: [
        'protocol.info', 'daemon.status', 'daemon.shutdown', 'agent.list', 'agent.discover', 'agent.check', 'room.agent.bind-managed', 'steward.say',
        'agent.auth.completed', 'log.read',
        'upgrade.start', 'upgrade.prepare-external', 'upgrade.cancel-external',
      ],
    })
  })

  it.skipIf(process.platform === 'win32' || socketPathTooLongForThisEnvironment)('shuts down only after an authenticated, PID-matched response', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssi-'))
    roots.push(root)
    const paths = resolveDaemonIpcPaths(root)
    const requestShutdown = vi.fn()
    const server = await startDaemonIpcServer({
      paths,
      handlers: createDaemonControlHandlers({
        daemonVersion: '0.5.12', protocolVersion: 1,
        getStatus: () => ({
          running: true, pid: process.pid, stale: false, remoteAccessDisabled: false,
          launcher: 'global-cli', platform: 'darwin', shennianDir: root,
          pidFile: path.join(root, 'daemon.pid'), logFile: path.join(root, 'daemon.log'),
        }),
        getAgents: () => [], requestShutdown,
      }),
    })
    try {
      await expect(callDaemonIpc({ method: 'daemon.shutdown', params: { expectedPid: process.pid + 1 }, paths }))
        .rejects.toMatchObject({ code: 'method_failed' })
      expect(requestShutdown).not.toHaveBeenCalled()
      const unauthorized = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const socket = net.createConnection(paths.endpoint)
        let received = ''
        socket.setEncoding('utf8')
        socket.once('connect', () => socket.write(`${JSON.stringify({
          version: 1, requestId: 'unauthorized-stop', auth: 'wrong', method: 'daemon.shutdown',
          params: { expectedPid: process.pid },
        })}\n`))
        socket.on('data', (chunk: string) => {
          received += chunk
          const newline = received.indexOf('\n')
          if (newline < 0) return
          socket.destroy()
          resolve(JSON.parse(received.slice(0, newline)) as Record<string, unknown>)
        })
        socket.once('error', reject)
      })
      expect(unauthorized).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
      expect(requestShutdown).not.toHaveBeenCalled()
      await expect(callDaemonIpc({ method: 'daemon.shutdown', params: { expectedPid: process.pid }, paths }))
        .resolves.toEqual({ accepted: true, pid: process.pid })
      await new Promise((resolve) => setImmediate(resolve))
      expect(requestShutdown).toHaveBeenCalledOnce()
    } finally { await server.close() }
  })

  it('binds a managed Room through the local control endpoint', async () => {
    const bindManagedRoom = vi.fn().mockResolvedValue({ bindingId: 'binding-1', status: 'active' })
    const handlers = createDaemonControlHandlers({
      daemonVersion: '0.5.4', protocolVersion: 1,
      getStatus: () => ({
        running: true, pid: 42, stale: false, remoteAccessDisabled: false,
        launcher: 'global-cli', platform: 'darwin', shennianDir: '/tmp/shennian',
        pidFile: '/tmp/shennian/daemon.pid', logFile: '/tmp/shennian/daemon.log',
      }),
      getAgents: () => [],
      bindManagedRoom,
    })

    const params = {
      roomId: 'room-1', agentIdentityId: 'agent-1', nianSessionId: 'session-1',
      assignmentIntentId: 'intent-1', agentType: 'codex', activationMode: 'auto_follow',
    }
    await expect(handlers['room.agent.bind-managed']!(params, { requestId: 'bind' }))
      .resolves.toEqual({ bindingId: 'binding-1', status: 'active' })
    expect(bindManagedRoom).toHaveBeenCalledWith(params)
  })

  it('notifies the daemon after terminal ACP authentication', async () => {
    const handlers = createDaemonControlHandlers({
      daemonVersion: '0.4.13',
      protocolVersion: 1,
      getStatus: () => ({
        running: true, pid: 42, stale: false, remoteAccessDisabled: false,
        launcher: 'global-cli', platform: 'darwin', shennianDir: '/tmp/shennian',
        pidFile: '/tmp/shennian/daemon.pid', logFile: '/tmp/shennian/daemon.log',
      }),
      getAgents: () => [],
      completeAgentAuthentication: async (agentType) => agentType === 'acp:kimi',
    })

    await expect(handlers['agent.auth.completed']!({ agentType: 'acp:kimi' }, { requestId: 'r-auth' }))
      .resolves.toEqual({ resumed: true })
    await expect(handlers['agent.auth.completed']!({ agentType: 'codex' }, { requestId: 'r-bad' }))
      .rejects.toThrow('invalid_acp_agent')
  })

  it('supports an explicit external upgrade barrier for the independent Client updater', async () => {
    const prepared: string[] = []
    const handlers = createDaemonControlHandlers({
      daemonVersion: '0.4.13', protocolVersion: 1,
      getStatus: () => ({
        running: true, pid: 42, stale: false, remoteAccessDisabled: false,
        launcher: 'global-cli', platform: 'darwin', shennianDir: '/tmp/shennian',
        pidFile: '/tmp/shennian/daemon.pid', logFile: '/tmp/shennian/daemon.log',
      }),
      getAgents: () => [],
      prepareExternalUpgrade: (params) => {
        prepared.push(String((params as { targetVersion?: string }).targetVersion))
        return { activeRunCount: 2 }
      },
      cancelExternalUpgrade: () => ({ cancelled: true }),
    })
    await expect(handlers['upgrade.prepare-external']!({ targetVersion: '0.4.14' }, { requestId: 'p' }))
      .resolves.toEqual({ activeRunCount: 2 })
    expect(prepared).toEqual(['0.4.14'])
    await expect(handlers['upgrade.cancel-external']!(undefined, { requestId: 'c' }))
      .resolves.toEqual({ cancelled: true })
  })

  it('returns only the agent metadata needed by a desktop client', async () => {
    const handlers = createDaemonControlHandlers({
      daemonVersion: '0.4.13',
      protocolVersion: 1,
      getStatus: () => ({
        running: true, pid: 42, stale: false, remoteAccessDisabled: false,
        launcher: 'global-cli', platform: 'darwin', shennianDir: '/tmp/shennian',
        pidFile: '/tmp/shennian/daemon.pid', logFile: '/tmp/shennian/daemon.log',
      }),
      getAgents: () => [{
        type: 'codex', command: '/secret/path/codex', args: ['--unsafe'], version: '1.2.3',
        runtimePlatform: 'darwin', runtimeIsWsl: false,
      }],
    })

    const result = await handlers['agent.list']!(undefined, { requestId: 'r2' })
    expect(result).toEqual({
      agents: [{
        type: 'codex', version: '1.2.3', runtimePlatform: 'darwin', runtimeIsWsl: false,
      }],
      acpMetrics: expect.objectContaining({ scans: expect.any(Number), handshakeFailuresByKind: expect.any(Object) }),
    })
    expect(JSON.stringify(result)).not.toContain('/secret/path')
    expect(JSON.stringify(result)).not.toContain('--unsafe')
  })

  it('reads a daemon log backwards in bounded byte pages', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-log-page-'))
    roots.push(root)
    const file = path.join(root, 'daemon.log')
    fs.writeFileSync(file, 'abcdefghij')

    expect(readDaemonLogPage(file, { limitBytes: 4 })).toEqual({
      text: 'ghij', start: 6, end: 10, nextBefore: 6, eof: false,
    })
    expect(readDaemonLogPage(file, { before: 6, limitBytes: 4 })).toEqual({
      text: 'cdef', start: 2, end: 6, nextBefore: 2, eof: false,
    })
    expect(readDaemonLogPage(file, { before: 2, limitBytes: 99_999_999 })).toEqual({
      text: 'ab', start: 0, end: 2, nextBefore: null, eof: true,
    })
  })
})

// @covers src/daemon-ipc/agent-readiness.ts
// @covers src/commands/agent-readiness.ts
describe('local AI readiness commands', () => {
  const getStatus = () => ({ running: true, pid: 42, stale: false, remoteAccessDisabled: false,
    launcher: 'global-cli' as const, platform: 'darwin' as const, shennianDir: '/tmp/example',
    pidFile: '/tmp/example/daemon.pid', logFile: '/tmp/example/daemon.log' })
  const request = { requestId: 'readiness-test' }
  it('reads the daemon snapshot without refreshing providers, testing models or exposing provider details', async () => {
    const snapshot = [{ type: 'codex' as const, models: [{ id: 'model-a', name: 'A' }],
      authState: 'ready' as const, runtime: { cliVersion: '1.2.3' },
      supportsStandardSession: true, supportsManagedAgent: true, supportsManagedNativeFull: true,
      supportsRoomTools: true, supportsWorker: true, supportsManagerMode: true,
      supportsExternalWorkerTarget: true,
      config: { status: 'detected' as const, tokenHint: 'not-for-output' } }]
    const discover = vi.fn(async () => snapshot)
    const validate = vi.fn(async () => ({ ok: true as const }))
    const handlers = createAgentReadinessHandlers({ getStatus, getSnapshot: () => snapshot, discover, validate })
    const result = await handlers['agent.discover']!(undefined, request)
    expect(result).toEqual({ modelTested: false, compact: false, refreshed: false, unavailable: [], agents: [{ type: 'codex', name: 'codex', authState: 'ready',
      version: '1.2.3', supportsStandardSession: true, supportsManagedAgent: true,
      supportsManagedNativeFull: true, supportsRoomTools: true, supportsWorker: true,
      supportsManagerMode: true, supportsExternalWorkerTarget: true,
      modelCount: 1, defaultModelId: null,
      models: [{ id: 'model-a', name: 'A', isDefault: false }], modelsTruncated: false }] })
    expect(discover).not.toHaveBeenCalled()
    expect(validate).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('not-for-output')
  })
  it('places the default model first and returns every discovered model', async () => {
    const models = Array.from({ length: 12 }, (_, index) => ({
      id: `model-${index + 1}`,
      name: `Model ${index + 1}`,
      isDefault: index === 11,
    }))
    const snapshot = [{ type: 'codex' as const, models }]
    const handlers = createAgentReadinessHandlers({
      getStatus,
      getSnapshot: () => snapshot,
      discover: vi.fn(async () => snapshot),
      validate: vi.fn(),
    })

    const result = await handlers['agent.discover']!(undefined, request) as {
      agents: Array<{ modelCount: number; defaultModelId: string | null; modelsTruncated: boolean; models: Array<{ id: string }> }>
    }

    expect(result.agents[0]).toMatchObject({
      modelCount: 12,
      defaultModelId: 'model-12',
      modelsTruncated: false,
    })
    expect(result.agents[0]?.models).toHaveLength(12)
    expect(result.agents[0]?.models[0]?.id).toBe('model-12')
  })
  it('refreshes only the requested Agent and returns a compact capability summary without model lists', async () => {
    const snapshot = [
      { type: 'codex' as const, models: [{ id: 'model-a', name: 'A', isDefault: true }], supportsWorker: true },
      { type: 'claude' as const, models: [{ id: 'model-b', name: 'B' }], supportsWorker: true },
    ]
    const discover = vi.fn(async () => snapshot.filter((agent) => agent.type === 'claude'))
    const unavailable = [
      { type: 'acp:dsh', name: 'DSH', command: 'dsh', args: ['--profile', 'acp'], reason: 'timeout' },
    ]
    const handlers = createAgentReadinessHandlers({
      getStatus, getSnapshot: () => snapshot, discover, validate: vi.fn(), getUnavailable: () => unavailable,
    })
    expect(await handlers['agent.discover']!({ compact: true }, request)).toMatchObject({ unavailable })
    const result = await handlers['agent.discover']!({ agentType: 'claude', compact: true, refresh: true }, request)
    expect(result).toEqual({
      modelTested: false,
      compact: true,
      refreshed: true,
      unavailable: [],
      agents: [expect.objectContaining({
        type: 'claude', modelCount: 1, defaultModelId: null, supportsWorker: true,
      })],
    })
    expect(discover).toHaveBeenCalledExactlyOnceWith('claude')
    expect(JSON.stringify(result)).not.toContain('model-b')
  })
  it('runs exactly the selected configuration through the shared validator and reports success only afterwards', async () => {
    const validate = vi.fn(async () => ({ ok: true as const }))
    const handlers = createAgentReadinessHandlers({ getStatus, getSnapshot: () => [], discover: async () => [], validate })
    await expect(handlers['agent.check']!({ agentType: 'codex', workDir: '/project', modelId: 'model-a' }, request))
      .resolves.toEqual({ ready: true, agentType: 'codex', modelId: 'model-a', scope: 'hello_reply' })
    expect(validate).toHaveBeenCalledExactlyOnceWith({ runtimeAdapter: 'codex', workDir: '/project',
      modelId: 'model-a', sessionMode: 'standard' })
  })
  it('preserves the concrete validation failure and releases the in-flight guard', async () => {
    const validate = vi.fn().mockResolvedValueOnce({ ok: false, errorCode: 'agent_validation_runtime_auth_required' })
      .mockResolvedValueOnce({ ok: true })
    const handlers = createAgentReadinessHandlers({ getStatus, getSnapshot: () => [], discover: async () => [], validate })
    const params = { agentType: 'claude', workDir: '/project' }
    await expect(handlers['agent.check']!(params, request)).rejects.toMatchObject({ code: 'agent_validation_runtime_auth_required' })
    await expect(handlers['agent.check']!(params, request)).resolves.toMatchObject({ ready: true })
  })
  it('does not discover or start a model on a paused machine', async () => {
    const discover = vi.fn(async () => [])
    const validate = vi.fn(async () => ({ ok: true as const }))
    const handlers = createAgentReadinessHandlers({ getStatus: () => ({ ...getStatus(), remoteAccessDisabled: true }), getSnapshot: () => [], discover, validate })
    await expect(handlers['agent.discover']!(undefined, request)).rejects.toMatchObject({ code: 'daemon_paused' })
    await expect(handlers['agent.check']!({ agentType: 'codex', workDir: '/project' }, request)).rejects.toMatchObject({ code: 'daemon_paused' })
    expect(discover).not.toHaveBeenCalled()
    expect(validate).not.toHaveBeenCalled()
  })
  it('rejects duplicate model checks and malformed configurations without extra requests', async () => {
    let finish!: (value: { ok: true }) => void
    const validate = vi.fn(() => new Promise<{ ok: true }>((resolve) => { finish = resolve }))
    const handlers = createAgentReadinessHandlers({ getStatus, getSnapshot: () => [], discover: async () => [], validate })
    await expect(handlers['agent.check']!({ agentType: 'bogus', workDir: '/project' }, request))
      .rejects.toMatchObject({ code: 'agent_validation_invalid_configuration' })
    const params = { agentType: 'codex', workDir: '/project' }
    const first = handlers['agent.check']!(params, request)
    await expect(handlers['agent.check']!(params, request)).rejects.toMatchObject({ code: 'agent_check_in_progress' })
    finish({ ok: true })
    await first
    expect(validate).toHaveBeenCalledTimes(1)
  })
  it('gives an existing-installation upgrade action for old daemon methods, without retry or sensitive error output', async () => {
    const call = vi.fn().mockRejectedValue(new DaemonIpcError('method_not_found', 'sensitive provider output'))
    const result = await executeAgentReadinessCommand('agent.discover', undefined, call)
    expect(result).toMatchObject({ ok: false, error: 'method_not_found', nextAction: expect.stringContaining('Desktop') })
    expect(JSON.stringify(result)).not.toContain('sensitive provider output')
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('explains access-denied IPC without claiming the daemon is stopped or recommending a forced restart', async () => {
    const call = vi.fn().mockRejectedValue(new DaemonIpcError('ipc_access_denied', 'private Windows path'))
    const result = await executeAgentReadinessCommand('agent.discover', undefined, call)
    expect(result).toMatchObject({ ok: false, error: 'ipc_access_denied',
      nextAction: expect.stringContaining('Windows scheduled task') })
    expect(JSON.stringify(result)).toContain('do not force-stop')
    expect(JSON.stringify(result)).not.toContain('private Windows path')
  })
  it('names the failing stage and explains what discovery and check results do not prove', async () => {
    const failed = await executeAgentReadinessCommand('agent.check', undefined,
      vi.fn().mockRejectedValue(new DaemonIpcError('agent_validation_response_timeout', 'x')))
    expect(failed).toMatchObject({ ok: false, error: 'agent_validation_response_timeout', stage: 'reply',
      nextAction: expect.stringContaining('60 seconds') })

    const passed = await executeAgentReadinessCommand('agent.check', undefined,
      vi.fn().mockResolvedValue({ ready: true, scope: 'hello_reply' }))
    expect(passed).toMatchObject({ ok: true, result: { ready: true, note: expect.stringContaining('not prove') } })

    const discovered = await executeAgentReadinessCommand('agent.discover', undefined,
      vi.fn().mockResolvedValue({ agents: [] }))
    expect(discovered).toMatchObject({ ok: true, result: { notes: {
      authState: expect.stringContaining('not "not logged in"'),
      defaultModelId: expect.stringContaining('does not mean no model'),
    } } })
  })
  it('gives a stalled check the reply stage and a load-aware next action', async () => {
    const stalled = await executeAgentReadinessCommand('agent.check', undefined,
      vi.fn().mockRejectedValue(new DaemonIpcError('ipc_timeout', 'Shennian daemon did not respond.')))
    expect(stalled).toMatchObject({ ok: false, error: 'ipc_timeout', stage: 'reply',
      nextAction: expect.stringContaining('do not repeatedly send tests') })
    // Discovery has no reply stage, so a stalled discovery keeps the unstaged shape.
    const discovery = await executeAgentReadinessCommand('agent.discover', undefined,
      vi.fn().mockRejectedValue(new DaemonIpcError('ipc_timeout', 'x')))
    expect(discovery).not.toHaveProperty('stage')
  })
  it('links persistent official Adapter failures to the bounded local V1 workflow', async () => {
    const failed = await executeAgentReadinessCommand(
      'agent.check',
      { agentType: 'codex', workDir: '/project', modelId: 'model-a' },
      vi.fn().mockRejectedValue(new DaemonIpcError('agent_validation_start_failed', 'private runtime output')),
    )
    expect(failed).toMatchObject({
      ok: false,
      stage: 'start',
      error: 'agent_validation_start_failed',
      nextAction: expect.stringContaining('shennian adapter show codex'),
    })
    expect(JSON.stringify(failed)).toContain('Stop after three failed')
    expect(JSON.stringify(failed)).not.toContain('private runtime output')
  })
  it('does not treat an empty successful IPC envelope as a model reply', async () => {
    expect(await executeAgentReadinessCommand('agent.check', undefined, vi.fn().mockResolvedValue({})))
      .toMatchObject({ ok: false, error: 'agent_check_invalid_response' })
  })
})
