// @covers src/session/queue.ts
// @covers src/session/handlers/chat.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReqFrame } from '@shennian/wire'
import type { SessionManagerRuntime } from '../session/types.js'

vi.mock('../session/index-publisher.js', () => ({ requestSessionIndexPublish: vi.fn() }))

let root: string
const managers: Array<{ stop(): void }> = []

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-steward-enqueue-')))
  vi.stubEnv('SHENNIAN_HOME', path.join(root, '.shennian'))
  vi.resetModules()
})

afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop()
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(root, { recursive: true, force: true })
})

function enqueue(sessionId: string, workDir: string, extra: Record<string, unknown> = {}): ReqFrame {
  return {
    type: 'req', id: `req-${sessionId}-${Math.random()}`, method: 'chat.enqueue',
    params: { sessionId, clientMessageId: `m-${sessionId}-${Math.random()}`, text: '帮我看看项目', agentType: 'codex', workDir, ...extra },
  }
}

async function manager() {
  const { ChatQueueManager } = await import('../session/queue.js')
  const sendRes = vi.fn()
  const runtime = {
    client: { sendRes, sendEvent: vi.fn() }, sessions: new Map(), resolvePath: (value: string) => value,
  } as unknown as SessionManagerRuntime
  const dispatch = vi.fn(async (_req: ReqFrame) => ({}))
  const instance = new ChatQueueManager({
    getRuntime: () => runtime, dispatchReq: vi.fn(async () => {}), dispatchQueuedReq: dispatch,
  })
  managers.push(instance)
  return { instance, dispatch, sendRes }
}

describe('steward enqueue pinning', () => {
  it('records a new steward session in the fixed workspace and dispatches it there', async () => {
    const { ensureStewardWorkspace } = await import('../steward/workspace.js')
    const { listSessionRecords } = await import('../session/store.js')
    const dir = ensureStewardWorkspace().dir
    const { instance, dispatch } = await manager()
    await instance.handleEnqueue(enqueue('steward-a', dir, { sessionScope: 'steward' }))
    expect(listSessionRecords().find((record) => record.sessionId === 'steward-a'))
      .toMatchObject({ sessionScope: 'steward', nativeSessionVisibility: 'internal', workDir: dir })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    // Dispatch re-derives the scope from the stored record, not from a client claim.
    expect(dispatch.mock.calls[0]![0].params).not.toHaveProperty('sessionScope')
  })

  it('ignores any client directory and pins the steward to the fixed workspace', async () => {
    const { ensureStewardWorkspace } = await import('../steward/workspace.js')
    const { listSessionRecords } = await import('../session/store.js')
    const dir = ensureStewardWorkspace().dir
    const { instance, dispatch } = await manager()
    // The phone only knows a placeholder; a forged path must not move the steward either.
    await instance.handleEnqueue(enqueue('steward-c', '~/.shennian-steward', { sessionScope: 'steward' }))
    await instance.handleEnqueue(enqueue('steward-d', root, { sessionScope: 'steward' }))
    const records = listSessionRecords()
    expect(records.find((record) => record.sessionId === 'steward-c')).toMatchObject({ sessionScope: 'steward', workDir: dir })
    expect(records.find((record) => record.sessionId === 'steward-d')).toMatchObject({ sessionScope: 'steward', workDir: dir })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    for (const [request] of dispatch.mock.calls) expect(request.params).toMatchObject({ workDir: dir })
  })

  it('remembers the scope for later turns even when the client omits it', async () => {
    const { ensureStewardWorkspace } = await import('../steward/workspace.js')
    const { isStewardSessionId } = await import('../steward/session.js')
    const { listSessionRecords } = await import('../session/store.js')
    const dir = ensureStewardWorkspace().dir
    const { instance } = await manager()
    await instance.handleEnqueue(enqueue('steward-b', dir, { sessionScope: 'steward' }))
    await instance.handleEnqueue(enqueue('steward-b', root))
    expect(isStewardSessionId('steward-b')).toBe(true)
    expect(listSessionRecords().find((record) => record.sessionId === 'steward-b')?.workDir).toBe(dir)
  })

  it('refuses to turn an existing personal session into a steward session', async () => {
    const { ensureStewardWorkspace } = await import('../steward/workspace.js')
    const dir = ensureStewardWorkspace().dir
    const { instance } = await manager()
    await instance.handleEnqueue(enqueue('plain-1', root))
    await expect(instance.handleEnqueue(enqueue('plain-1', dir, { sessionScope: 'steward' })))
      .rejects.toThrow('steward_scope_conflict')
  })

  it('keeps ordinary sessions untouched', async () => {
    const { listSessionRecords } = await import('../session/store.js')
    const { instance } = await manager()
    await instance.handleEnqueue(enqueue('plain-2', root))
    expect(listSessionRecords().find((record) => record.sessionId === 'plain-2'))
      .toMatchObject({ sessionScope: 'personal', nativeSessionVisibility: 'user' })
  })
})
