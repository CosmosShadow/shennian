// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/conversation-schedules.test.ts
import type { Command } from 'commander'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { resolveManagedRoomIpcPaths } from '../daemon-ipc/paths.js'
export function registerScheduleCommand(program: Command) {
  program.command('schedule').description('Manage scheduled work in this conversation')
    .requiredOption('--operation <operation>', 'list/create/update/pause/resume/delete')
    .option('--id <id>').option('--version <version>').option('--operation-id <operationId>')
    .option('--execution-mode <mode>', 'main or worker; personal schedules only')
    .option('--time-description <timeDescription>').option('--timezone <timezone>').option('--prompt <prompt>')
    .action(async flags => {
      try {
        const context = process.env.SHENNIAN_SCHEDULE_CONTEXT
        if (!context) throw new Error('schedule_context_required')
        const result = await callDaemonIpc({ method: 'schedule.personal', paths: resolveManagedRoomIpcPaths(), params: {
          ...flags, version: flags.version ? Number(flags.version) : undefined, context,
        }, timeoutMs: 15000 })
        process.stdout.write(`${JSON.stringify(result)}\n`)
      } catch (error) { console.error(error instanceof Error ? error.message : 'schedules_unavailable'); process.exitCode = 1 }
    })
}
