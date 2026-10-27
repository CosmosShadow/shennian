// @covers src/commands/steward.ts

import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import { registerStewardCommand } from '../commands/steward.js'
import { STEWARD_SESSION_ID_ENV } from '../steward/session.js'

function harness(options: { env?: NodeJS.ProcessEnv; callDaemon?: ReturnType<typeof vi.fn>; stdin?: string } = {}) {
  let output = ''
  let failures = 0
  const callDaemon = options.callDaemon ?? vi.fn(async () => ({ messageId: 'steward-say-1' }))
  const program = new Command().exitOverride()
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} })
  registerStewardCommand(program, {
    callDaemon: callDaemon as never,
    env: options.env ?? { [STEWARD_SESSION_ID_ENV]: 'sess-1' },
    readStdin: () => options.stdin ?? '',
    io: { write: (text) => { output += text }, fail: () => { failures += 1 } },
  })
  const run = async (...args: string[]) => {
    output = ''
    failures = 0
    await program.parseAsync(['node', 'shennian', 'steward', ...args])
    return { json: JSON.parse(output), failures }
  }
  return { run, callDaemon }
}

describe('shennian steward say', () => {
  it('sends the trimmed text for the steward session named by the environment', async () => {
    const { run, callDaemon } = harness()
    const { json, failures } = await run('say', '  收到，我去查  ')
    expect(json).toEqual({ ok: true, command: 'steward.say', result: { messageId: 'steward-say-1' } })
    expect(failures).toBe(0)
    expect(callDaemon).toHaveBeenCalledWith({
      method: 'steward.say', params: { sessionId: 'sess-1', text: '收到，我去查' },
    })
  })

  it('reads the message from stdin or a file so quoting never breaks it', async () => {
    const { run, callDaemon } = harness({ stdin: '来自 stdin\n' })
    await run('say', '--stdin')
    expect(callDaemon).toHaveBeenLastCalledWith({ method: 'steward.say', params: { sessionId: 'sess-1', text: '来自 stdin' } })
    const missing = await run('say', '--file', '/nonexistent/steward.txt')
    expect(missing.json).toMatchObject({ ok: false, error: 'steward_say_invalid' })
  })

  it('outside a steward session, files the message under the terminal conversation (no session id)', async () => {
    const { run, callDaemon } = harness({ env: {} })
    const { json, failures } = await run('say', 'hi')
    expect(json).toMatchObject({ ok: true, command: 'steward.say' })
    expect(failures).toBe(0)
    expect(callDaemon).toHaveBeenCalledWith({ method: 'steward.say', params: { text: 'hi' } })
  })

  it('says plainly that the daemon is not running', async () => {
    const missing = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    const { run } = harness({ env: {}, callDaemon: vi.fn(async () => { throw missing }) })
    const { json, failures } = await run('say', 'hi')
    expect(json).toMatchObject({ ok: false, error: 'daemon_unavailable', message: 'Shennian is not running on this computer.' })
    expect(failures).toBe(1)
  })

  it('requires exactly one message source and a bounded non-empty message', async () => {
    const { run, callDaemon } = harness()
    for (const args of [['say'], ['say', 'a', '--stdin'], ['say', '   '], ['say', 'x'.repeat(20_001)]]) {
      const { json, failures } = await run(...args)
      expect(json).toMatchObject({ ok: false, error: 'steward_say_invalid' })
      expect(failures).toBe(1)
    }
    expect(callDaemon).not.toHaveBeenCalled()
  })

  it('surfaces the daemon error code and hides unexpected failures', async () => {
    const known = harness({ callDaemon: vi.fn(async () => { throw new DaemonIpcError('steward_session_required', 'not steward') }) })
    expect((await known.run('say', 'hi')).json).toMatchObject({ ok: false, error: 'steward_session_required', message: 'not steward' })
    const unknown = harness({ callDaemon: vi.fn(async () => { throw new Error('secret /path') }) })
    const { json } = await unknown.run('say', 'hi')
    expect(json).toMatchObject({ ok: false, error: 'steward_command_failed' })
    expect(JSON.stringify(json)).not.toContain('secret')
  })
})

describe('steward daemon IPC handler', () => {
  it('is advertised, forwards to the session manager and rejects malformed params', async () => {
    const { createDaemonControlHandlers, DAEMON_CONTROL_CAPABILITIES } = await import('../daemon-ipc/control.js')
    const stewardSay = vi.fn(() => ({ messageId: 'steward-say-1' }))
    const handlers = createDaemonControlHandlers({
      daemonVersion: '0.0.0', protocolVersion: 1, getStatus: () => ({}) as never, getAgents: () => [], stewardSay,
    })
    expect(DAEMON_CONTROL_CAPABILITIES).toContain('steward.say')
    const context = { requestId: 'r' } as never
    expect(await handlers['steward.say']!({ sessionId: 's', text: 'hi' }, context)).toEqual({ messageId: 'steward-say-1' })
    expect(stewardSay).toHaveBeenCalledWith({ sessionId: 's', text: 'hi' })
    for (const bad of [undefined, null, 'x', ['a']]) {
      await expect(Promise.resolve().then(() => handlers['steward.say']!(bad as never, context))).rejects.toThrow('invalid_steward_say')
    }
    const unavailable = createDaemonControlHandlers({ daemonVersion: '0.0.0', protocolVersion: 1, getStatus: () => ({}) as never, getAgents: () => [] })
    await expect(Promise.resolve().then(() => unavailable['steward.say']!({}, context))).rejects.toThrow('steward_unavailable')
  })
})
