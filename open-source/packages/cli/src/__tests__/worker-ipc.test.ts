// @covers src/manager/runtime.ts
// @covers src/manager/worker-ipc.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('External Worker IPC', () => {
  let tempDir = ''
  let previousHome: string | undefined

  beforeEach(() => {
    previousHome = process.env.SHENNIAN_HOME
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-worker-ipc-'))
    process.env.SHENNIAN_HOME = tempDir
    vi.resetModules()
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.SHENNIAN_HOME
    else process.env.SHENNIAN_HOME = previousHome
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses an opaque Worker ref without exposing an external Manager identity or list', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify({
        machineId: 'machine-1',
        accountNamespaceId: 'account-1',
        machineToken: 'local-test-token',
      }),
    )
    vi.doMock('../agents/detect.js', () => ({
      detectAgents: vi.fn(async () => [
        { type: 'codex', command: 'codex', args: [], authState: 'ready' },
      ]),
    }))
    vi.doMock('../agents/model-registry/service.js', () => ({
      getCachedAgentInfos: vi.fn(() => [
        {
          type: 'codex',
          models: [],
          authState: 'ready',
          supportsExternalWorkerTarget: true,
        },
      ]),
    }))
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const channelRuntime = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      listManagerChannelStatuses: vi.fn(() => []),
    }
    const dispatched: Array<{ method: string; params?: Record<string, unknown> }> = []
    const activeSessions = new Map<string, { currentRunId: string | null }>()
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions: activeSessions, client: {} }) as any,
      getAgentSnapshot: () => [
        {
          type: 'codex',
          models: [],
          authState: 'ready',
          supportsExternalWorkerTarget: true,
        },
      ],
      dispatchReq: async (req) => {
        dispatched.push({ method: req.method, params: req.params as Record<string, unknown> })
        return req.method === 'chat.enqueue' ? { durableQueueHandoff: true } : undefined
      },
      channelRuntime: channelRuntime as any,
    })
    await service.start()
    try {
      const runtimeFile = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'runtime', 'manager-ipc.json'), 'utf8'),
      ) as { url: string; token: string }
      const post = async (route: string, requestBody: Record<string, unknown> = {}) => {
        const response = await fetch(`${runtimeFile.url}${route}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${runtimeFile.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        })
        return { response, body: (await response.json()) as Record<string, unknown> }
      }

      const invalidDirectory = await post('/workers/start', {
        agentType: 'codex',
        workDir: path.join(tempDir, 'missing-project'),
        message: 'must fail before creating a Worker',
      })
      expect(invalidDirectory.response.status).toBe(400)
      expect(invalidDirectory.body).toMatchObject({
        ok: false,
        error: 'worker_workdir_invalid',
        nextAction: expect.any(String),
      })

      const started = await post('/workers/start', {
        agentType: 'codex',
        workDir: tempDir,
        title: '核对发布风险',
        message: '读取完整计划并核对所有发布风险。',
      })
      expect(started.response.status).toBe(200)
      expect(started.body).toMatchObject({
        ok: true,
        workerId: expect.stringMatching(/^sess_worker_/),
        workerRef: expect.stringMatching(/^wr_/),
        resolvedWorkDir: fs.realpathSync.native(tempDir),
        agentType: 'codex',
      })
      expect(started.body).not.toHaveProperty('managerSessionId')
      const workerId = String(started.body.workerId)
      const workerRef = String(started.body.workerRef)
      expect(fs.readFileSync(path.join(tempDir, 'manager-registry.json'), 'utf8')).not.toContain(
        workerRef,
      )

      const registry = service.registry.load()
      const controller = Object.values(registry.managers).find(
        (manager) => manager.controllerKind === 'ephemeral',
      )
      expect(controller).toMatchObject({
        machineId: 'machine-1',
        workDir: fs.realpathSync.native(tempDir),
      })
      expect(dispatched.at(-1)).toMatchObject({
        method: 'chat.enqueue',
        params: {
          managedWorkerParentSessionId: controller?.sessionId,
          protocolVersion: expect.any(Number),
          dataEpoch: expect.any(Number),
          daemonInstallationId: expect.any(String),
        },
      })

      const retiredNativeContext = await post('/skill/context', {
        host: 'codex',
        hostSessionId: 'native-thread-1',
        workDir: tempDir,
      })
      expect(retiredNativeContext.response.status).toBe(404)

      const noList = await post('/workers/list')
      expect(noList.response.status).toBe(404)
      expect(noList.body).toMatchObject({ ok: false, error: 'worker_command_unavailable' })

      const tampered = await post('/workers/send', {
        workerRef: `${workerRef.slice(0, -1)}x`,
        message: 'must fail',
      })
      expect(tampered.response.status).toBe(403)
      expect(tampered.body).toMatchObject({ ok: false, error: 'worker_ref_invalid' })

      const sent = await post('/workers/send', {
        workerRef,
        message: '继续核对回滚步骤。',
      })
      expect(sent.body).toMatchObject({ ok: true, workerId, queued: true })

      activeSessions.set(workerId, { currentRunId: 'active-run' })
      const queuedWhileBusy = await post('/workers/send', {
        workerRef,
        message: '排队等待当前执行结束。',
      })
      expect(queuedWhileBusy.body).toMatchObject({
        ok: true,
        workerId,
        queued: true,
        code: 'worker_busy',
      })
      activeSessions.delete(workerId)

      const read = await post('/workers/read', { workerRef, limit: 20 })
      expect(read.body).toMatchObject({ ok: true, workerId })
      const { executeWorkerCommand, registerWorkerCommand } = await import('../commands/worker.js')
      await expect(executeWorkerCommand('read', { workerRef, limit: 20 })).resolves.toMatchObject({
        ok: true,
        workerId,
      })
      const { Command } = await import('commander')
      const program = new Command()
      registerWorkerCommand(program)
      const workerCommand = program.commands.find((command) => command.name() === 'worker')
      expect(workerCommand?.commands.map((command) => command.name())).toEqual([
        'start',
        'list',
        'report',
        'read',
        'send',
        'wait',
        'stop',
      ])

      const timedOut = await post('/workers/wait', { workerRef, timeoutMs: 1_000 })
      expect(timedOut.body).toMatchObject({
        ok: true,
        timedOut: true,
        code: 'wait_timed_out',
        workerId,
        nextAction: expect.any(String),
      })
      const afterTimeout = await post('/workers/read', { workerRef, limit: 20 })
      expect(afterTimeout.body).toMatchObject({ ok: true, workerId })

      service.noteAgentEvent(workerId, {
        state: 'heartbeat',
        runId: 'run-auth-retry',
        seq: 0,
        runPhase: 'thinking',
        errorCode: 'auth_retrying',
        message: 'Claude authentication is retrying.',
      })
      const retrying = await post('/workers/wait', { workerRef, timeoutMs: 1_000 })
      expect(retrying.body).toMatchObject({
        ok: true,
        timedOut: false,
        event: { kind: 'worker.health', code: 'auth_retrying' },
      })

      const completeBody = `发布风险核对完成。${'完整正文不能被摘要替代。'.repeat(40)}`
      service.noteAgentEvent(workerId, {
        state: 'delta',
        runId: 'run-complete',
        seq: 1,
        text: completeBody,
      })
      service.noteAgentEvent(workerId, {
        state: 'final',
        runId: 'run-complete',
        seq: 2,
        message: 'generic final marker',
      })
      const waited = await post('/workers/wait', { workerRef, timeoutMs: 1_000 })
      expect(waited.body).toMatchObject({ ok: true, timedOut: false, workerId })
      expect(waited.body.markdown).toBe(
        `[Agent 完成 · 核对发布风险](shennian://session/${workerId})\n\n${completeBody}`,
      )
      expect(
        service.registry.getWorkerForManager(controller!.sessionId, workerId)?.summary,
      ).toMatch(/\.\.\.$/)

      const stopped = await post('/workers/stop', { workerRef })
      expect(stopped.body).toMatchObject({ ok: true, workerId, code: 'worker_terminal' })

      const managerWithoutContext = await post('/sessions/list')
      expect(managerWithoutContext.response.status).toBe(400)
    } finally {
      await service.stop()
      vi.doUnmock('../agents/detect.js')
      vi.doUnmock('../agents/model-registry/service.js')
    }
  })
})
