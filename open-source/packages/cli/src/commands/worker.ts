// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/manager-inbox.test.ts

import fs from 'node:fs'
import type { Command } from 'commander'
import { resolveShennianPath } from '../config/index.js'

type WorkerCommandResponse = {
  ok: boolean
  error?: string
  message?: string
  nextAction?: string
  [key: string]: unknown
}

function readLocalWorkerRuntime(): { url: string; token: string } {
  const runtimePath = resolveShennianPath('runtime', 'manager-ipc.json')
  let stat: fs.Stats
  try {
    stat = fs.statSync(runtimePath)
  } catch {
    throw new Error('daemon_unavailable')
  }
  if (process.platform !== 'win32') {
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : stat.uid
    if (stat.uid !== currentUid || (stat.mode & 0o077) !== 0) {
      throw new Error('worker_runtime_permissions_invalid')
    }
  }
  const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as Record<string, unknown>
  const url = typeof parsed.url === 'string' ? parsed.url : ''
  const token = typeof parsed.token === 'string' ? parsed.token : ''
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url) || !token) throw new Error('daemon_unavailable')
  return { url, token }
}

function nextActionForLocalError(code: string): string {
  if (code === 'daemon_unavailable') {
    return 'Check shennian status --json and start the existing paired daemon if it was not intentionally paused.'
  }
  if (code === 'worker_runtime_permissions_invalid') {
    return 'Repair or update the existing Shennian installation; do not bypass the local runtime file permissions.'
  }
  return 'Check the local Shennian daemon and retry the same command once.'
}

export async function executeWorkerCommand(
  operation: 'start' | 'read' | 'send' | 'wait' | 'stop' | 'report' | 'list',
  body: Record<string, unknown>,
): Promise<WorkerCommandResponse> {
  try {
    const runtime = readLocalWorkerRuntime()
    const timeoutMs = operation === 'wait'
      ? Math.max(2_000, Math.min(Number(body.timeoutMs || 600_000) + 5_000, 605_000))
      : operation === 'start' || operation === 'send'
        ? 180_000
        : 15_000
    const response = await fetch(`${runtime.url}/workers/${operation}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${runtime.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await response.json().catch(() => ({
      ok: false,
      error: 'worker_invalid_response',
      message: response.statusText,
    })) as WorkerCommandResponse
    if (response.ok && data.ok) return data
    return {
      ok: false,
      error: data.error || 'worker_command_failed',
      ...(data.message ? { message: data.message } : {}),
      nextAction: data.nextAction || 'Check the selected Agent, working directory, account, and Worker reference.',
    }
  } catch (error) {
    const code = error instanceof Error && error.message === 'daemon_unavailable'
      ? error.message
      : error instanceof Error && error.message === 'worker_runtime_permissions_invalid'
        ? error.message
        : error instanceof Error && error.name === 'TimeoutError'
          ? 'ipc_timeout'
          : 'worker_command_failed'
    return {
      ok: false,
      error: code,
      message: error instanceof Error ? error.message : String(error),
      nextAction: nextActionForLocalError(code),
    }
  }
}

function readMessage(options: { message?: string; messageFile?: string }): string {
  if (options.messageFile) return fs.readFileSync(options.messageFile, 'utf8')
  return options.message ?? ''
}

function printResult(result: WorkerCommandResponse): void {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.ok) process.exitCode = 1
}

export function registerWorkerCommand(program: Command): void {
  const worker = program.command('worker').description('Start and control an external temporary Worker by opaque reference')

  worker.command('start')
    .description('Start a new Worker; returns the only reference that can control it')
    .option('--agent <agent>', 'Agent type in the daemon snapshot, for example claude')
    .option('--request-id <id>', 'Stable personal delegation ID; reuse on retries')
    .option('--workdir <path>', 'Task/project directory; otherwise personal Worker start directory, or current directory outside steward')
    .option('--title <title>', 'Short Worker title')
    .option('--model <model>', 'Optional model id from the daemon snapshot; otherwise use the Agent default')
    .option('--message <text>', 'Worker task')
    .option('--message-file <path>', 'Read the Worker task from a file')
    .option('--json', 'Print JSON (default)')
    .action(async (options: {
      agent?: string
      requestId?: string
      workdir?: string
      title?: string
      model?: string
      message?: string
      messageFile?: string
    }) => printResult(await executeWorkerCommand('start', {
      agentType: options.agent,
      requestId: options.requestId,
      stewardSessionId: process.env.SHENNIAN_MANAGED_ROOM_CONTEXT ? undefined : process.env.SHENNIAN_STEWARD_SESSION_ID,
      workDir: options.workdir ?? (process.env.SHENNIAN_STEWARD_SESSION_ID && !process.env.SHENNIAN_MANAGED_ROOM_CONTEXT ? undefined : process.cwd()),
      title: options.title,
      modelId: options.model,
      message: readMessage(options),
    })))

  worker.command('list')
    .description('Recover Worker references for the current personal steward only')
    .action(async () => printResult(await executeWorkerCommand('list', { stewardSessionId: process.env.SHENNIAN_MANAGED_ROOM_CONTEXT ? undefined : process.env.SHENNIAN_STEWARD_SESSION_ID })))

  worker.command('report')
    .description('Report meaningful progress or a blocker to the personal steward')
    .requiredOption('--worker-id <id>', 'Worker ID supplied in the delegated task')
    .requiredOption('--message <text>', 'Progress or blocker, at most 8000 characters')
    .action(async (options: { workerId: string; message: string }) => printResult(await executeWorkerCommand('report', options)))

  worker.command('read')
    .description('Read a Worker transcript using the reference returned by worker start')
    .requiredOption('--ref <worker-ref>', 'Opaque Worker reference')
    .option('--limit <n>', 'Message limit', '200')
    .option('--json', 'Print JSON (default)')
    .action(async (options: { ref: string; limit: string }) => printResult(
      await executeWorkerCommand('read', { workerRef: options.ref, limit: Number(options.limit) }),
    ))

  worker.command('send')
    .description('Queue another message for a Worker')
    .requiredOption('--ref <worker-ref>', 'Opaque Worker reference')
    .option('--message <text>', 'Message text')
    .option('--message-file <path>', 'Read the message from a file')
    .option('--json', 'Print JSON (default)')
    .action(async (options: { ref: string; message?: string; messageFile?: string }) => printResult(
      await executeWorkerCommand('send', { workerRef: options.ref, message: readMessage(options) }),
    ))

  worker.command('wait')
    .description('Wait once for Worker progress or a terminal event')
    .requiredOption('--ref <worker-ref>', 'Opaque Worker reference')
    .option('--timeout <seconds>', 'Maximum wait in seconds (1-600)', '600')
    .option('--json', 'Print JSON (default)')
    .action(async (options: { ref: string; timeout: string }) => {
      const seconds = Math.max(1, Math.min(Number(options.timeout) || 600, 600))
      printResult(await executeWorkerCommand('wait', {
        workerRef: options.ref,
        timeoutMs: seconds * 1_000,
      }))
    })

  worker.command('stop')
    .description('Stop a Worker using its opaque reference')
    .requiredOption('--ref <worker-ref>', 'Opaque Worker reference')
    .option('--json', 'Print JSON (default)')
    .action(async (options: { ref: string }) => printResult(
      await executeWorkerCommand('stop', { workerRef: options.ref }),
    ))
}
