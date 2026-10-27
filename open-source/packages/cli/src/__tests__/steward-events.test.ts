// @covers src/session/handlers/chat-events.ts
// @covers src/session/handlers/steward.ts

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../session/index-publisher.js', () => ({ requestSessionIndexPublish: vi.fn() }))

let root: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-steward-events-')))
  vi.stubEnv('SHENNIAN_HOME', path.join(root, '.shennian'))
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(root, { recursive: true, force: true })
})

async function setup(scope: 'steward' | 'personal') {
  const store = await import('../session/store.js')
  const { ensureStewardWorkspace } = await import('../steward/workspace.js')
  const { bindAdapterEvents } = await import('../session/handlers/chat-events.js')
  const { commitStewardSay } = await import('../session/handlers/steward.js')
  const wire = await import('@shennian/wire')
  const dir = scope === 'steward' ? ensureStewardWorkspace().dir : root
  store.recordSession({ sessionId: 'sess', agentType: 'codex', workDir: dir, sessionScope: scope })
  const active = {
    workDir: dir, agentType: 'codex', sessionScope: scope, agentSessionId: null, lastActiveAt: Date.now(),
    currentRunId: null, currentRunPhase: null, nextEventSeq: 0, heartbeatSeq: 0, heartbeatTimer: null,
    pendingTextEvent: null, adapter: null,
  } as Record<string, unknown>
  const runtime = {
    sessions: new Map([['sess', active]]),
    runTextAcc: new Map(),
    processedReqIds: new Set(),
    client: { sendAgentEvent: vi.fn(), sendEvent: vi.fn(), sendRes: vi.fn() },
  } as never
  const adapter = new EventEmitter()
  bindAdapterEvents(runtime, 'sess', 'codex', adapter as never)
  const emit = (event: Record<string, unknown>) => adapter.emit('agentEvent', event)
  const shown = () => store.readMessages('sess').reverse()
    .map((message) => wire.parseStewardSayPayload(message.payload))
    .filter((payload) => payload != null)
    .map((payload) => `${payload!.source}:${payload!.content}`)
  const raw = () => store.readMessages('sess').reverse().map((message) => message.payload)
  return { runtime, active, emit, shown, raw, say: (text: string) => commitStewardSay(runtime, 'sess', text) }
}

describe('steward turns in the event pipeline', () => {
  it('shows the last output when the turn ends without a single say', async () => {
    const { emit, shown, raw } = await setup('steward')
    emit({ state: 'start', runId: 'r1', seq: 0 })
    emit({ state: 'delta', runId: 'r1', seq: 1, text: '先看看项目。' })
    emit({ state: 'tool-call', runId: 'r1', seq: 2, name: 'shell', toolCallId: 't1' })
    emit({ state: 'delta', runId: 'r1', seq: 3, text: '你有三个项目，其中 app 最近在改。' })
    emit({ state: 'final', runId: 'r1', seq: 4 })
    expect(shown()).toEqual(['fallback:你有三个项目，其中 app 最近在改。'])
    // The agent's own text stays in the transcript for local inspection.
    expect(raw()).toContain('先看看项目。')
  })

  it('stays silent about the last output when the turn used say, and resets per turn', async () => {
    const { emit, shown, say } = await setup('steward')
    emit({ state: 'start', runId: 'r1', seq: 0 })
    say('收到，我去查')
    emit({ state: 'delta', runId: 'r1', seq: 1, text: '内部说明' })
    emit({ state: 'final', runId: 'r1', seq: 2 })
    // The next turn never says: only its own output may be shown, not turn one's.
    ;(await import('../session/store.js')).appendMessage('sess', {
      id: 'user-2', sessionId: 'sess', role: 'user', ts: Date.now() + 60_000, payload: '再来一次',
    })
    emit({ state: 'start', runId: 'r2', seq: 0 })
    emit({ state: 'delta', runId: 'r2', seq: 1, text: '第二轮的结论' })
    emit({ state: 'final', runId: 'r2', seq: 2 })
    expect(shown()).toEqual(['say:收到，我去查', 'fallback:第二轮的结论'])
  })

  it('surfaces a failed or aborted turn instead of leaving the user waiting', async () => {
    const { emit, shown } = await setup('steward')
    emit({ state: 'start', runId: 'r1', seq: 0 })
    emit({ state: 'error', runId: 'r1', seq: 1, message: '模型额度用完' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    emit({ state: 'start', runId: 'r2', seq: 0 })
    emit({ state: 'aborted', runId: 'r2', seq: 1, message: '已停止' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(shown()).toEqual(['fallback:模型额度用完', 'fallback:已停止'])
  })

  it('does nothing extra for an ordinary session', async () => {
    const { emit, shown } = await setup('personal')
    emit({ state: 'start', runId: 'r1', seq: 0 })
    emit({ state: 'delta', runId: 'r1', seq: 1, text: '普通回复' })
    emit({ state: 'final', runId: 'r1', seq: 2 })
    expect(shown()).toEqual([])
  })
})


it('does not let an earlier say suppress the result of a background continuation without a new user message', async () => {
  const { emit, shown, say } = await setup('steward')
  emit({ state: 'start', runId: 'r1', seq: 0 })
  say('已安排后台任务')
  emit({ state: 'final', runId: 'r1', seq: 1 })
  emit({ state: 'start', runId: 'r2', seq: 0 })
  emit({ state: 'delta', runId: 'r2', seq: 1, text: '后台任务已核对完成' })
  emit({ state: 'final', runId: 'r2', seq: 2 })
  expect(shown()).toEqual(['say:已安排后台任务', 'fallback:后台任务已核对完成'])
})
it('recovers an exact same-run say receipt without duplicating the visible reply', async () => {
  const { emit, shown, say, active } = await setup('steward')
  emit({ state: 'start', runId: 'r1', seq: 0 })
  say('本轮已说明')
  active.stewardSay = { count: 0 }
  emit({ state: 'delta', runId: 'r1', seq: 1, text: '内部输出' })
  emit({ state: 'final', runId: 'r1', seq: 2 })
  expect(shown()).toEqual(['say:本轮已说明'])
})
