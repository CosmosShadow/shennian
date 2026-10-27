// @covers src/session/run-stall.ts

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../session/index-publisher.js', () => ({ requestSessionIndexPublish: vi.fn() }))

const MIN = 60_000
let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-run-stall-'))
  vi.stubEnv('SHENNIAN_HOME', home)
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(home, { recursive: true, force: true })
})

const session = (overrides: Record<string, unknown> = {}) => ({
  currentRunId: 'run-1', currentRunPhase: 'tool_running', lastProviderActivityAt: 0, stalledNotice: null, ...overrides,
}) as never

async function load() {
  const stall = await import('../session/run-stall.js')
  const { readMessages } = await import('../session/store.js')
  const notices = () => readMessages('s1').filter((m) => m.id.startsWith('run-stalled-'))
  return { ...stall, notices }
}

describe('a run that produces nothing is reported instead of looking busy forever', () => {
  it('flags a silent run once, after the threshold, and keeps its state untouched', async () => {
    const { checkRunStalls, notices } = await load()
    const active = session()
    const publish = vi.fn()
    expect(checkRunStalls([['s1', active]], publish, 9 * MIN)).toEqual([])
    expect(checkRunStalls([['s1', active]], publish, 10 * MIN)).toEqual(['s1'])
    expect(checkRunStalls([['s1', active]], publish, 15 * MIN)).toEqual([])
    expect(notices()).toHaveLength(1)
    expect(notices()[0]!.id).toBe('run-stalled-run-1')
    expect(notices()[0]!.payload).toContain('10 分钟')
    expect(notices()[0]!.payload).toContain('停止')
    // the run must stay "active" so clients keep offering Stop
    expect((active as { currentRunId: string }).currentRunId).toBe('run-1')
    expect(publish).toHaveBeenCalledOnce()
  })

  it('does not flag idle sessions, runs waiting for the user, or a run that was just dispatched', async () => {
    const { checkRunStalls, notices } = await load()
    checkRunStalls([
      ['s1', session({ currentRunId: null })],
      ['s2', session({ currentRunPhase: 'waiting_approval' })],
      ['s3', session({ currentRunPhase: 'waiting_user_input' })],
      ['s4', session({ lastProviderActivityAt: 10 * MIN })],
      ['s5', session({ lastProviderActivityAt: undefined })],
    ], vi.fn(), 10 * MIN)
    expect(notices()).toHaveLength(0)
  })

  it('honours SHENNIAN_RUN_STALL_MS', async () => {
    vi.stubEnv('SHENNIAN_RUN_STALL_MS', '30000')
    const { checkRunStalls, runStallThresholdMs } = await load()
    expect(runStallThresholdMs()).toBe(30_000)
    expect(checkRunStalls([['s1', session()]], vi.fn(), 31_000)).toEqual(['s1'])
    vi.stubEnv('SHENNIAN_RUN_STALL_MS', 'nonsense')
    expect(runStallThresholdMs()).toBe(10 * MIN)
  })

  it('updates the same notice when output resumes or the run ends, and can flag a later run', async () => {
    const { checkRunStalls, noteRunActivity, notices } = await load()
    const active = session() as { stalledNotice: unknown; currentRunId: string; lastProviderActivityAt: number }
    checkRunStalls([['s1', active as never]], vi.fn(), 10 * MIN)
    noteRunActivity('s1', active as never, false)
    expect(notices()).toHaveLength(1)
    expect(notices()[0]!.payload).toContain('已恢复输出')
    expect(active.stalledNotice).toBeNull()
    expect(active.lastProviderActivityAt).toBeGreaterThan(0)

    active.currentRunId = 'run-2'
    active.lastProviderActivityAt = 0
    checkRunStalls([['s1', active as never]], vi.fn(), 12 * MIN)
    noteRunActivity('s1', active as never, true)
    expect(notices().map((m) => m.id).sort()).toEqual(['run-stalled-run-1', 'run-stalled-run-2'])
    expect(notices().find((m) => m.id === 'run-stalled-run-2')!.payload).toContain('已经结束')
  })

  it('treats every provider event as activity when wired through the adapter bindings', async () => {
    const { bindAdapterEvents } = await import('../session/handlers/chat-events.js')
    const { checkRunStalls, notices } = await load()
    const active = session({ pendingTextEvent: null, heartbeatSeq: 0, heartbeatTimer: null, nextEventSeq: 0 }) as never
    const runtime = {
      client: { sendEvent: vi.fn(), sendAgentEvent: vi.fn() },
      sessions: new Map([['s1', active]]),
      chatQueue: { noteTerminal: vi.fn() }, runJournal: null, recoveryBarrier: null, runTextAcc: new Map(),
      managerRuntime: null, nativeFusion: null,
    }
    const adapter = new EventEmitter()
    bindAdapterEvents(runtime as never, 's1', 'codex', adapter as never)
    checkRunStalls([['s1', active]], vi.fn(), 10 * MIN)
    expect(notices()).toHaveLength(1)
    adapter.emit('agentEvent', { state: 'delta', runId: 'run-1', seq: 1, thinking: 'hmm' })
    expect(notices()[0]!.payload).toContain('已恢复输出')
  })
})
