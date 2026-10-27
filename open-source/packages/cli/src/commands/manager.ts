// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/manager-inbox.test.ts

import fs from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import { MANAGED_ROOM_IPC_ROOT_ENV, resolveManagedRoomIpcPaths } from '../daemon-ipc/paths.js'
import { MANAGED_ROOM_CONTEXT_ENV } from '../room/managed-context.js'
import type { ManagedManagerAction } from '../room/managed-room-ipc.js'

type ManagerIpcResponse = { ok: boolean; error?: string; [key: string]: unknown }
type ManagerContext = { url: string; token: string; managerSessionId: string }

async function requireManagerContext(): Promise<ManagerContext> {
  const url = process.env.SHENNIAN_MANAGER_IPC_URL
  const token = process.env.SHENNIAN_MANAGER_IPC_TOKEN
  const managerSessionId = process.env.SHENNIAN_MANAGER_SESSION_ID
  if (url && token && managerSessionId) return { url, token, managerSessionId }
  throw new Error('manager_context_required: this command is only available inside a Shennian managed Manager session')
}

async function ipc(path: string, body: Record<string, unknown>): Promise<ManagerIpcResponse> {
  const managedContext = process.env[MANAGED_ROOM_CONTEXT_ENV]?.trim()
  if (managedContext) {
    const action = MANAGED_MANAGER_ROUTE_ACTIONS[path]
    if (!action) throw new Error(`Manager IPC path is unavailable in managed Room context: ${path}`)
    const ipcRoot = process.env[MANAGED_ROOM_IPC_ROOT_ENV]?.trim()
    if (!ipcRoot || !pathModuleIsAbsolute(ipcRoot)) {
      throw new DaemonIpcError('managed_room_context_unavailable', 'Managed Room IPC context is unavailable.')
    }
    return await callDaemonIpc({
      method: 'managed-room.execute',
      params: { context: managedContext, action, ...body } as never,
      paths: resolveManagedRoomIpcPaths(ipcRoot),
      timeoutMs: action === 'manager.sessions.start' || action === 'manager.sessions.send'
        ? 180_000
        : 15_000,
    }) as ManagerIpcResponse
  }
  const ctx = await requireManagerContext()
  const response = await fetch(`${ctx.url}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ctx.token}`,
      'content-type': 'application/json',
      'x-shennian-manager-session-id': ctx.managerSessionId,
    },
    body: JSON.stringify({ ...body, managerSessionId: ctx.managerSessionId }),
  })
  const data = await response.json().catch(() => ({ ok: false, error: response.statusText })) as ManagerIpcResponse
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Manager IPC failed: ${response.status}`)
  }
  return data
}

const MANAGED_MANAGER_ROUTE_ACTIONS: Record<string, ManagedManagerAction> = {
  '/sessions/list': 'manager.sessions.list',
  '/sessions/start': 'manager.sessions.start',
  '/sessions/send': 'manager.sessions.send',
  '/sessions/queue': 'manager.sessions.queue',
  '/sessions/queue/edit': 'manager.sessions.queue.edit',
  '/sessions/queue/delete': 'manager.sessions.queue.delete',
  '/sessions/stop': 'manager.sessions.stop',
  '/sessions/read': 'manager.sessions.read',
  '/memory/path': 'manager.memory.path',
}

function pathModuleIsAbsolute(value: string): boolean {
  return path.isAbsolute(value)
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

function printMarkdown(result: ManagerIpcResponse): void {
  console.log(typeof result.markdown === 'string' ? result.markdown : 'ok')
}

function readMessage(opts: { message?: string; messageFile?: string }): string {
  if (opts.messageFile) return fs.readFileSync(opts.messageFile, 'utf-8')
  return opts.message ?? ''
}

export function registerManagerCommand(program: Command): void {
  const manager = program.command('manager', { hidden: true }).description('Manager Session local tools')
  const sessions = manager.command('sessions').description('Manage same-project worker sessions')

  sessions
    .command('list')
    .description('List same-project sessions visible to this Manager')
    .option('--json', 'Print JSON')
    .action(async (opts: { json?: boolean }) => {
      const result = await ipc('/sessions/list', {})
      if (opts.json) printJson(result)
      else {
        const sessions = (result.sessions as Array<{
          sessionId: string
          agentType: string
          role?: string
          status: string
          title?: string | null
          summary?: string | null
        }>) ?? []
        for (const session of sessions) {
          console.log(`${session.sessionId}\t${session.agentType}\t${session.role ?? ''}\t${session.status}\t${session.title ?? session.summary ?? ''}`)
        }
      }
    })

  sessions
    .command('start')
    .description('Start a worker using the current Manager Agent, model, and project')
    .option('--title <title>', 'Short worker title')
    .option('--message <text>', 'Worker prompt')
    .option('--message-file <path>', 'Read worker prompt from file')
    .option('--json', 'Print JSON')
    .action(async (opts: { title?: string; message?: string; messageFile?: string; json?: boolean }) => {
      const result = await ipc('/sessions/start', {
        title: opts.title,
        message: readMessage(opts),
      })
      if (opts.json) printJson(result)
      else printMarkdown(result)
    })

  sessions
    .command('send')
    .description('Queue a message for a managed worker; runs immediately if idle')
    .requiredOption('--session-id <id>', 'Worker session id')
    .option('--message <text>', 'Message text')
    .option('--message-file <path>', 'Read message from file')
    .option('--direct', 'Deprecated compatibility flag; delivery still uses the durable queue')
    .action(async (opts: { sessionId: string; message?: string; messageFile?: string; direct?: boolean }) => {
      const result = await ipc('/sessions/send', {
        sessionId: opts.sessionId,
        message: readMessage(opts),
        enqueue: !opts.direct,
      })
      printMarkdown(result)
    })

  const queue = sessions.command('queue').description('Inspect and edit pending worker messages')
  queue
    .command('list')
    .description('List pending messages for a managed worker')
    .requiredOption('--session-id <id>', 'Worker session id')
    .option('--json', 'Print JSON')
    .action(async (opts: { sessionId: string; json?: boolean }) => {
      const result = await ipc('/sessions/queue', { sessionId: opts.sessionId })
      if (opts.json) printJson(result)
      else {
        const pending = (result.queue as { pending?: Array<{ id: string; text: string }> } | undefined)?.pending ?? []
        for (const message of pending) console.log(`${message.id}\t${message.text.replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    })

  queue
    .command('edit')
    .description('Edit a pending worker message')
    .requiredOption('--session-id <id>', 'Worker session id')
    .requiredOption('--message-id <id>', 'Queued message id')
    .option('--message <text>', 'Replacement message text')
    .option('--message-file <path>', 'Read replacement message from file')
    .action(async (opts: { sessionId: string; messageId: string; message?: string; messageFile?: string }) => {
      await ipc('/sessions/queue/edit', {
        sessionId: opts.sessionId,
        queueMessageId: opts.messageId,
        message: readMessage(opts),
      })
      console.log('ok')
    })

  queue
    .command('delete')
    .description('Delete a pending worker message')
    .requiredOption('--session-id <id>', 'Worker session id')
    .requiredOption('--message-id <id>', 'Queued message id')
    .action(async (opts: { sessionId: string; messageId: string }) => {
      await ipc('/sessions/queue/delete', {
        sessionId: opts.sessionId,
        queueMessageId: opts.messageId,
      })
      console.log('ok')
    })

  const stopWorker = async (opts: { sessionId: string }) => {
    const result = await ipc('/sessions/stop', { sessionId: opts.sessionId })
    printMarkdown(result)
  }

  sessions
    .command('stop')
    .aliases(['terminate', 'kill'])
    .description('Stop or terminate a running managed worker')
    .requiredOption('--session-id <id>', 'Worker session id')
    .action(stopWorker)

  sessions
    .command('read')
    .description('Read a managed worker transcript')
    .requiredOption('--session-id <id>', 'Worker session id')
    .option('--limit <n>', 'Message limit', '200')
    .option('--json', 'Print JSON')
    .action(async (opts: { sessionId: string; limit: string; json?: boolean }) => {
      const result = await ipc('/sessions/read', { sessionId: opts.sessionId, limit: Number(opts.limit) })
      if (opts.json) printJson(result)
      else printJson(result.messages ?? [])
    })

  sessions
    .command('wait')
    .description('Wait up to a bounded timeout for the next worker progress or terminal event')
    .requiredOption('--session-id <id>', 'Worker session id')
    .option('--timeout <seconds>', 'Maximum wait in seconds (1-600)', '600')
    .option('--json', 'Print JSON')
    .action(async (opts: { sessionId: string; timeout: string; json?: boolean }) => {
      const seconds = Math.max(1, Math.min(Number(opts.timeout) || 600, 600))
      const result = await ipc('/sessions/wait', {
        sessionId: opts.sessionId,
        timeoutMs: seconds * 1_000,
      })
      if (opts.json) printJson(result)
      else if (result.timedOut) console.log(`等待超时；Agent 当前状态：${String(result.status || 'unknown')}`)
      else printMarkdown(result)
    })

  manager
    .command('memory')
    .description('Manager project memory helpers')
    .command('path')
    .description('Print project memory directory path')
    .action(async () => {
      const result = await ipc('/memory/path', {})
      console.log(result.path)
    })

}
