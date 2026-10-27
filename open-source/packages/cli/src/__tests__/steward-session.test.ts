// @covers src/steward/session.ts
// @covers src/session/handlers/steward.ts
// @covers src/session/store.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../session/index-publisher.js', () => ({ requestSessionIndexPublish: vi.fn() }))

let root: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-steward-session-')))
  vi.stubEnv('SHENNIAN_HOME', path.join(root, '.shennian'))
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(root, { recursive: true, force: true })
})

async function load() {
  const [store, steward, handlers, wire, workspace] = await Promise.all([
    import('../session/store.js'),
    import('../steward/session.js'),
    import('../session/handlers/steward.js'),
    import('@shennian/wire'),
    import('../steward/workspace.js'),
  ])
  return { store, steward, handlers, wire, workspace }
}

function runtime() {
  return { sessions: new Map(), client: {} } as never
}

describe('steward scope in the local session store', () => {
  it('is sticky: only a brand-new session can become steward, and it never reverts', async () => {
    const { store, steward } = await load()
    const dir = steward.assertStewardWorkDir((await import('../steward/workspace.js')).ensureStewardWorkspace().dir)
    store.recordSession({ sessionId: 'steward-1', agentType: 'codex', workDir: dir, sessionScope: 'steward' })
    store.recordSession({ sessionId: 'steward-1', agentType: 'codex', workDir: dir, sessionScope: 'personal' })
    store.recordSession({ sessionId: 'personal-1', agentType: 'codex', workDir: root })
    store.recordSession({ sessionId: 'personal-1', agentType: 'codex', workDir: root, sessionScope: 'steward' })
    const records = new Map(store.listSessionRecords().map((record) => [record.sessionId, record]))
    expect(records.get('steward-1')).toMatchObject({ sessionScope: 'steward', nativeSessionVisibility: 'internal' })
    expect(records.get('personal-1')).toMatchObject({ sessionScope: 'personal', nativeSessionVisibility: 'user' })
    expect(steward.isStewardSessionId('steward-1')).toBe(true)
    expect(steward.isStewardSessionId('personal-1')).toBe(false)
    expect(steward.isStewardSessionId('missing')).toBe(false)
  })

  it('exports the scope in the index projection only for steward sessions', async () => {
    const { store, steward } = await load()
    const dir = steward.assertStewardWorkDir((await import('../steward/workspace.js')).ensureStewardWorkspace().dir)
    for (const [id, workDir, scope] of [['s', dir, 'steward'], ['p', root, undefined]] as const) {
      store.recordSession({ sessionId: id, agentType: 'codex', workDir, sessionScope: scope, localReady: true,
        firstUserMessageId: `${id}-m`, firstUserBodyRevision: 1 })
    }
    const projected = new Map(store.listPendingSessionIndexUpdates().map((update) => [update.session.id, update.session]))
    expect(projected.get('s')).toMatchObject({ sessionScope: 'steward', nativeSessionVisibility: 'internal' })
    expect(projected.get('p')).not.toHaveProperty('sessionScope')
  })

  it('injects the session id and a schedule grant only into a steward Agent environment', async () => {
    const { store, steward } = await load()
    const dir = (await import('../steward/workspace.js')).ensureStewardWorkspace().dir
    store.recordSession({ sessionId: 's', agentType: 'codex', workDir: dir, sessionScope: 'steward' })
    store.recordSession({ sessionId: 'p', agentType: 'codex', workDir: root })
    const env = steward.stewardSessionEnv('s')
    expect(env[steward.STEWARD_SESSION_ID_ENV]).toBe('s')
    expect(typeof env.SHENNIAN_SCHEDULE_CONTEXT).toBe('string')
    expect(env.SHENNIAN_SCHEDULE_CONTEXT.length).toBeGreaterThan(0)
    expect(steward.stewardSessionEnv('p')).toEqual({})
  })
})

describe('steward list preview', () => {
  it('previews only the user and steward_say, never the Agent\'s own text', async () => {
    const { store, steward, handlers } = await load()
    const dir = (await import('../steward/workspace.js')).ensureStewardWorkspace().dir
    store.recordSession({ sessionId: 's', agentType: 'codex', workDir: dir, sessionScope: 'steward' })
    store.recordSession({ sessionId: 'p', agentType: 'codex', workDir: root })
    const at = Date.now()
    store.appendMessage('s', { id: 'u1', sessionId: 's', role: 'user', ts: at, payload: '帮我看看项目' })
    store.appendMessage('s', { id: 'a1', sessionId: 's', role: 'agent', ts: at + 1, payload: '内部：先读取 index.md' })
    store.appendMessage('p', { id: 'pa1', sessionId: 'p', role: 'agent', ts: at + 1, payload: '普通回复' })
    const preview = (id: string) => store.listSessionRecords().find((record) => record.sessionId === id)?.lastMessagePreview
    expect(preview('s')).toBe('帮我看看项目')
    handlers.commitStewardSay({ sessions: new Map(), client: {} } as never, 's', '你有三个项目')
    expect(preview('s')).toBe('你有三个项目')
    expect(preview('p')).toBe('普通回复')
    expect(steward.isStewardSessionId('s')).toBe(true)
  })
})

describe('steward workspace pinning', () => {
  it('accepts only the fixed workspace, never another directory or a link to it', async () => {
    const { steward, workspace } = await load()
    const dir = workspace.ensureStewardWorkspace().dir
    expect(steward.assertStewardWorkDir(dir)).toBe(dir)
    expect(() => steward.assertStewardWorkDir(root)).toThrowError(expect.objectContaining({ code: 'steward_workdir_invalid' }))
    expect(() => steward.assertStewardWorkDir(path.join(root, 'missing'))).toThrowError(expect.objectContaining({ code: 'steward_workdir_invalid' }))
    expect(() => steward.assertStewardWorkDir(path.join(root, '.shennian'))).toThrow()
    const link = path.join(root, 'alias')
    fs.symlinkSync(dir, link)
    expect(steward.assertStewardWorkDir(link)).toBe(dir)
  })
})

describe('steward say and last-output fallback', () => {
  async function setup() {
    const loaded = await load()
    const dir = loaded.workspace.ensureStewardWorkspace().dir
    loaded.store.recordSession({ sessionId: 's', agentType: 'codex', workDir: dir, sessionScope: 'steward' })
    loaded.store.recordSession({ sessionId: 'p', agentType: 'codex', workDir: root })
    return { ...loaded, dir }
  }

  const bodies = async (sessionId: string) => {
    const store = await import('../session/store.js')
    // readMessages is newest-first; tests read in commit order.
    return store.readMessages(sessionId).reverse()
  }

  it('commits a typed steward message and counts it for the turn', async () => {
    const { handlers, wire } = await setup()
    const active = { stewardSay: undefined } as Record<string, unknown>
    const rt = { sessions: new Map([['s', active]]), client: {} } as never
    const { messageId } = handlers.commitStewardSay(rt, 's', '  收到，我去查  ')
    expect(messageId).toMatch(/^steward-say-/)
    expect(active.stewardSay).toEqual({ count: 1 })
    const [message] = await bodies('s')
    expect(wire.parseStewardSayPayload(message!.payload)).toEqual({ v: 1, type: 'steward_say', content: '收到，我去查', source: 'say' })
  })

  it('rejects other sessions, empty text and oversized text with stable codes', async () => {
    const { handlers, steward } = await setup()
    const rt = runtime()
    expect(() => handlers.commitStewardSay(rt, 'p', 'hi')).toThrowError(expect.objectContaining({ code: 'steward_session_required' }))
    expect(() => handlers.commitStewardSay(rt, 'nope', 'hi')).toThrowError(expect.objectContaining({ code: 'steward_session_required' }))
    expect(() => handlers.commitStewardSay(rt, 's', '   ')).toThrowError(expect.objectContaining({ code: 'steward_say_empty' }))
    expect(() => handlers.commitStewardSay(rt, 's', 'x'.repeat(steward.STEWARD_SAY_MAX_CHARS + 1))).toThrowError(expect.objectContaining({ code: 'steward_say_too_long' }))
  })

  it('falls back to the last output only when the turn never called say', async () => {
    const { handlers, wire } = await setup()
    const rt = runtime()
    const silent = { stewardSay: { count: 0 }, stewardLastText: '这是我最后的输出' } as never
    handlers.commitStewardFallback(rt, 's', silent, { state: 'final', runId: 'run-1' })
    const talked = { stewardSay: { count: 2 }, stewardLastText: '不该出现' } as never
    handlers.commitStewardFallback(rt, 's', talked, { state: 'final', runId: 'run-2' })
    const shown = (await bodies('s')).map((message) => wire.parseStewardSayPayload(message.payload))
    expect(shown).toEqual([{ v: 1, type: 'steward_say', content: '这是我最后的输出', source: 'fallback' }])
  })

  it('always leaves an answer, including for failed and empty turns, and is idempotent per run', async () => {
    const { handlers, wire } = await setup()
    const rt = runtime()
    const active = () => ({ stewardSay: { count: 0 }, stewardLastText: '' }) as never
    handlers.commitStewardFallback(rt, 's', active(), { state: 'error', runId: 'run-1', message: '模型额度用完' })
    handlers.commitStewardFallback(rt, 's', active(), { state: 'error', runId: 'run-1', message: '模型额度用完' })
    handlers.commitStewardFallback(rt, 's', active(), { state: 'final', runId: 'run-2' })
    const shown = (await bodies('s')).map((message) => wire.parseStewardSayPayload(message.payload)?.content)
    expect(shown).toEqual(['模型额度用完', '已处理，但没有可显示的回复。'])
  })

  it('ignores non-steward sessions', async () => {
    const { handlers } = await setup()
    handlers.commitStewardFallback(runtime(), 'p', { stewardSay: { count: 0 }, stewardLastText: 'x' } as never, { state: 'final', runId: 'r' })
    expect(await bodies('p')).toEqual([])
  })
})

describe('terminal steward say', () => {
  const runtimeWith = (agents: Array<{ type: string; supportsStandardSession?: boolean }>) =>
    ({ sessions: new Map(), client: {}, getAgentSnapshot: () => agents }) as never

  it('opens one stable "来自终端" conversation and files every message there', async () => {
    const { store, handlers, wire } = await load()
    const runtime = runtimeWith([{ type: 'manager' }, { type: 'claude' }, { type: 'codex' }])
    const first = handlers.commitTerminalStewardSay(runtime, '  项目 app 的测试已经跑完  ')
    const second = handlers.commitTerminalStewardSay(runtime, '还有一个失败')
    expect(second.sessionId).toBe(first.sessionId)
    expect(first.sessionId).toBe(handlers.stewardTerminalSessionId(store.getDaemonInstallationId()))
    expect(first.sessionId).toMatch(/^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const record = store.listSessionRecords().find((item) => item.sessionId === first.sessionId)
    expect(record).toMatchObject({
      sessionScope: 'steward', nativeSessionVisibility: 'internal', agentType: 'claude',
      localReady: true, title: handlers.STEWARD_TERMINAL_TITLE,
    })
    const messages = store.readMessages(first.sessionId).reverse()
    expect(messages[0]).toMatchObject({ role: 'user', payload: handlers.STEWARD_TERMINAL_TITLE })
    expect(messages.slice(1).map((message) => wire.parseStewardSayPayload(message.payload)?.content))
      .toEqual(['项目 app 的测试已经跑完', '还有一个失败'])
    expect(store.listSessionRecords().filter((item) => item.sessionId === first.sessionId)).toHaveLength(1)
  })

  it('is ready for the server: a user-authored opening line makes the index publishable', async () => {
    const { store, handlers } = await load()
    const { sessionId } = handlers.commitTerminalStewardSay(runtimeWith([]), 'hi')
    const update = store.listPendingSessionIndexUpdates().find((item) => item.session.id === sessionId)
    expect(update?.session).toMatchObject({ sessionScope: 'steward', localReady: true, agentType: 'codex' })
    expect(update?.session.firstUserBoundary.role).toBe('user')
  })

  it('never reuses an id that already belongs to an ordinary session', async () => {
    const { store, handlers } = await load()
    store.recordSession({ sessionId: handlers.stewardTerminalSessionId(store.getDaemonInstallationId()), agentType: 'codex', workDir: root })
    expect(() => handlers.commitTerminalStewardSay(runtimeWith([]), 'hi')).toThrowError(expect.objectContaining({ code: 'steward_scope_conflict' }))
  })

  it('still rejects empty text', async () => {
    const { handlers } = await load()
    expect(() => handlers.commitTerminalStewardSay(runtimeWith([]), '  ')).toThrowError(expect.objectContaining({ code: 'steward_say_empty' }))
  })
})

describe('steward turn prompt', () => {
  it('states the two rules that decide whether the user sees anything', async () => {
    const { steward } = await load()
    expect(steward.STEWARD_SYSTEM_PROMPT).toContain('shennian steward say')
    expect(steward.STEWARD_SYSTEM_PROMPT).toContain('shennian project task create')
    expect(steward.STEWARD_SYSTEM_PROMPT).toContain('简单工作直接做')
    expect(steward.STEWARD_SYSTEM_PROMPT).toContain('AGENTS.md')
    expect(steward.STEWARD_SYSTEM_PROMPT).toContain('shennian guide local-apps')
    expect(steward.STEWARD_SYSTEM_PROMPT).toContain('不把全部文档塞进上下文')
  })
})

it('surfaces failure after an opening say, ignores stale last text and deduplicates terminal replay', async () => {
  const { store, workspace, handlers, wire } = await load()
  store.recordSession({ sessionId: 's', agentType: 'shennian', workDir: workspace.ensureStewardWorkspace().dir, sessionScope: 'steward' })
  const active = { currentRunId: 'quota-run', stewardSay: { count: 0 }, stewardLastText: '收到，我去写日记' }
  const rt = { sessions: new Map([['s', active]]), client: {} } as never
  handlers.commitStewardSay(rt, 's', '收到，我去写日记')
  const error = { state: 'error', runId: 'quota-run', message: '模型额度不足，本次工作中断' }
  handlers.commitStewardFallback(rt, 's', active as never, error)
  handlers.commitStewardFallback(rt, 's', active as never, error)
  expect(store.readMessages('s').reverse().map(m => wire.parseStewardSayPayload(m.payload)?.content)).toEqual(['收到，我去写日记', error.message])
})
