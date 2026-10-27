// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-reminder-command.test.ts
import type { Command } from 'commander'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { resolveManagedRoomIpcPaths } from '../daemon-ipc/paths.js'
export function registerReminderCommand(program: Command) {
  program
    .command('reminder')
    .description('Manage phone calendar items through your personal Agent')
    .requiredOption('--operation <operation>', 'list/preview/create/update/complete/restore/delete')
    .option('--id <id>', 'Stable item ID; reuse for create retries')
    .option('--revision <revision>', 'Revision from list, required for mutations')
    .option('--text <text>', 'Natural language to preview')
    .option('--content <content>')
    .option(
      '--when <when>',
      'Optional reminder time/rule; omit for an unscheduled memo (also clears time on update)',
    )
    .option('--timezone <timezone>')
    .option('--before <key>', 'Pagination cursor from list')
    .action(async (flags) => {
      try {
        const context = process.env.SHENNIAN_SCHEDULE_CONTEXT
        if (!context) throw new Error('reminder_context_required')
        const result = await callDaemonIpc({
          method: 'reminder.personal',
          paths: resolveManagedRoomIpcPaths(),
          params: {
            ...flags,
            revision: flags.revision ? Number(flags.revision) : undefined,
            context,
          },
          timeoutMs: 30000,
        })
        process.stdout.write(`${JSON.stringify(result)}\n`)
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'reminders_unavailable')
        process.exitCode = 1
      }
    })
}
