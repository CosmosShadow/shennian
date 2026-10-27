// @covers src/session/queue-dispatch-failure.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-dispatch-feedback-'))
  vi.stubEnv('SHENNIAN_HOME', home)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(home, { recursive: true, force: true })
})

async function harness(workDir: string) {
  const { readQueue, writeQueue } = await import('../session/queue-storage.js')
  const { readMessages } = await import('../session/store.js')
  const failure = await import('../session/queue-dispatch-failure.js')
  const message = {
    protocolVersion: 2, dataEpoch: 1, daemonInstallationId: 'daemon', id: 'user-1', sessionId: 'session-1',
    text: 'hello', agentType: 'codex', sessionMode: 'standard', workDir, agentSessionId: null, modelId: null,
    systemPrompt: null, managerDefaultWorkerAgentType: null, managerDefaultWorkerModelId: null,
    reasoningEffort: null, clientMessageId: 'user-1', externalChannel: null, replyTarget: null,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), trigger: { kind: 'personal' as const },
  }
  const queue = readQueue()
  queue.sessions['session-1'] = [message] as never
  writeQueue(queue)
  const fail = (error: unknown) => failure.handleQueueDispatchFailure({
    error, sessionId: 'session-1', batch: readQueue().sessions['session-1']!, isManagedWorker: false,
    publish: () => {}, removeBatch: () => { const q = readQueue(); delete q.sessions['session-1']; writeQueue(q); return 0 },
    log: () => {},
  })
  const notices = () => readMessages('session-1').filter((m) => /^queue-(recovery|failed)-/.test(m.id))
  return { ...failure, readQueue, fail, notices }
}

describe('dispatch failures always tell the Owner why', () => {
  it('names a missing work directory even when the adapter blamed the Codex CLI', async () => {
    const missing = path.join(home, 'deleted-project')
    const { fail, notices, readQueue } = await harness(missing)
    const outcome = fail(new Error('codex_command_unavailable: 请确认 Codex CLI 路径并刷新 AI 列表。'))
    expect(outcome).toEqual({ drainAgain: false, transientFailure: false })
    const [pending] = readQueue().sessions['session-1']!
    expect(pending?.dispatchBlock).toMatchObject({ code: 'agent_workdir_not_found', notice: true })
    expect(pending!.dispatchBlock!.retryAt).toBeGreaterThan(Date.now())
    expect(notices()).toHaveLength(1)
    expect(notices()[0]!.payload).toContain(missing)
    expect(notices()[0]!.payload).not.toContain('Codex CLI')
  })

  it('also names a work directory that is a file', async () => {
    const file = path.join(home, 'a-file')
    fs.writeFileSync(file, '')
    const { fail, readQueue } = await harness(file)
    fail(new Error('spawn ENOTDIR'))
    expect(readQueue().sessions['session-1']![0]!.dispatchBlock?.code).toBe('agent_workdir_not_directory')
  })

  it('does not blame the directory when it exists', async () => {
    const { fail, readQueue } = await harness(home)
    expect(fail(new Error('boom'))).toEqual({ drainAgain: false, transientFailure: true })
    expect(readQueue().sessions['session-1']![0]!.dispatchBlock?.code).toBe('transient_dispatch_failed')
  })

  it('announces an unclassified failure once, after it stops looking momentary', async () => {
    const { fail, notices, readQueue } = await harness(home)
    for (let attempt = 1; attempt <= 3; attempt += 1) fail(new Error('Agent send failed: app-server exited (code 1)'))
    expect(notices()).toHaveLength(0)
    fail(new Error('Agent send failed: app-server exited (code 1)'))
    fail(new Error('Agent send failed: app-server exited (code 1)'))
    expect(notices()).toHaveLength(1)
    expect(notices()[0]!.payload).toContain('app-server exited (code 1)')
    expect(notices()[0]!.payload).not.toContain('Agent send failed')
    const [pending] = readQueue().sessions['session-1']!
    expect(pending?.dispatchBlock).toMatchObject({ retryAt: 0, attempts: 5, notice: true })
  })

  it('never delays an unclassified retry beyond the normal backoff', async () => {
    const { fail, queueBlockedUntil, readQueue } = await harness(home)
    for (let attempt = 0; attempt < 6; attempt += 1) fail(new Error('boom'))
    expect(queueBlockedUntil(readQueue().sessions['session-1']! as never)).toBeUndefined()
  })

  it('updates the same notice to "recovered" once the message is finally delivered', async () => {
    const { fail, notices, readQueue, resolveQueueRecoveryNotice } = await harness(home)
    for (let attempt = 0; attempt < 4; attempt += 1) fail(new Error('boom'))
    resolveQueueRecoveryNotice(readQueue().sessions['session-1']! as never)
    expect(notices()).toHaveLength(1)
    expect(notices()[0]!.payload).toContain('已恢复')
  })

  it('does not announce recovery for a message that never got a notice', async () => {
    const { fail, notices, readQueue, resolveQueueRecoveryNotice } = await harness(home)
    fail(new Error('boom'))
    resolveQueueRecoveryNotice(readQueue().sessions['session-1']! as never)
    expect(notices()).toHaveLength(0)
  })

  it('explains a message that is dropped after a terminal failure', async () => {
    const { handleQueueDispatchFailure, notices, readQueue } = await harness(home)
    const { TerminalQueuedChatDispatchError } = await import('../session/queue-message.js')
    const outcome = handleQueueDispatchFailure({
      error: new TerminalQueuedChatDispatchError('schedule_target_unavailable'), sessionId: 'session-1',
      batch: readQueue().sessions['session-1']! as never, isManagedWorker: false, publish: () => {},
      removeBatch: () => 0, log: () => {},
    })
    expect(outcome.transientFailure).toBe(false)
    expect(notices()[0]).toMatchObject({ id: 'queue-failed-user-1' })
    expect(notices()[0]!.payload).toContain('schedule_target_unavailable')
  })

  it('stays silent when the user deleted the conversation on purpose', async () => {
    const { handleQueueDispatchFailure, notices, readQueue } = await harness(home)
    const { TerminalQueuedChatDispatchError } = await import('../session/queue-message.js')
    handleQueueDispatchFailure({
      error: new TerminalQueuedChatDispatchError('queued_dispatch_cancelled'), sessionId: 'session-1',
      batch: readQueue().sessions['session-1']! as never, isManagedWorker: false, publish: () => {},
      removeBatch: () => 0, log: () => {},
    })
    expect(notices()).toHaveLength(0)
  })
})
