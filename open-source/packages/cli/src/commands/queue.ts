// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/queue-diagnostics.test.ts
import type { Command } from 'commander'
import { buildQueueDiagnostics } from '../session/queue-diagnostics.js'
import { readQueue } from '../session/queue-storage.js'

export function registerQueueCommand(program: Command): void {
  const queue = program.command('queue').description('Inspect messages waiting to be delivered to local AI tools')

  queue
    .command('status')
    .description('Show which messages are waiting and why (read-only, never prints message text)')
    .option('--json', 'Print JSON (default)')
    .action(() => {
      try {
        const result = buildQueueDiagnostics(readQueue())
        console.log(JSON.stringify({
          ok: true,
          command: 'queue.status',
          result: {
            ...result,
            notes: {
              delivery: 'waiting = not attempted yet; retrying = failed but retried automatically; blocked = kept until the cause (see block.whatToDo) is fixed; handed_to_codex_desktop = queued inside Codex Desktop.',
              workDirStatus: 'Anything other than ok means the message cannot be delivered until that directory is back.',
            },
          },
        }, null, 2))
      } catch (error) {
        console.log(JSON.stringify({
          ok: false,
          command: 'queue.status',
          error: 'queue_unreadable',
          message: error instanceof Error ? error.message : String(error),
          nextAction: 'Check that the current user owns the Shennian data directory and run shennian status --json. Do not delete the queue file.',
        }, null, 2))
        process.exitCode = 1
      }
    })
}
