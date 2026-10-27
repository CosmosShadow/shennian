// @covers src/project-coordination/runtime.ts
// @covers src/project-coordination/admission.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SessionManagerRuntime } from '../session/types.js'
const mock = vi.hoisted(() => ({ open: vi.fn(), records: [] as Array<Record<string, unknown>>, queue: { sessions: {} } as { sessions: Record<string, any[]> } }))
vi.mock('../session/queue-storage.js', () => ({ readQueue: () => mock.queue }))
vi.mock('../personal-agent/sdk-session.js', () => ({ openPersonalAgent: mock.open }))
vi.mock('../session/store.js', () => ({ listSessionRecords: () => mock.records, getDaemonInstallationId: () => 'test-daemon', readMessages: () => [] }))
import { coordinationCommand, runCoordinator, noteCoordinationEvent } from '../project-coordination/runtime.js'
import { projectCoordinationStore as store } from '../project-coordination/store.js'
import { admitProjectTurn, CoordinationWaiting, validateCoordinationSession } from '../project-coordination/admission.js'
let dir: string, workDir: string, previous: string | undefined
const runtime = { resolvePath: (p: string) => p, sessions: new Map(), getAgentSnapshot: () => [{ type: 'codex', supportsStandardSession: true }], chatQueue: { handleEnqueue: vi.fn(async () => true) } } as unknown as SessionManagerRuntime
beforeEach(() => {
  const parent = path.join(os.tmpdir(), 'shennian-tests/unit'); fs.mkdirSync(parent, { recursive: true }); dir = fs.mkdtempSync(path.join(parent, 'coordination-runtime-'))
  workDir = path.join(dir, 'project'); fs.mkdirSync(workDir); previous = process.env.SHENNIAN_HOME; process.env.SHENNIAN_HOME = path.join(dir, 'home')
  mock.queue = { sessions: {} }
  runtime.sessions.clear()
  runtime.nativeFusion = null
  runtime.chatQueue!.getSnapshot = vi.fn(() => ({ pending: [] })) as never
  vi.mocked(runtime.chatQueue!.handleEnqueue).mockClear()
  mock.records.length = 0; mock.open.mockReset()
})
afterEach(() => { if (previous === undefined) delete process.env.SHENNIAN_HOME; else process.env.SHENNIAN_HOME = previous; fs.rmSync(dir, { recursive: true, force: true }) })
describe('project coordination runtime', () => {
  it('persists an answer and resumes the manager once, without answering any Provider permission', async () => {
    store.configure(workDir, { enabled: true })
    store.askUser(workDir, { id: 'manager-question', question: 'What is the required result?', options: [], at: 1 })
    let listener: (event: unknown) => void = () => {}
    mock.open.mockResolvedValue({ session: {
      subscribe: (fn: typeof listener) => { listener = fn; return () => {} },
      prompt: async () => listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '已收到回答。' } }), dispose: vi.fn(),
    }, persist: vi.fn() })
    await coordinationCommand(runtime, { workDir, command: 'answer', questionId: 'manager-question', text: 'A concise report' })
    await vi.waitFor(() => expect(store.read(workDir).messages.some(m => m.id === 'reply-question-answer-manager-question')).toBe(true))
    await coordinationCommand(runtime, { workDir, command: 'answer', questionId: 'manager-question', text: 'A concise report' })
    expect(mock.open).toHaveBeenCalledOnce()
    expect(store.read(workDir).questions?.[0]?.answer).toBe('A concise report')
    expect(store.read(workDir).messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(runtime.chatQueue!.handleEnqueue).not.toHaveBeenCalled()
  })
  it('adopts an already enabled project before admitting new work, only once', async () => {
    store.configure(workDir, { enabled: true })
    runtime.sessions.set('old-live', { currentRunId: 'old-run', workDir } as never)
    mock.records.push({ sessionId: 'old-live', workDir, agentType: 'codex', status: 'active' })
    const next = { sessionId: 'new-task', id: 'new-request', text: 'new work', agentType: 'codex', workDir }
    expect(() => admitProjectTurn(runtime, [next] as never)).toThrow(CoordinationWaiting)
    expect(store.read(workDir).adoptionVersion).toBe(1)
    expect(store.read(workDir).tasks.find(t => t.id === 'old-live')?.status).toBe('running')
    store.progress(workDir, 'old-live', 'final', 'done')
    await coordinationCommand(runtime, { workDir, command: 'get' })
    expect(store.read(workDir).tasks.find(t => t.id === 'old-live')?.status).toBe('review')
    admitProjectTurn(runtime, [next] as never)
    expect(store.read(workDir).tasks.find(t => t.id === 'new-task')?.status).toBe('running')
  })
  it('adopts live, queued and historical tasks without restarting them or exceeding serial capacity', async () => {
    const stop = vi.fn()
    runtime.sessions.set('existing-a', { currentRunId: 'run-a', currentRunPhase: 'tool_running', workDir, adapter: { stop } } as never)
    runtime.sessions.set('existing-b', { currentRunId: 'run-b', currentRunPhase: 'waiting_user_input', workDir, adapter: { stop } } as never)
    mock.records.push(
      { sessionId: 'existing-a', workDir, agentType: 'codex', status: 'active', title: 'Already running' },
      { sessionId: 'existing-b', workDir, agentType: 'codex', status: 'active' },
      { sessionId: 'queued', workDir, agentType: 'codex', status: 'active' },
      { sessionId: 'completed', workDir, agentType: 'codex', status: 'completed', lastMessagePreview: 'Previous result' },
      { sessionId: 'idle', workDir, agentType: 'codex', status: 'active' },
      { sessionId: 'other-project', workDir: dir, agentType: 'codex', status: 'completed' },
      { sessionId: 'internal', workDir, agentType: 'shennian', sessionScope: 'steward' },
    )
    const queued = { sessionId: 'queued', id: 'queued-1', text: 'Previously queued', agentType: 'codex', workDir, createdAt: '2026-10-24T00:00:00Z' }
    mock.queue.sessions.queued = [queued]
    await coordinationCommand(runtime, { workDir, command: 'configure', patch: { enabled: true } })
    const snapshot = store.read(workDir)
    expect(snapshot.tasks.map(t => t.id)).toEqual(['existing-a', 'existing-b', 'queued', 'completed', 'idle'])
    expect(snapshot.tasks.find(t => t.id === 'existing-a')).toMatchObject({ status: 'running', admittedRequestId: 'adopted:run-a' })
    expect(snapshot.tasks.find(t => t.id === 'existing-b')).toMatchObject({ status: 'waiting', waitingReason: 'waiting_user_input' })
    expect(snapshot.tasks.find(t => t.id === 'completed')).toMatchObject({ status: 'completed', result: 'Previous result', requestIds: [] })
    expect(snapshot.tasks.find(t => t.id === 'idle')?.status).toBe('memo')
    expect(stop).not.toHaveBeenCalled()
    expect(runtime.chatQueue!.handleEnqueue).not.toHaveBeenCalled()
    expect(mock.open).not.toHaveBeenCalled()
    expect(() => admitProjectTurn(runtime, [queued] as never)).toThrow(CoordinationWaiting)
    store.progress(workDir, 'existing-a', 'final', 'First result')
    expect(() => admitProjectTurn(runtime, [queued] as never)).toThrow(CoordinationWaiting)
    store.progress(workDir, 'existing-b', 'final', 'Second result')
    admitProjectTurn(runtime, [queued] as never)
    expect(store.read(workDir).tasks.find(t => t.id === 'queued')?.status).toBe('running')
    await coordinationCommand(runtime, { workDir, command: 'configure', patch: { enabled: true } })
    expect(store.read(workDir).tasks).toHaveLength(5)
    expect(stop).not.toHaveBeenCalled()
  })
  it('adopts an observed native run and handles its terminal without dispatching it again', async () => {
    mock.records.push({ sessionId: 'native-existing', workDir, agentType: 'codex', status: 'active' })
    runtime.nativeFusion = { getActiveRuns: () => [{ sessionId: 'native-existing', runId: 'native-run' }] } as never
    await coordinationCommand(runtime, { workDir, command: 'configure', patch: { enabled: true, paused: true } })
    expect(store.read(workDir).tasks[0]).toMatchObject({ status: 'running', admittedRequestId: 'adopted:native-run' })
    noteCoordinationEvent(runtime, 'native-existing', 'final', 'Real native result')
    await vi.waitFor(() => expect(store.read(workDir).managerBusy).toBe(false))
    expect(store.read(workDir).tasks[0]).toMatchObject({ status: 'review', result: 'Real native result' })
    expect(runtime.chatQueue!.handleEnqueue).not.toHaveBeenCalled()
    expect(mock.open).not.toHaveBeenCalled()
  })
  it('runs the built-in coordinator with project tools only and preserves plain conversation', async () => {
    store.configure(workDir, { enabled: true })
    let listener: (event: unknown) => void = () => {}
    mock.open.mockResolvedValue({ session: {
      subscribe: (fn: typeof listener) => { listener = fn; return () => {} },
      prompt: async () => listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '已记录，我会先处理 Bug。' } }), dispose: vi.fn(),
    }, persist: vi.fn() })
    await runCoordinator(runtime, workDir, '以后优先处理 Bug', 'request-1')
    expect(mock.open.mock.calls[0]?.[5]).toBe('project-coordination')
    const names = mock.open.mock.calls[0]![6].map((t: { name: string }) => t.name)
    expect(names).toEqual(['project_tasks', 'project_create_task', 'project_task_action', 'project_read_task', 'project_configure', 'project_ask_user', 'project_instructions'])
    expect(store.read(workDir).messages.at(-1)?.text).toBe('已记录，我会先处理 Bug。')
    expect(store.read(workDir).managerBusy).toBe(false)
  })
  it('binds model-created tasks to the real project directory with a concise title', async () => {
    store.configure(workDir, { enabled: true, automatic: false })
    mock.open.mockResolvedValue({ session: { subscribe: () => () => {}, prompt: async () => {}, dispose: vi.fn() }, persist: vi.fn() })
    await runCoordinator(runtime, workDir, '创建验收任务', 'bound-project')
    expect(mock.open.mock.calls[0]![4]).toContain(JSON.stringify(fs.realpathSync(workDir)))
    expect(mock.open.mock.calls[0]![1]).not.toBe(workDir)
    const create = mock.open.mock.calls[0]![6].find((tool: { name: string }) => tool.name === 'project_create_task')
    await create.execute('bound-task', { title: '创建 first.txt', instruction: '仅在当前项目创建 first.txt。', agentType: 'codex' })
    const frame = vi.mocked(runtime.chatQueue!.handleEnqueue).mock.calls.slice(-1)[0]![0]
    expect(frame.params.workDir).toBe(fs.realpathSync(workDir))
    expect(String(frame.params.text).split('\n')[0]).toBe('创建 first.txt')
    expect(frame.params.text).toContain(JSON.stringify(fs.realpathSync(workDir)))
    expect(frame.params.text).not.toContain(mock.open.mock.calls[0]![1])
  })
  it('keeps accepted messages queued when paused and refuses unrelated task access', async () => {
    store.configure(workDir, { enabled: true, paused: true })
    await coordinationCommand(runtime, { workDir, command: 'message', text: '查一下问题', requestId: 'message-1' })
    await coordinationCommand(runtime, { workDir, command: 'message', text: '查一下问题', requestId: 'message-1' })
    expect(store.read(workDir).messages).toHaveLength(1)
    expect(mock.open).not.toHaveBeenCalled()
    await expect(coordinationCommand(runtime, { workDir, command: 'task_read', taskId: 'another-project-task' })).rejects.toThrow('task_missing')
  })
  it('blocks a second project turn while preserving its queued message', () => {
    store.configure(workDir, { enabled: true })
    const first = { sessionId: 'a', id: 'a-1', text: 'first', agentType: 'codex', workDir }
    admitProjectTurn(runtime, [first] as never)
    expect(() => admitProjectTurn(runtime, [{ ...first, sessionId: 'b', id: 'b-1' }] as never)).toThrow(CoordinationWaiting)
    expect(store.read(workDir).tasks.find(t => t.id === 'b')?.status).toBe('queued')
  })
  it('reserves a write slot for read-only sessions that can request elevated writes', () => {
    store.configure(workDir, { enabled: true, mode: 'research_parallel' })
    const writer = { sessionId: 'writer', id: 'writer-1', text: 'write', agentType: 'codex', workDir }
    admitProjectTurn(runtime, [writer] as never)
    const next = { ...writer, sessionId: 'research', id: 'research-1' }
    mock.records.push({ sessionId: 'research', codexSettings: { sandbox: 'read-only', approvalPolicy: 'on-request' } })
    expect(() => admitProjectTurn(runtime, [next] as never)).toThrow(CoordinationWaiting)
    expect(store.read(workDir).tasks.find(t => t.id === 'research')?.access).toBe('write')
    mock.records[0]!.codexSettings = { sandbox: 'read-only', approvalPolicy: 'never' }
    admitProjectTurn(runtime, [next] as never)
    expect(store.read(workDir).tasks.find(t => t.id === 'research')).toMatchObject({ access: 'read', status: 'running' })
  })
  it('refuses a legacy controller that would hold the same slot its child needs', () => {
    store.configure(workDir, { enabled: true })
    expect(() => validateCoordinationSession(runtime, { workDir, sessionMode: 'manager' })).toThrow('legacy_manager_unsupported')
    expect(() => validateCoordinationSession(runtime, { workDir, sessionMode: 'standard' })).not.toThrow()
  })
})
