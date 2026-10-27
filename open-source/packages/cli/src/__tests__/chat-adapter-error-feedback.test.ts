// @covers src/session/handlers/chat-events.ts

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../session/index-publisher.js', () => ({ requestSessionIndexPublish: vi.fn() }))

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-adapter-error-'))
  vi.stubEnv('SHENNIAN_HOME', home)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(home, { recursive: true, force: true })
})

async function bind(isDispatching: boolean | undefined) {
  const { bindAdapterEvents } = await import('../session/handlers/chat-events.js')
  const { readMessages } = await import('../session/store.js')
  const adapter = new EventEmitter()
  const sendEvent = vi.fn()
  const runtime = {
    client: { sendEvent, sendAgentEvent: vi.fn() },
    sessions: new Map(),
    chatQueue: { noteTerminal: vi.fn(), ...(isDispatching === undefined ? {} : { isDispatching: () => isDispatching }) },
    runJournal: null,
    recoveryBarrier: null,
  }
  bindAdapterEvents(runtime as never, 'session-1', 'codex', adapter as never)
  return { adapter, sendEvent, messages: () => readMessages('session-1') }
}

describe('adapter errors reach the conversation, not only a transient relay event', () => {
  it('writes an error that arrives mid-run into the transcript', async () => {
    const { adapter, sendEvent, messages } = await bind(false)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    adapter.emit('error', new Error('codex app-server exited unexpectedly'))
    expect(messages().map((m) => m.payload)).toEqual(['codex app-server exited unexpectedly'])
    expect(sendEvent).toHaveBeenCalledOnce()
  })

  it('leaves it to the queue while a queued message is still being handed over', async () => {
    const { adapter, sendEvent, messages } = await bind(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    adapter.emit('error', new Error('agent_workdir_not_found: 工作目录不存在：C:\\gone'))
    adapter.emit('error', new Error('agent_workdir_not_found: 工作目录不存在：C:\\gone'))
    expect(messages()).toHaveLength(0)
    expect(sendEvent).toHaveBeenCalledTimes(2)
  })

  it('still records the error when the queue does not report dispatch state', async () => {
    const { adapter, messages } = await bind(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    adapter.emit('error', new Error('spawn failed'))
    expect(messages()).toHaveLength(1)
  })
})
