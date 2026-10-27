// @covers src/steward/failover.ts
// @covers src/session/handlers/steward.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../session/index-publisher.js', () => ({ requestSessionIndexPublish: vi.fn() }))

let root: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-steward-failover-')))
  vi.stubEnv('SHENNIAN_HOME', path.join(root, '.shennian'))
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(root, { recursive: true, force: true })
})

const agents = (...specs: Array<[string, Record<string, unknown>?]>) =>
  specs.map(([type, extra]) => ({ type, models: [], supportsStandardSession: true, ...extra })) as never

describe('failure classification and target choice', () => {
  it('names the reason and picks the next usable tool in discovery order', async () => {
    const f = await import('../steward/failover.js')
    expect(f.classifyStewardFailure('spawn codex ENOENT')).toBe('not_installed')
    expect(f.classifyStewardFailure('Please log in first')).toBe('not_logged_in')
    expect(f.classifyStewardFailure('usage limit exceeded')).toBe('quota')
    expect(f.classifyStewardFailure('process exited with code 1')).toBe('crashed')
    const list = agents(['codex'], ['claude', { authState: 'required' }], ['manager'], ['opencode'], ['acp:x', { supportsStandardSession: false }])
    expect(f.pickFailoverAgent(list, ['codex'])).toBe('opencode')
    expect(f.pickFailoverAgent(list, ['codex', 'opencode'])).toBeNull()
  })
})

describe('tryStewardFailover', () => {
  async function setup() {
    const store = await import('../session/store.js')
    const steward = await import('../steward/session.js')
    const failover = await import('../steward/failover.js')
    const handlers = await import('../session/handlers/steward.js')
    const dir = steward.pinStewardWorkDir()
    store.recordSession({ sessionId: 'old', agentType: 'codex', workDir: dir, sessionScope: 'steward' })
    const enqueue = vi.fn(async (_req: unknown) => true)
    const runtime = {
      sessions: new Map(), client: {}, chatQueue: { handleEnqueue: enqueue },
      getAgentSnapshot: () => agents(['codex'], ['claude']),
    } as never
    return { store, failover, handlers, runtime, enqueue }
  }
  const failed = { state: 'error', runId: 'r1', message: 'Please log in' }

  it('continues the same message in a new steward session on the next tool, with a notice and handover', async () => {
    const { store, failover, handlers, runtime, enqueue } = await setup()
    failover.rememberStewardTurn('old', '帮我看看项目')
    expect(await handlers.tryStewardFailover(runtime, 'old', { agentType: 'codex' }, failed)).toBe(true)
    const params = (enqueue.mock.calls[0]![0] as { params: Record<string, unknown> }).params
    expect(params).toMatchObject({ text: '帮我看看项目', agentType: 'claude', sessionScope: 'steward', sessionMode: 'standard' })
    const newId = String(params.sessionId)
    expect(store.listSessionRecords().find((r) => r.sessionId === newId)).toMatchObject({ sessionScope: 'steward', agentType: 'claude' })
    expect(JSON.stringify(store.readMessages(newId))).toContain('已自动切换到 Claude Code')
    expect(failover.takeStewardHandover(newId)).toContain('先核对现状')
    expect(failover.takeStewardHandover(newId)).toBe('')
    // The session that was switched away from stays quiet: no failure notice of its own.
    handlers.commitStewardFallback(runtime, 'old', { agentType: 'codex' } as never, { state: 'final', runId: 'r1' })
    expect(JSON.stringify(store.readMessages('old'))).not.toContain('steward-fallback')
    // The chain remembers Codex already failed: no switching back and forth.
    expect(failover.stewardTriedAgents(newId, 'claude')).toEqual(['codex', 'claude'])
  })

  it('does nothing when already answered, stopped by the user, not an error, or nothing is left', async () => {
    const { failover, handlers, runtime, enqueue } = await setup()
    failover.rememberStewardTurn('old', 'x')
    expect(await handlers.tryStewardFailover(runtime, 'old', { agentType: 'codex', stewardSay: { count: 1 } }, failed)).toBe(false)
    expect(await handlers.tryStewardFailover(runtime, 'old', { agentType: 'codex' }, { ...failed, state: 'aborted' })).toBe(false)
    expect(await handlers.tryStewardFailover(runtime, 'old', { agentType: 'codex' }, { ...failed, state: 'final' })).toBe(false)
    const only = { ...(runtime as object), getAgentSnapshot: () => agents(['codex']) } as never
    expect(await handlers.tryStewardFailover(only, 'old', { agentType: 'codex' }, failed)).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('fallback after a daemon restart', () => {
  it('stays silent when the transcript already shows a say for this turn', async () => {
    const store = await import('../session/store.js')
    const steward = await import('../steward/session.js')
    const handlers = await import('../session/handlers/steward.js')
    store.recordSession({ sessionId: 's', agentType: 'codex', workDir: steward.pinStewardWorkDir(), sessionScope: 'steward' })
    store.appendMessage('s', { id: 'u1', sessionId: 's', role: 'user', ts: Date.now() - 5000, payload: '问题' })
    const runtime = { sessions: new Map(), client: {} } as never
    handlers.commitStewardSay(runtime, 's', '已回答')
    // A recovered run has lost its in-memory say count.
    handlers.commitStewardFallback(runtime, 's', { agentType: 'codex' } as never, { state: 'final', runId: 'r' })
    expect(JSON.stringify(store.readMessages('s'))).not.toContain('steward-fallback')
  })
})
