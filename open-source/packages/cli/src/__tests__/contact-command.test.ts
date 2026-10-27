// @covers src/commands/contact.ts

import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerContactCommand } from '../commands/contact.js'
import { PublicRoomClient } from '../room/public-room-client.js'

function harness() {
  const listContacts = vi.fn()
  let output = ''
  let failures = 0
  const program = new Command().exitOverride()
  registerContactCommand(program, {
    client: { listContacts } as unknown as PublicRoomClient,
    io: {
      write: (text) => {
        output += text
      },
      fail: () => {
        failures += 1
      },
    },
  })
  return { program, listContacts, result: () => ({ output: JSON.parse(output), failures }) }
}

describe('contact CLI', () => {
  afterEach(() => {
    delete process.env.SHENNIAN_MANAGED_ROOM_CONTEXT
  })

  it('lists saved contacts independently of Room chats', async () => {
    const test = harness()
    test.listContacts.mockResolvedValue({
      contacts: [{ id: 'contact_1', kind: 'human', displayName: '小龙' }],
      truncated: false,
    })
    await test.program.parseAsync(['contact', 'list'], { from: 'user' })
    expect(test.listContacts).toHaveBeenCalledWith(undefined)
    expect(test.result().output).toMatchObject({
      ok: true,
      command: 'contact.list',
      result: { contacts: [{ displayName: '小龙' }] },
    })
  })

  it('passes a trimmed name query and rejects an oversized query', async () => {
    const test = harness()
    test.listContacts.mockResolvedValue({ contacts: [], truncated: false })
    await test.program.parseAsync(['contact', 'list', '--query', ' 小龙 '], { from: 'user' })
    expect(test.listContacts).toHaveBeenCalledWith('小龙')

    const rejected = harness()
    await rejected.program.parseAsync(['contact', 'list', '--query', 'x'.repeat(81)], {
      from: 'user',
    })
    expect(rejected.result().output.error).toBe('invalid_contact_query')
    expect(rejected.listContacts).not.toHaveBeenCalled()
  })

  it('does not use the paired human identity from managed Room context', async () => {
    process.env.SHENNIAN_MANAGED_ROOM_CONTEXT = 'managed-context'
    const test = harness()
    await test.program.parseAsync(['contact', 'list'], { from: 'user' })
    expect(test.result().output.error).toBe('managed_room_action_forbidden')
    expect(test.listContacts).not.toHaveBeenCalled()
  })
})
