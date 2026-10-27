// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-coordination-runtime.test.ts
import type { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import type { JsonValue } from '../daemon-ipc/json.js'
import { ProjectClient } from '../agents/project-client.js'

export function registerProjectCoordinationCommands(project: Command) {
  const call = async (params: Record<string, unknown>, method = 'project.coordination', machineId?: string) => {
    try { process.stdout.write(JSON.stringify(machineId ? await new ProjectClient().coordinate({ ...params, machineId }) : await callDaemonIpc({ method, params: params as JsonValue, timeoutMs: 30000 })) + '\n') }
    catch (e) { process.stderr.write((e instanceof Error ? e.message : 'coordination_failed') + '\n'); process.exitCode = 1 }
  }
  project.command('coordination <workdir>').description('Read or configure the local project coordinator; all tasks use the same durable queue')
    .option('--enable', 'Enable project coordination').option('--disable', 'Disable after all running work stops')
    .option('--pause', 'Pause new dispatch; current work continues').option('--resume', 'Resume dispatch')
    .option('--mode <mode>', 'serial, research_parallel, or parallel').option('--manual', 'Require manual start').option('--auto', 'Start next task automatically')
    .option('--message <text>', 'Talk to the project coordinator').option('--request-id <id>', 'Stable request ID for retries')
    .option('--machine <id>', 'Use an exact owned remote machine instead of this local daemon')
    .option('--instructions-file <path>', 'Save working instructions from a UTF-8 file').option('--expected-revision <number>', 'Required instruction revision when saving')
    .action(async (workdir: string, flags: Record<string, string | boolean>) => {
      const params: Record<string, unknown> = { workDir: path.resolve(workdir), command: 'get' }
      if (flags.message) Object.assign(params, { command: 'message', text: flags.message, requestId: flags.requestId ?? randomUUID() })
      else if (flags.instructionsFile) {
        if (flags.expectedRevision === undefined) throw new Error('coordination_revision_required')
        Object.assign(params, { command: 'instructions', text: fs.readFileSync(String(flags.instructionsFile), 'utf8'), expectedRevision: Number(flags.expectedRevision) })
      } else {
        const patch: Record<string, unknown> = {}
        if (flags.enable || flags.disable) patch.enabled = Boolean(flags.enable)
        if (flags.pause || flags.resume) patch.paused = Boolean(flags.pause)
        if (flags.mode) patch.mode = flags.mode
        if (flags.manual || flags.auto) patch.automatic = Boolean(flags.auto)
        if (Object.keys(patch).length) Object.assign(params, { command: 'configure', patch })
      }
      await call(params, 'project.coordination', typeof flags.machine === 'string' ? flags.machine : undefined)
    })
  project.command('open <workdir>').description('Print the private local browser workbench URL for this project')
    .action(async (workdir: string) => call({ workDir: path.resolve(workdir) }, 'project.workbench'))
}
