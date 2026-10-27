// @covers src/manager/registry.ts
// @covers src/manager/worker-ipc.ts
// @covers src/manager/worker-markdown.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Manager registry and presentation', () => {
  let tempDir = ''
  let previousHome: string | undefined

  beforeEach(() => {
    previousHome = process.env.SHENNIAN_HOME
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-manager-registry-'))
    process.env.SHENNIAN_HOME = tempDir
    vi.resetModules()
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.SHENNIAN_HOME
    else process.env.SHENNIAN_HOME = previousHome
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns the latest visible Worker messages in chronological order', async () => {
    const { compactWorkerTranscript } = await import('../manager/worker-ipc.js')
    const message = (ts: number, payload: string) => ({
      id: `message-${ts}`,
      sessionId: 'worker-1',
      role: 'assistant' as const,
      payload,
      ts,
    })

    const result = compactWorkerTranscript(
      [
        message(4, 'fourth'),
        message(3, 'third'),
        message(2, 'second'),
        message(1, 'first'),
      ] as never,
      2,
    )

    expect(result.map((item) => item.payload)).toEqual(['third', 'fourth'])
  })

  it('formats one canonical human-and-Agent-readable Worker Markdown message', async () => {
    const { deriveWorkerTitle, formatWorkerMarkdown, workerSessionUrl } =
      await import('../manager/worker-markdown.js')
    const body = '检查今天上午全部提交。\n\n- 保留完整正文\n- 不放内部 Run ID'
    expect(deriveWorkerTitle(`# 上午简报\n${body}`)).toBe('上午简报')
    expect(workerSessionUrl('sess_worker_1')).toBe('shennian://session/sess_worker_1')
    expect(
      formatWorkerMarkdown({
        kind: 'created',
        sessionId: 'sess_worker_1',
        title: '上午[简报]',
        body,
      }),
    ).toBe('[创建 Agent · 上午\\[简报\\]](shennian://session/sess_worker_1)\n\n' + body)
  })

  it('deduplicates worker terminal events and keeps the latest health summary', async () => {
    const { ManagerRegistry } = await import('../manager/registry.js')
    const registry = new ManagerRegistry()
    registry.upsertManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
    })
    registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })

    registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      kind: 'worker.final',
      priority: 'normal',
      runId: 'run-1',
      summary: 'first terminal payload',
    })
    registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      kind: 'worker.final',
      priority: 'normal',
      runId: 'run-1',
      summary: 'latest terminal payload',
    })
    registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      kind: 'worker.health',
      priority: 'normal',
      runId: 'run-1',
      summary: 'health 1',
    })
    registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      kind: 'worker.health',
      priority: 'normal',
      runId: 'run-1',
      summary: 'health 2',
    })

    const events = registry.listInboxEvents('manager-1')
    expect(events).toHaveLength(2)
    expect(events.find((event) => event.kind === 'worker.final')?.summary).toBe(
      'latest terminal payload',
    )
    expect(events.find((event) => event.kind === 'worker.health')?.summary).toBe('health 2')
  })

  it('binds external Worker references to machine, account, Worker, directory, action, and expiry', async () => {
    const { ManagerRegistry } = await import('../manager/registry.js')
    const registry = new ManagerRegistry()
    registry.upsertManager({
      sessionId: 'ephemeral-1',
      workDir: '/project',
      modelId: 'manager',
      controllerKind: 'ephemeral',
    })
    registry.addWorker({
      managerSessionId: 'ephemeral-1',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })
    const issued = registry.issueWorkerRef({
      managerSessionId: 'ephemeral-1',
      workerSessionId: 'worker-1',
      workDir: '/project',
      machineId: 'machine-1',
      accountNamespaceId: 'account-1',
      actions: ['read'],
    })
    expect(
      registry.resolveWorkerRef({
        workerRef: issued.workerRef,
        action: 'read',
        machineId: 'machine-1',
        accountNamespaceId: 'account-1',
      }),
    ).toMatchObject({ workerSessionId: 'worker-1' })
    expect(
      registry.resolveWorkerRef({
        workerRef: issued.workerRef,
        action: 'send',
        machineId: 'machine-1',
        accountNamespaceId: 'account-1',
      }),
    ).toBeUndefined()
    expect(
      registry.resolveWorkerRef({
        workerRef: issued.workerRef,
        action: 'read',
        machineId: 'machine-2',
        accountNamespaceId: 'account-1',
      }),
    ).toBeUndefined()
    expect(
      registry.resolveWorkerRef({
        workerRef: issued.workerRef,
        action: 'read',
        machineId: 'machine-1',
        accountNamespaceId: 'account-2',
      }),
    ).toBeUndefined()

    const expired = registry.issueWorkerRef({
      managerSessionId: 'ephemeral-1',
      workerSessionId: 'worker-1',
      workDir: '/project',
      machineId: 'machine-1',
      accountNamespaceId: 'account-1',
      ttlMs: -1,
    })
    expect(
      registry.resolveWorkerRef({
        workerRef: expired.workerRef,
        action: 'read',
        machineId: 'machine-1',
        accountNamespaceId: 'account-1',
      }),
    ).toBeUndefined()
    expect(
      registry.resolveWorkerRefDetailed({
        workerRef: expired.workerRef,
        action: 'read',
        machineId: 'machine-1',
        accountNamespaceId: 'account-1',
      }),
    ).toEqual({ ok: false, reason: 'expired' })

    const reloaded = new ManagerRegistry()
    expect(
      reloaded.resolveWorkerRef({
        workerRef: issued.workerRef,
        action: 'read',
        machineId: 'machine-1',
        accountNamespaceId: 'account-1',
      }),
    ).toMatchObject({ workerSessionId: 'worker-1' })
    reloaded.revokeWorkerRefsForWorker('worker-1')
    expect(
      reloaded.resolveWorkerRefDetailed({
        workerRef: issued.workerRef,
        action: 'read',
        machineId: 'machine-1',
        accountNamespaceId: 'account-1',
      }),
    ).toEqual({ ok: false, reason: 'revoked' })
    expect(
      registry.resolveWorkerRef({
        workerRef: issued.workerRef,
        action: 'read',
        machineId: 'machine-1',
        accountNamespaceId: 'account-1',
      }),
    ).toBeUndefined()
  })
})
