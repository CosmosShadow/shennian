// @covers src/commands/support.ts
// @covers src/support/support-client.ts

import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSupportCommand } from '../commands/support.js'
import { SupportClient, SupportClientError } from '../support/support-client.js'

function harness() {
  let output = ''
  let failures = 0
  const client = { status: vi.fn(), ask: vi.fn(), read: vi.fn() }
  const program = new Command().exitOverride()
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} })
  registerSupportCommand(program, {
    client: client as unknown as SupportClient,
    io: {
      write: (text) => { output += text },
      fail: () => { failures += 1 },
    },
  })
  return { program, client, result: () => ({ output, failures }) }
}

describe('support CLI', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports status without joining or sending', async () => {
    const test = harness()
    test.client.status.mockResolvedValue({ joined: false, room: { name: '神念官方交流群 1 群' } })
    await test.program.parseAsync(['support', 'status'], { from: 'user' })
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true,
      command: 'support.status',
      result: { joined: false },
    })
    expect(test.client.ask).not.toHaveBeenCalled()
  })

  it('trims and sends a short redacted question', async () => {
    const test = harness()
    test.client.ask.mockResolvedValue({ outcome: 'sent', joinedRoom: true })
    await test.program.parseAsync(
      ['support', 'ask', '--text', '  登录后一直提示需要重新配对  '],
      { from: 'user' },
    )
    expect(test.client.ask).toHaveBeenCalledWith('登录后一直提示需要重新配对')
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: true, command: 'support.ask' })
  })

  it.each([
    'Bearer sk-abcdefghijklmnop',
    'error at /Users/alice/project/index.ts:42',
    'read .env.production please',
  ])('rejects obvious sensitive text locally: %s', async (text) => {
    const test = harness()
    await test.program.parseAsync(['support', 'ask', '--text', text], { from: 'user' })
    expect(test.client.ask).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: false,
      error: 'support_text_contains_sensitive_data',
      nextAction: { type: 'ask_user' },
    })
  })

  it('validates read cursors and forwards a valid request', async () => {
    const invalid = harness()
    await invalid.program.parseAsync(
      ['support', 'read', '--before', '9', '--after', '10'],
      { from: 'user' },
    )
    expect(JSON.parse(invalid.result().output).error).toBe('ambiguous_sequence_cursor')

    const valid = harness()
    valid.client.read.mockResolvedValue({ messages: [] })
    await valid.program.parseAsync(['support', 'read', '--after', '10', '--limit', '20'], {
      from: 'user',
    })
    expect(valid.client.read).toHaveBeenCalledWith({ before: undefined, after: '10', limit: 20 })
  })

  it('turns a not-joined read response into a concrete next command', async () => {
    const test = harness()
    test.client.read.mockRejectedValue(
      new SupportClientError('support_room_not_joined', 'Contact support first.'),
    )
    await test.program.parseAsync(['support', 'read'], { from: 'user' })
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: false,
      error: 'support_room_not_joined',
      nextAction: { type: 'run_command' },
    })
  })

  it('waits for replies after the sent message sequence without sending again', async () => {
    const test = harness()
    test.client.read.mockResolvedValue({ messages: [{ sequence: '8', text: '请继续' }] })
    await test.program.parseAsync(['support', 'wait', '--after', '7', '--timeout', '5'], { from: 'user' })
    expect(test.client.read).toHaveBeenCalledWith({ after: '7', limit: 50 })
    expect(test.client.ask).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true, command: 'support.wait', result: { timedOut: false, messages: [{ sequence: '8' }] },
    })
  })
})
