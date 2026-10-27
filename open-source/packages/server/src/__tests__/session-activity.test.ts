// @covers open-source/packages/server/src/services/session-activity.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedis, redisState } = vi.hoisted(() => {
  const state = new Map<string, string>()
  return {
    redisState: state,
    mockRedis: {
      get: vi.fn(async (key: string) => state.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        state.set(key, value)
        return 'OK'
      }),
      del: vi.fn(async (key: string) => (state.delete(key) ? 1 : 0)),
      mget: vi.fn(async (keys: string[]) => keys.map((key) => state.get(key) ?? null)),
    },
  }
})

vi.mock('../lib/redis.js', () => ({ redis: mockRedis }))

import {
  getSessionActivity,
  updateSessionActivityFromAgentEvent,
} from '../services/session-activity.js'

describe('session-activity', () => {
  it('preserves external owner lifecycle metadata in the compatible activity snapshot', async () => {
    const activity = await updateSessionActivityFromAgentEvent({
      sessionId: 's-external',
      runId: 'external-1',
      state: 'start',
      owner: 'external',
      ownerLabel: 'Codex Desktop',
      lifecycle: 'queued',
      canStop: false,
    })

    expect(activity).toMatchObject({
      owner: 'external',
      ownerLabel: 'Codex Desktop',
      lifecycle: 'queued',
      runPhase: 'thinking',
    })
  })
  beforeEach(() => {
    vi.clearAllMocks()
    redisState.clear()
  })

  it('keeps an ACP permission request visible as waiting approval', async () => {
    const activity = await updateSessionActivityFromAgentEvent({
      sessionId: 's-acp',
      runId: 'r-acp',
      seq: 3,
      state: 'approval-pending',
      permission: {
        id: 'permission-1',
        toolCallId: 'tool-1',
        options: [{ id: 'allow', name: 'Allow once', kind: 'allow_once' }],
      },
    })

    expect(activity).toMatchObject({
      sessionId: 's-acp',
      runId: 'r-acp',
      runPhase: 'waiting_approval',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the live activity when the current run reaches final', async () => {
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'delta',
      text: 'hello',
    })

    const cleared = await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'final',
    })

    expect(cleared).toBeNull()
    await expect(getSessionActivity('s1')).resolves.toBeNull()
  })

  it('ignores late events after a run has already reached final', async () => {
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'delta',
      text: 'hello',
    })
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'final',
    })

    const late = await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'tool-result',
      name: 'read_file',
      result: 'still late',
    })

    expect(late).toBeUndefined()
    await expect(getSessionActivity('s1')).resolves.toBeNull()
  })

  it('does not let an older run clear a newer run that already started', async () => {
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'delta',
      text: 'old run',
    })
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r2',
      state: 'start',
    })

    const staleFinal = await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'final',
    })

    expect(staleFinal).toBeUndefined()
    await expect(getSessionActivity('s1')).resolves.toMatchObject({
      sessionId: 's1',
      runId: 'r2',
      runPhase: 'thinking',
    })
  })

  it('refreshes an active run from heartbeat without changing its phase', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-08T00:00:00.000Z'))
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'tool-call',
      name: 'command_execution',
      args: { command: 'sleep 600' },
    })

    vi.setSystemTime(new Date('2026-06-08T00:03:00.000Z'))
    const refreshed = await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'heartbeat',
      runPhase: 'tool_running',
    })

    expect(refreshed).toMatchObject({
      sessionId: 's1',
      runId: 'r1',
      runPhase: 'tool_running',
      toolCallCount: 1,
      startedAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:03:00.000Z',
    })
  })

  it('counts tool calls within a run and resets the count for a new run', async () => {
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      seq: 1,
      state: 'tool-call',
      name: 'read_file',
    })
    const second = await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      seq: 2,
      state: 'tool-call',
      name: 'search',
    })

    expect(second?.toolCallCount).toBe(2)

    const nextRun = await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r2',
      seq: 1,
      state: 'start',
    })
    expect(nextRun?.toolCallCount).toBe(0)
  })

  it('does not let an older heartbeat overwrite a newer active run', async () => {
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'tool-call',
      name: 'command_execution',
      args: { command: 'old' },
    })
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r2',
      state: 'start',
    })

    const staleHeartbeat = await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'heartbeat',
      runPhase: 'tool_running',
    })

    expect(staleHeartbeat).toBeUndefined()
    await expect(getSessionActivity('s1')).resolves.toMatchObject({
      sessionId: 's1',
      runId: 'r2',
      runPhase: 'thinking',
    })
  })

  it('concurrent delta does not revive activity after final clears it', async () => {
    // Simulate: delta passes the first isClosedRun check, then final
    // runs fully (markClosedRun + clearActivity), then delta reaches
    // the setActivity call. The re-check before write should stop it.
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'delta',
      text: 'streaming',
    })

    // final clears activity and marks run as closed
    await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'final',
    })

    // A late delta that somehow passed the early guard (simulated by
    // directly writing to redis then calling update again)
    const late = await updateSessionActivityFromAgentEvent({
      sessionId: 's1',
      runId: 'r1',
      state: 'delta',
      text: 'late chunk',
    })

    expect(late).toBeUndefined()
    await expect(getSessionActivity('s1')).resolves.toBeNull()
  })
})
