// @covers src/session/queue-diagnostics.ts
// @covers src/commands/queue.ts

import { Command } from 'commander'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildQueueDiagnostics } from '../session/queue-diagnostics.js'

const NOW = Date.parse('2026-09-20T09:00:00.000Z')
const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1', sessionId: 'session-1', text: 'SECRET BODY', agentType: 'codex', modelId: 'gpt-5.6-terra',
  workDir: '/definitely/not/here', createdAt: '2026-09-20T08:55:00.000Z', trigger: { kind: 'personal' }, ...overrides,
})
const queueOf = (...messages: Array<ReturnType<typeof message>>) => ({ sessions: { 'session-1': messages } }) as never

describe('queue diagnostics', () => {
  it('explains a message stuck on a missing directory and what to do', () => {
    const result = buildQueueDiagnostics(queueOf(message({
      dispatchBlock: { code: 'agent_workdir_not_found', retryAt: NOW + 42_000, attempts: 3, notice: true },
    })), NOW, () => 'agent_workdir_not_found')
    expect(result.pendingCount).toBe(1)
    expect(result.sessions[0]!.pending[0]).toMatchObject({
      messageId: 'user-1', ageSeconds: 300, delivery: 'blocked', workDirStatus: 'not_found',
      block: { code: 'agent_workdir_not_found', attempts: 3, retryInSeconds: 42 },
    })
    expect(result.sessions[0]!.pending[0]!.block!.whatToDo).toContain('/definitely/not/here')
  })

  it('distinguishes waiting, retrying and handed-to-Codex-Desktop', () => {
    const result = buildQueueDiagnostics(queueOf(
      message({ id: 'a' }),
      message({ id: 'b', dispatchBlock: { code: 'transient_dispatch_failed', retryAt: 0, attempts: 2 } }),
      message({ id: 'c', externalQueuedSubmissionId: 'sub-1' }),
    ), NOW, () => null)
    expect(result.sessions[0]!.pending.map((item) => item.delivery)).toEqual(['waiting', 'retrying', 'handed_to_codex_desktop'])
    expect(result.sessions[0]!.pending[1]!.block).toEqual({ code: 'transient_dispatch_failed', attempts: 2 })
    expect(result.sessions[0]!.pending.every((item) => item.workDirStatus === 'ok')).toBe(true)
  })

  it('never exposes message text or attachments', () => {
    const json = JSON.stringify(buildQueueDiagnostics(queueOf(message({ attachments: [{ name: 'passport.png' }] })), NOW, () => null))
    expect(json).not.toContain('SECRET BODY')
    expect(json).not.toContain('passport')
  })

  it('reports an empty queue', () => {
    expect(buildQueueDiagnostics({ sessions: {} }, NOW)).toEqual({ pendingCount: 0, sessions: [] })
    expect(buildQueueDiagnostics({ sessions: { 'session-1': [] } }, NOW)).toEqual({ pendingCount: 0, sessions: [] })
  })
})

describe('shennian queue status', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-queue-status-'))
    vi.stubEnv('SHENNIAN_HOME', home)
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('prints machine-readable JSON with the real on-disk queue', async () => {
    const { writeQueue } = await import('../session/queue-storage.js')
    writeQueue(queueOf(message({ workDir: home })))
    const { registerQueueCommand } = await import('../commands/queue.js')
    const out = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = new Command(); registerQueueCommand(program)
    await program.parseAsync(['node', 'shennian', 'queue', 'status'])
    const parsed = JSON.parse(out.mock.calls[0]![0] as string)
    expect(parsed).toMatchObject({ ok: true, command: 'queue.status', result: { pendingCount: 1 } })
    expect(parsed.result.sessions[0].pending[0]).toMatchObject({ workDirStatus: 'ok', delivery: 'waiting' })
    expect(JSON.stringify(parsed)).not.toContain('SECRET BODY')
  })
})
