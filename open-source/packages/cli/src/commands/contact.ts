// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/contact-command.test.ts

import type { Command } from 'commander'
import { PublicRoomClient, PublicRoomClientError } from '../room/public-room-client.js'
import { MANAGED_ROOM_CONTEXT_ENV } from '../room/managed-context.js'

type ContactCommandIo = { write: (text: string) => void; fail: () => void }

export function registerContactCommand(
  program: Command,
  options: { client?: PublicRoomClient; io?: ContactCommandIo } = {},
): void {
  const client = options.client ?? new PublicRoomClient()
  const io = options.io ?? {
    write: (text: string) => process.stdout.write(text),
    fail: () => {
      process.exitCode = 1
    },
  }
  const contact = program.command('contact').description("Read the paired user's saved contacts")
  contact
    .command('list')
    .description('List saved contacts and owned Agents; not inferred from Room chats')
    .option('--query <name>', 'Filter by display name (up to 80 characters)')
    .action(async (flags: { query?: string }) => {
      try {
        if (process.env[MANAGED_ROOM_CONTEXT_ENV]?.trim()) {
          throw new PublicRoomClientError(
            'managed_room_action_forbidden',
            'Contacts are not available in managed Room context.',
            { type: 'ask_user', message: 'A managed Agent cannot use the paired human identity.' },
          )
        }
        const query = flags.query?.trim()
        if (query && query.length > 80) {
          throw new PublicRoomClientError(
            'invalid_contact_query',
            '--query must be at most 80 characters.',
          )
        }
        const result = await client.listContacts(query)
        io.write(`${JSON.stringify({ ok: true, command: 'contact.list', result })}\n`)
      } catch (error) {
        const known =
          error instanceof PublicRoomClientError
            ? error
            : new PublicRoomClientError(
                'contact_command_failed',
                'Shennian contact command failed.',
              )
        io.write(
          `${JSON.stringify({
            ok: false,
            error: known.code,
            message: known.message,
            nextAction: known.nextAction,
          })}\n`,
        )
        io.fail()
      }
    })
}
