// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-command.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import type { Command } from 'commander'
import { PublicAgentClientError } from '../agents/public-agent-client.js'
import { ProjectClient } from '../agents/project-client.js'
import { registerProjectCoordinationCommands } from './project-coordination.js'

type Io = { write: (text: string) => void; fail: () => void }
export type ProjectCommandOptions = { client?: ProjectClient; io?: Io }

const defaultIo: Io = {
  write: (text) => process.stdout.write(text),
  fail: () => { process.exitCode = 1 },
}

const ID = /^[A-Za-z0-9_.:@-]{1,191}$/
const REQUEST_ID = /^[A-Za-z0-9_.:@-]{8,128}$/
const MAX_TEXT = 20_000

export function registerProjectCommand(program: Command, options: ProjectCommandOptions = {}): void {
  const client = options.client ?? new ProjectClient()
  const io = options.io ?? defaultIo

  const project = program.command('project')
    .description('List Shennian projects and run tasks in them')
  registerProjectCoordinationCommands(project)

  project.command('create').description('Register an owned computer directory as a project; does not create or move files')
    .requiredOption('--machine <id>', 'Exact owned machine ID')
    .requiredOption('--workdir <path>', 'Absolute existing target directory')
    .option('--name <name>', 'Project display name')
    .action((flags: { machine: string; workdir: string; name?: string }) => run('project.create', io, () => client.createProject({ machineId: parseId(flags.machine, 'machine_id_invalid'), workDir: flags.workdir, ...(flags.name ? { name: flags.name } : {}) })))

  project.command('update <project-id>').description('Rename a project or change its launch defaults; does not move its directory')
    .option('--name <name>', 'Display name')
    .option('--agent <type>', 'Default Agent')
    .option('--model <id>', 'Default model; requires --agent')
    .action((id: string, flags: { name?: string; agent?: string; model?: string }) => run('project.update', io, () => { if (flags.model && !flags.agent) throw new PublicAgentClientError('agent_required', 'Changing a default model requires --agent.'); return client.updateProject(parseId(id, 'project_id_invalid'), { ...(flags.name !== undefined ? { name: flags.name } : {}), ...(flags.agent ? { agentType: flags.agent, modelId: flags.model ?? null } : {}) }) }))

  project.command('list')
    .description('List the paired user\'s projects with machine status and recent tasks')
    .action(() => run('project.list', io, () => client.listProjects()))

  const task = project.command('task')
    .description('List, create, read, message or stop tasks in an exact project')

  task.command('list <project-id>')
    .description('List recent tasks (conversations) of one exact project')
    .option('--limit <count>', 'Number of tasks (1-15)', '3')
    .action((projectId: string, flags: { limit: string }) => run('project.task.list', io, () =>
      client.listTasks(parseId(projectId, 'project_id_invalid'), parseLimit(flags.limit, 15))))

  task.command('create <project-id>')
    .description('Start a new task in one exact project; long or file-changing work belongs here')
    .option('--instruction <text>', 'Task instruction')
    .option('--instruction-file <path>', 'Read the instruction from a file')
    .option('--agent <type>', 'Exact AI type of the project machine; defaults to the project\'s usual one')
    .option('--model <id>', 'Exact model id; defaults to the project\'s usual one')
    .option('--request-id <id>', 'Stable id; reuse it when retrying so no duplicate task is created')
    .action((projectId: string, flags: {
      instruction?: string; instructionFile?: string; agent?: string; model?: string; requestId?: string
    }) => run('project.task.create', io, async () => { const result = await client.createTask(
      parseId(projectId, 'project_id_invalid'),
      {
        instruction: readText(flags.instruction, flags.instructionFile, 'instruction'),
        requestId: parseRequestId(flags.requestId),
        ...(flags.agent ? { agentType: parseId(flags.agent, 'agent_invalid') } : {}),
        ...(flags.model ? { modelId: parseId(flags.model, 'agent_invalid') } : {}),
      },
    ); const steward = process.env.SHENNIAN_MANAGED_ROOM_CONTEXT ? undefined : process.env.SHENNIAN_STEWARD_SESSION_ID;
      if (steward && typeof result.taskId === 'string') {
        try { return { ...result, tracking: await client.watchTask(result.taskId, steward) } }
        catch { return { ...result, tracking: { enabled: false, error: 'task_watch_failed', nextAction: 'Use project task watch with the same task ID; do not recreate the task.' } } }
      }
      return result
    }))

  task.command('watch <task-id>').description('Send task terminal events back to the current personal steward')
    .action((id: string) => run('project.task.watch', io, () => {
      const steward = process.env.SHENNIAN_MANAGED_ROOM_CONTEXT ? undefined : process.env.SHENNIAN_STEWARD_SESSION_ID
      if (!steward) throw new PublicAgentClientError('steward_context_required', 'Run this command inside your personal steward conversation.')
      return client.watchTask(parseId(id, 'task_id_invalid'), steward)
    }))

  task.command('read <task-id>')
    .description('Read the latest visible messages of one exact task')
    .option('--limit <count>', 'Number of messages (1-8)', '4')
    .action((taskId: string, flags: { limit: string }) => run('project.task.read', io, () =>
      client.readTask(parseId(taskId, 'task_id_invalid'), parseLimit(flags.limit, 8))))

  task.command('send <task-id>')
    .description('Send another message to one exact existing task')
    .option('--text <text>', 'Message text')
    .option('--text-file <path>', 'Read the message from a file')
    .option('--request-id <id>', 'Stable id; reuse it when retrying so the message is sent once')
    .action((taskId: string, flags: { text?: string; textFile?: string; requestId?: string }) =>
      run('project.task.send', io, () => client.sendTask(parseId(taskId, 'task_id_invalid'), {
        text: readText(flags.text, flags.textFile, 'text'),
        requestId: parseRequestId(flags.requestId),
      })))

  task.command('stop <task-id>')
    .description('Ask one exact task to stop its current run (not a durable pause)')
    .action((taskId: string) => run('project.task.stop', io, () =>
      client.stopTask(parseId(taskId, 'task_id_invalid'))))
}

async function run(command: string, io: Io, operation: () => Promise<unknown>) {
  try {
    io.write(`${JSON.stringify({ ok: true, command, result: await operation() })}\n`)
  } catch (error) {
    if (error instanceof PublicAgentClientError) {
      io.write(`${JSON.stringify({ ok: false, error: error.code, message: error.message, nextAction: error.nextAction })}\n`)
    } else {
      io.write(`${JSON.stringify({ ok: false, error: 'project_command_failed', message: 'Shennian project command failed.', nextAction: null })}\n`)
    }
    io.fail()
  }
}

function parseId(value: string, code: string): string {
  if (!ID.test(value)) throw new PublicAgentClientError(code, 'Use the exact id returned by Shennian.')
  return value
}

function parseLimit(value: string, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), max) : max
}

function parseRequestId(value: string | undefined): string {
  if (value === undefined) return `steward-${crypto.randomUUID()}`
  if (!REQUEST_ID.test(value)) {
    throw new PublicAgentClientError('request_id_invalid', 'Use 8-128 letters, digits or _.:@- for --request-id.')
  }
  return value
}

function readText(inline: string | undefined, file: string | undefined, field: string): string {
  if (inline !== undefined && file !== undefined) {
    throw new PublicAgentClientError(`${field}_invalid`, `Use either inline text or a file for ${field}, not both.`)
  }
  let text = inline
  if (file !== undefined) {
    try { text = fs.readFileSync(file, 'utf8') } catch {
      throw new PublicAgentClientError(`${field}_invalid`, `The ${field} file could not be read.`)
    }
  }
  text = text?.trim()
  if (!text || text.length > MAX_TEXT) {
    throw new PublicAgentClientError(`${field}_invalid`, `Provide non-empty ${field} of at most ${MAX_TEXT} characters.`)
  }
  return text
}
