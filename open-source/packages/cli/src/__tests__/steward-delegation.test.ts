// @covers src/steward/worker-settings.ts
// @covers src/steward/context.ts
// @covers src/manager/worker-ipc.ts
// @covers src/manager/runtime.ts
// @covers src/manager/registry.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../session/index-publisher.js', () => ({ requestSessionIndexPublish: vi.fn() }))
let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-delegation-'))
  vi.stubEnv('SHENNIAN_HOME', root); vi.resetModules()
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ machineId: 'test-machine', machineToken: 'synthetic', accountNamespaceId: 'test-account' }))
})
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }) })
async function fixture() {
  const { ManagerRuntimeService } = await import('../manager/runtime.js')
  const { recordSession } = await import('../session/store.js')
  const { handleEphemeralWorkerIpcRoute } = await import('../manager/worker-ipc.js')
  const { saveWorkerSettings } = await import('../steward/worker-settings.js')
  recordSession({ sessionId: 'personal-1', agentType: 'shennian', workDir: root, sessionScope: 'steward' })
  const sessions = new Map<string, { currentRunId: string | null }>()
  const dispatch = vi.fn(async (_req: import('@shennian/wire').ReqFrame) => ({ durableQueueHandoff: true }))
  const service = new ManagerRuntimeService({ getRuntime: () => ({ sessions }) as never, dispatchReq: dispatch })
  const enqueue = vi.fn(async (..._args: unknown[]) => {})
  const host = { registry: service.registry, getRuntime: () => ({ sessions }) as never,
    getAgentSnapshot: () => ['codex', 'claude'].map(type => ({ type, models: [{ id: 'model-a', name: 'A' }], authState: 'ready', supportsExternalWorkerTarget: true })) as never,
    dispatchReq: dispatch, dispatchChatEnqueue: enqueue, appendManagerVisibleMarkdown: vi.fn(), reportWorkerProgress: service.reportWorkerProgress.bind(service) }
  saveWorkerSettings({ agentType: 'codex', modelId: 'model-a' })
  const start = (extra = {}) => handleEphemeralWorkerIpcRoute(host, '/workers/start', { stewardSessionId: 'personal-1', requestId: 'goal-0001', message: 'Verify a bounded task', workDir: root, ...extra })
  return { service, host, sessions, dispatch, enqueue, start, route: handleEphemeralWorkerIpcRoute }
}
describe('personal steward delegation', () => {
  it('persists strict non-secret defaults, without inventing or installing providers', async () => {
    const { saveWorkerSettings, readWorkerSettings } = await import('../steward/worker-settings.js')
    expect(readWorkerSettings()).toEqual({ agentType: 'shennian', modelId: null })
    expect(() => saveWorkerSettings({ agentType: 'manager', modelId: null })).toThrow('personal_worker_settings_invalid')
    expect(() => saveWorkerSettings({ agentType: null, modelId: 'x' })).toThrow()
    expect(() => saveWorkerSettings({ agentType: 'codex', modelId: null, apiKey: 'never' })).toThrow()
    saveWorkerSettings({ agentType: 'claude', modelId: null })
    expect(readWorkerSettings()).toEqual({ agentType: 'claude', modelId: null })
  })
  it('uses builtin Shennian and the configured start directory, but task directory wins', async () => {
    const f = await fixture()
    const { saveWorkerSettings } = await import('../steward/worker-settings.js')
    const fallback = path.join(root, 'fallback'), project = path.join(root, 'project')
    fs.mkdirSync(fallback); fs.mkdirSync(project)
    saveWorkerSettings({ agentType: null, modelId: null, workDir: fallback })
    f.host.getAgentSnapshot = () => [{ type: 'shennian', models: [], authState: 'ready', supportsExternalWorkerTarget: true }] as never
    const first = await f.start({ workDir: undefined })
    expect(first?.body).toMatchObject({ agentType: 'shennian', resolvedWorkDir: fs.realpathSync(fallback) })
    const second = await f.start({ requestId: 'goal-project', workDir: project })
    expect(second?.body.resolvedWorkDir).toBe(fs.realpathSync(project))
    saveWorkerSettings({ agentType: 'shennian', modelId: null })
    const { getStewardDir } = await import('../steward/workspace.js')
    const { savePersonalPaths } = await import('../steward/settings.js')
    savePersonalPaths({ workspace: fallback })
    const third = await f.start({ requestId: 'goal-default-dir', workDir: undefined })
    expect(third?.body.resolvedWorkDir).toBe(fs.realpathSync(getStewardDir()))
    expect(() => saveWorkerSettings({ agentType: 'shennian', modelId: null, workDir: 'relative' })).toThrow()
    await expect(f.start({ requestId: 'goal-model', modelId: 'unsupported' })).rejects.toMatchObject({ code: 'model_unavailable' })
  })
  it('uses defaults, lets a single request override them, and deduplicates concurrent retries', async () => {
    const f = await fixture()
    const [first, retry] = await Promise.all([f.start(), f.start()])
    expect(first?.body.workerId).toBe(retry?.body.workerId)
    expect(f.enqueue).toHaveBeenCalledTimes(1)
    expect(f.enqueue.mock.calls[0]).toEqual(expect.arrayContaining(['codex', 'model-a']))
    await expect(f.start({ message: 'A different goal' })).rejects.toThrow('personal_worker_request_conflict')
    const other = await f.start({ requestId: 'goal-0002', agentType: 'claude' })
    expect(other?.body.agentType).toBe('claude')
    expect(f.enqueue.mock.calls[1]?.[5]).toBeUndefined()
    const { readWorkerSettings } = await import('../steward/worker-settings.js')
    expect(readWorkerSettings().agentType).toBe('codex')
    expect(f.enqueue.mock.calls[0]?.[3]).toContain('worker report')
  })
  it('fails closed for unknown contexts, unavailable providers and missing stable IDs', async () => {
    const f = await fixture()
    await expect(f.start({ stewardSessionId: 'not-a-steward' })).rejects.toThrow('personal_worker_context_invalid')
    await expect(f.start({ requestId: undefined })).rejects.toThrow('personal_worker_request_id_required')
    await expect(f.start({ agentType: 'gemini' })).rejects.toMatchObject({ code: 'runtime_unavailable' })
    expect(f.enqueue).not.toHaveBeenCalled()
  })
  it('holds results while the user is talking, then wakes the exact personal session through a durable event', async () => {
    const f = await fixture(), result = await f.start(), workerId = String(result?.body.workerId)
    f.sessions.set('personal-1', { currentRunId: 'user-run' })
    f.service.noteAgentEvent(workerId, { state: 'final', runId: 'worker-run', seq: 1, message: 'Done; evidence attached' })
    expect(f.dispatch).not.toHaveBeenCalled()
    const managerId = f.service.registry.load().workers[workerId]!.managedBy
    expect(f.service.registry.listInboxEvents(managerId)).toHaveLength(1)
    f.sessions.set('personal-1', { currentRunId: null })
    f.service.noteAgentEvent('personal-1', { state: 'final', runId: 'user-run', seq: 2 })
    await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledTimes(1))
    expect(f.dispatch.mock.calls[0]?.[0]).toMatchObject({ method: 'chat.enqueue', params: { sessionId: 'personal-1', agentType: 'shennian', sessionMode: 'standard', sessionScope: 'steward', managerEventId: expect.any(String), text: expect.stringContaining('Done; evidence attached') } })
    expect(f.service.registry.listInboxEvents(managerId)).toHaveLength(0)
  })
  it('keeps failed delivery durable, retries with the same message ID, and recovers owner-only references', async () => {
    const f = await fixture(), result = await f.start(), workerId = String(result?.body.workerId)
    f.dispatch.mockResolvedValueOnce({ durableQueueHandoff: false })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      f.service.noteAgentEvent(workerId, { state: 'error', runId: 'run', seq: 1, message: 'Need login' })
      await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledTimes(1))
      const managerId = f.service.registry.load().workers[workerId]!.managedBy
      expect(f.service.registry.listInboxEvents(managerId)).toHaveLength(1)
      ;(f.service as any).recoverPersistedInboxDeliveries()
      await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledTimes(2))
      expect((f.dispatch.mock.calls[0]?.[0] as any).params.clientMessageId).toBe((f.dispatch.mock.calls[1]?.[0] as any).params.clientMessageId)
      const list = await f.route(f.host, '/workers/list', { stewardSessionId: 'personal-1' })
      expect(list?.body.workers).toEqual([expect.objectContaining({ sessionId: workerId, workerRef: expect.stringMatching(/^wr_/) })])
      await expect(f.route(f.host, '/workers/list', {})).rejects.toMatchObject({ code: 'worker_command_unavailable', status: 404 })
    } finally { errorLog.mockRestore() }
  })
  it('reports meaningful progress but does not wake a running personal Worker every ten minutes', async () => {
    const f = await fixture(), result = await f.start(), workerId = String(result?.body.workerId)
    f.sessions.set(workerId, { currentRunId: 'run' })
    f.service.registry.updateWorker(workerId, { createdAt: new Date(Date.now() - 3600000).toISOString() } as never)
    ;(f.service as any).scanWorkerHealth()
    expect(f.dispatch).not.toHaveBeenCalled()
    await f.route(f.host, '/workers/report', { workerId, message: 'Need your decision' })
    await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledTimes(1))
    expect((f.dispatch.mock.calls[0]?.[0] as any).params.text).toContain('Need your decision')
    expect(() => f.service.reportWorkerProgress('unknown', 'x')).toThrow('personal_worker_context_invalid')
  })
  it('loads only the opt-in bounded core summary and own tasks, not diary or linked files', async () => {
    const f = await fixture(); await f.start()
    const { getStewardDir } = await import('../steward/workspace.js')
    const workspace = getStewardDir(); fs.mkdirSync(workspace)
    try {
      fs.writeFileSync(path.join(workspace, 'index.md'), '| 核心 | personal-summary.md | 简介 | open |\n| 私密 | other.md | 私密 | ask |')
      fs.writeFileSync(path.join(workspace, 'personal-summary.md'), 'Authorized user goals')
      fs.writeFileSync(path.join(workspace, 'other.md'), 'DO_NOT_LOAD')
      const { stewardCoreContext } = await import('../steward/context.js')
      expect(stewardCoreContext('personal-1')).toContain('Authorized user goals')
      expect(stewardCoreContext('personal-1')).not.toContain('DO_NOT_LOAD')
      expect(stewardCoreContext('other')).not.toContain('Verify a bounded task')
      fs.unlinkSync(path.join(workspace, 'personal-summary.md'))
      fs.symlinkSync(path.join(workspace, 'other.md'), path.join(workspace, 'personal-summary.md'))
      expect(stewardCoreContext('personal-1')).not.toContain('DO_NOT_LOAD')
    } finally { fs.rmSync(workspace, { recursive: true, force: true }) }
  })
})

it('does not deliver or list a previous account’s personal Workers after identity rotation', async () => {
  const f = await fixture(), result = await f.start(), workerId = String(result?.body.workerId)
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ machineId: 'test-machine', machineToken: 'synthetic', accountNamespaceId: 'another-account' }))
  f.service.noteAgentEvent(workerId, { state: 'final', runId: 'run', seq: 1, message: 'Private result' })
  await Promise.resolve()
  expect(f.dispatch).not.toHaveBeenCalled()
  expect((await f.route(f.host, '/workers/list', { stewardSessionId: 'personal-1' }))?.body.workers).toEqual([])
})

it('gives replayed terminal events stable identities and retains new progress while an older event is in flight', async () => {
  const f = await fixture(), result = await f.start(), workerId = String(result?.body.workerId)
  const managerId = f.service.registry.load().workers[workerId]!.managedBy
  const terminal = { managerSessionId: managerId, workerSessionId: workerId, kind: 'worker.final' as const, priority: 'normal' as const, runId: 'same-run', summary: 'done' }
  const first = f.service.registry.enqueueInboxEvent(terminal)!
  f.service.registry.removeInboxEvents(managerId, [first.id])
  expect(f.service.registry.enqueueInboxEvent(terminal)?.id).toBe(first.id)
  const progress = f.service.registry.enqueueInboxEvent({ ...terminal, kind: 'worker.progress', summary: 'first progress' })!
  const manager = f.service.registry.getManager(managerId)!
  f.service.registry.upsertManager({ ...manager, deliveringInboxEventIds: [progress.id] })
  const updated = f.service.registry.enqueueInboxEvent({ ...terminal, kind: 'worker.progress', summary: 'new blocker' })!
  expect(updated.id).not.toBe(progress.id)
  f.service.registry.removeInboxEvents(managerId, [progress.id])
  expect(f.service.registry.listInboxEvents(managerId)).toEqual(expect.arrayContaining([expect.objectContaining({ summary: 'new blocker' })]))
})

// @covers src/manager/direct-worker-notifications.ts
it('delivers scheduled Worker progress and terminal result directly without waking the main Agent', async () => {
  const f = await fixture()
  const started = await f.start({ notificationMode: 'direct', scheduleId: 'diary-schedule' })
  const workerId = started!.body.workerId as string
  const { readMessages } = await import('../session/store.js')
  const { parseStewardSayPayload } = await import('@shennian/wire')
  f.sessions.set(workerId, { currentRunId: 'direct-run' } as never)
  f.service.reportWorkerProgress(workerId, '正在整理当天已确认记录')
  f.service.noteAgentEvent(workerId, { state: 'delta', runId: 'direct-run', seq: 1, text: '[查看日记](shennian://diary/2026-10-23)' })
  f.service.noteAgentEvent(workerId, { state: 'final', runId: 'direct-run', seq: 2 })
  await vi.waitFor(() => expect(readMessages('personal-1').map(m => parseStewardSayPayload(m.payload)).filter(m => m?.worker)).toHaveLength(2))
  const messages = readMessages('personal-1').map(m => parseStewardSayPayload(m.payload)).filter(m => m?.worker)
  expect(messages[0]?.worker).toMatchObject({ id: workerId, scheduleId: 'diary-schedule', state: 'worker.final' })
  expect(messages[0]?.content).toContain('shennian://diary/2026-10-23')
  f.service.noteAgentEvent(workerId, { state: 'final', runId: 'direct-run', seq: 2 })
  expect(readMessages('personal-1').map(m => parseStewardSayPayload(m.payload)).filter(m => m?.worker)).toHaveLength(2)
  const { stewardCoreContext } = await import('../steward/context.js')
  expect(stewardCoreContext('personal-1')).toContain('shennian://diary/2026-10-23')
  expect(f.dispatch).not.toHaveBeenCalled()
  expect(Object.values(f.service.registry.load().inbox).flat()).toHaveLength(0)
})
