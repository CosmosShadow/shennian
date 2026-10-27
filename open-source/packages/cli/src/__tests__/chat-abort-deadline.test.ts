// @covers src/session/handlers/chat.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../session/index-publisher.js', () => ({ requestSessionIndexPublish: vi.fn() }))

let home: string
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-abort-'))
  vi.stubEnv('SHENNIAN_HOME', home)
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(home, { recursive: true, force: true })
})

async function setup(stop: () => Promise<void>) {
  const { handleChatAbort, STOP_TIMEOUT_MS } = await import('../session/handlers/chat.js')
  const { readMessages } = await import('../session/store.js')
  const adapter = { stop: vi.fn(stop), removeAllListeners: vi.fn() }
  const session = {
    adapter, currentRunId: 'run-1', currentRunPhase: 'tool_running', nextEventSeq: 3, heartbeatTimer: null,
    pendingTextEvent: null, journalRunId: null,
  }
  const sendRes = vi.fn()
  const publish = vi.fn()
  const runtime = {
    sessions: new Map([['s1', session]]), runTextAcc: new Map(), runJournal: null, recoveryBarrier: null,
    client: { sendRes, sendAgentEvent: vi.fn(), sendEvent: vi.fn() },
    chatQueue: { noteTerminal: vi.fn(), purgeSession: vi.fn() }, activityPublisher: { publish },
  }
  const abort = () => handleChatAbort(runtime as never, { type: 'req', id: 'req-1', method: 'chat.abort', params: { sessionId: 's1' } } as never)
  return { runtime, session, adapter, sendRes, publish, abort, STOP_TIMEOUT_MS, messages: () => readMessages('s1') }
}

describe('Stop always ends the run, even when the Agent will not stop', () => {
  it('behaves as before when the Agent stops promptly', async () => {
    const { abort, sendRes, publish, runtime, messages, session } = await setup(async () => {})
    await abort()
    expect(sendRes).toHaveBeenCalledWith({ type: 'res', id: 'req-1', ok: true })
    expect(publish).toHaveBeenCalledWith('s1', null)
    expect(session.currentRunId).toBeNull()
    expect(runtime.sessions.has('s1')).toBe(true)
    expect(messages()).toHaveLength(0)
  })

  it('forces the run to end and says so when the Agent never answers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { abort, sendRes, publish, runtime, adapter, messages, session, STOP_TIMEOUT_MS } = await setup(() => new Promise(() => {}))
    const pending = abort()
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS + 1)
    await pending
    expect(sendRes).toHaveBeenCalledWith({ type: 'res', id: 'req-1', ok: true })
    expect(publish).toHaveBeenCalledWith('s1', null)
    expect(session.currentRunId).toBeNull()
    expect(runtime.sessions.has('s1')).toBe(false)
    expect(adapter.removeAllListeners).toHaveBeenCalled()
    expect(adapter.stop).toHaveBeenCalledTimes(2) // the second call keeps shutting it down in the background
    expect(messages().map((m) => m.id)).toEqual(['stop-forced-run-1'])
    expect(messages()[0]!.payload).toContain('强制结束')
  })

  it('still reports a stop that fails outright', async () => {
    const { abort, sendRes, runtime } = await setup(async () => { throw new Error('boom') })
    await abort()
    expect(sendRes).toHaveBeenCalledWith({ type: 'res', id: 'req-1', ok: false, error: 'agent_stop_failed' })
    expect(runtime.sessions.has('s1')).toBe(true)
  })
})
