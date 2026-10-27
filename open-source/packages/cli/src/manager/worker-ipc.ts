import { getStewardDir } from '../steward/workspace.js'
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/manager-inbox.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  extractPayloadText,
  isAvailableAgentType,
  isAgentHiddenPayload,
  isToolPayload,
  type AgentInfo,
  type AgentType,
  type Envelope,
  type ReqFrame,
} from '@shennian/wire'
import { loadConfig } from '../config/index.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'
import { isStewardSessionId } from '../steward/session.js'
import { readWorkerSettings } from '../steward/worker-settings.js'
import { readMessages, recordSession } from '../session/store.js'
import type { SessionManagerRuntime } from '../session/types.js'
import {
  ManagerRegistry,
  type EphemeralWorkerAction,
  type ManagedWorkerRoomOrigin,
  type ManagerInboxEvent,
} from './registry.js'
import {
  deriveWorkerTitle,
  formatWorkerMarkdown,
  normalizeWorkerTitle,
  type WorkerMarkdownKind,
} from './worker-markdown.js'
import type { LocalReqDispatcher } from './runtime.js'

export type WorkerIpcResponse = { status: number; body: Record<string, unknown> }

type WorkerIpcHost = {
  reportWorkerProgress?: (workerId: string, message: string) => void
  registry: ManagerRegistry
  getRuntime: () => SessionManagerRuntime
  getAgentSnapshot?: () => AgentInfo[]
  dispatchReq: LocalReqDispatcher
  dispatchChatEnqueue: (
    sessionId: string,
    agentType: AgentType,
    workDir: string,
    text: string,
    agentSessionId: string | null,
    modelId?: string,
    managedWorkerParentSessionId?: string,
    roomOrigin?: ManagedWorkerRoomOrigin,
  ) => Promise<void>
  appendManagerVisibleMarkdown: (managerSessionId: string, markdown: string, id: string) => void
}

export class EphemeralWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly nextAction: string,
    public readonly status = 400,
  ) {
    super(message)
  }
}

function normalizeWorkDir(workDir: string): string {
  return path.resolve(workDir || process.cwd())
}

function resolveExternalWorkDir(workDir: string): string {
  const resolved = normalizeWorkDir(workDir)
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    throw new EphemeralWorkerError(
      'worker_workdir_invalid',
      'The Worker working directory does not exist.',
      'Choose an existing local project directory and retry worker start.',
    )
  }
  if (!stat.isDirectory()) {
    throw new EphemeralWorkerError(
      'worker_workdir_invalid',
      'The Worker working directory is not a directory.',
      'Choose an existing local project directory and retry worker start.',
    )
  }
  const canonical = fs.realpathSync.native(resolved)
  try {
    fs.accessSync(canonical, fs.constants.R_OK | fs.constants.X_OK)
  } catch {
    throw new EphemeralWorkerError(
      'worker_workdir_inaccessible',
      'The Worker working directory is not readable and searchable by this user.',
      'Choose a project directory this Shennian daemon user can access and retry worker start.',
    )
  }
  return canonical
}

function isManagerWorkerAgentType(agentType: AgentType): boolean {
  return isAvailableAgentType(agentType)
    && agentType !== 'manager'
    && agentType !== 'pi'
    && agentType !== 'openclaw'
}

function managerInboxKind(kind: ManagerInboxEvent['kind']): WorkerMarkdownKind {
  if (kind === 'worker.final') return 'completed'
  if (kind === 'worker.error') return 'failed'
  if (kind === 'worker.aborted') return 'stopped'
  return 'progress'
}

export function compactWorkerTranscript(rawMessages: Envelope[], limit: number): Envelope[] {
  const selected: Envelope[] = []
  for (const message of rawMessages) {
    if (isAgentHiddenPayload(message.payload)) continue
    if (isToolPayload(message.payload)) {
      let name = 'tool'
      let status = 'completed'
      try {
        const parsed = JSON.parse(message.payload) as { name?: string; status?: string }
        name = parsed.name || name
        status = parsed.status || status
      } catch {}
      selected.push({ ...message, payload: `[工具] ${name} · ${status}` })
    } else {
      selected.push({ ...message, payload: extractPayloadText(message.payload) })
    }
  }
  return selected.slice(0, Math.max(1, Math.min(limit, 500))).reverse()
}

export async function handleWorkerIpcRoute(
  host: WorkerIpcHost,
  pathname: string,
  body: Record<string, unknown>,
  headerManagerSessionId: string,
  trustedOrigin?: { roomOrigin?: ManagedWorkerRoomOrigin },
): Promise<WorkerIpcResponse | null> {
  if (!pathname.startsWith('/sessions/') && pathname !== '/memory/path') return null
  const managerSessionId = String(body.managerSessionId || headerManagerSessionId || '')
  if (!managerSessionId) throw new Error('managerSessionId is required')
  const manager = host.registry.getManager(managerSessionId)
  if (!manager) throw new Error('Manager runtime is not registered')

  if (pathname === '/sessions/list') {
    const runningSessionIds = new Set(
      [...host.getRuntime().sessions.entries()]
        .filter(([, session]) => Boolean(session.currentRunId))
        .map(([sessionId]) => sessionId),
    )
    const sessions = host.registry.listWorkers(managerSessionId, { runningSessionIds })
    return { status: 200, body: {
      ok: true,
      sessions,
    } }
  }
  if (pathname === '/memory/path') {
    return { status: 200, body: { ok: true, path: path.join(manager.workDir, '.shennian') } }
  }
  if (pathname === '/sessions/start') {
    const externalController = manager.controllerKind === 'ephemeral'
    const agentType = (externalController
      ? String(body.agentType || body.agent || '')
      : manager.defaultWorkerAgentType || manager.agentType || manager.modelId) as AgentType
    if (!isManagerWorkerAgentType(agentType)) throw new Error(`Unsupported manager worker agent: ${agentType}`)
    const workDir = externalController
      ? normalizeWorkDir(String(body.workDir || manager.workDir))
      : manager.workDir
    if (workDir !== manager.workDir) throw new Error('Manager can only start workers in the same workDir')
    const message = String(body.message || '')
    if (!message) throw new Error('message is required')
    const title = body.title ? normalizeWorkerTitle(String(body.title)) : deriveWorkerTitle(message)
    const worker = host.registry.addWorker({
      managerSessionId,
      agentType,
      workDir,
      title,
      userGoal: message,
      summary: message.slice(0, 120),
    })
    const workerModelId = externalController
      ? String(body.modelId || '')
      : manager.defaultWorkerModelId ?? manager.providerModelId ?? ''
    recordSession({
      sessionId: worker.sessionId,
      agentType,
      workDir,
      agentSessionId: null,
      modelId: workerModelId || null,
      title,
      titleSource: 'shennian_generated',
    })
    await host.dispatchChatEnqueue(
      worker.sessionId, agentType, workDir, manager.stewardSessionId
        ? `${message}\n\n${manager.notificationMode === 'direct' ? '本任务的 worker report 会直接通知用户并标明本 Worker 来源，无需主 Agent 转述。只报告重要进展、失败或需要用户处理的问题；完成时在最终回复提供简短结果与可点击的日记链接，Client 会自动通知，不要用 report 重复发送最终结果。日记写入后用 [查看日记](shennian://diary/YYYY-MM-DD)，替换成实际日期；不要让手机用户复制电脑路径。' : ''}这是个人管家委派的后台任务。遵守此工作目录规则与原委托范围；不要创建新权限或自行发布。重要进展或需要用户决策时，可运行 shennian worker report --worker-id ${worker.sessionId} --message <进展或阻塞说明>；通知仅限本任务绑定的本人对话，不向群聊发送；非直接通知任务由管家转述。最终提供结果、验证证据、限制及下一步。`
        : message, null, workerModelId || undefined, managerSessionId,
      trustedOrigin?.roomOrigin,
    )
    const markdown = formatWorkerMarkdown({ kind: 'created', sessionId: worker.sessionId, title, body: message })
    host.appendManagerVisibleMarkdown(managerSessionId, markdown, `worker-created:${worker.sessionId}`)
    return { status: 200, body: { ok: true, session: worker, markdown } }
  }

  const sessionId = String(body.sessionId || '')
  const worker = host.registry.getWorkerForManager(managerSessionId, sessionId)
  if (!worker || worker.role !== 'managed_worker' || worker.managedBy !== managerSessionId) {
    throw new Error('Worker not found in this manager scope')
  }

  if (pathname === '/sessions/send') {
    const message = String(body.message || '')
    if (!message.trim()) throw new Error('message is required')
    const enqueue = body.enqueue === undefined ? true : Boolean(body.enqueue)
    const activeRun = host.getRuntime().sessions.get(sessionId)?.currentRunId
    const priorCode = activeRun
      ? 'worker_busy'
      : worker.status === 'final' || worker.status === 'error' || worker.status === 'aborted'
        ? 'worker_terminal'
        : undefined
    const workerModelId = String(body.modelId || (
      worker.agentType === manager.defaultWorkerAgentType ? manager.defaultWorkerModelId ?? '' : ''
    ))
    await host.dispatchChatEnqueue(
      worker.sessionId, worker.agentType, worker.workDir, message,
      worker.agentSessionId ?? null, workerModelId || undefined, managerSessionId,
      trustedOrigin?.roomOrigin,
    )
    const markdown = formatWorkerMarkdown({
      kind: 'message', sessionId, title: worker.title || deriveWorkerTitle(worker.userGoal || worker.summary || message), body: message,
    })
    host.appendManagerVisibleMarkdown(managerSessionId, markdown, `worker-message:${randomUUID()}`)
    return { status: 200, body: {
      ok: true,
      markdown,
      queued: true,
      directRequested: !enqueue,
      ...(priorCode ? { code: priorCode } : {}),
    } }
  }
  if (pathname === '/sessions/queue') {
    return { status: 200, body: { ok: true, queue: host.getRuntime().chatQueue?.getSnapshot(sessionId) } }
  }
  if (pathname === '/sessions/queue/edit' || pathname === '/sessions/queue/delete') {
    const editing = pathname.endsWith('/edit')
    await host.dispatchReq({
      type: 'req', id: `manager-queue-${editing ? 'edit' : 'delete'}-${randomUUID()}`,
      method: editing ? 'chat.queue.edit' : 'chat.queue.delete',
      params: {
        ...getPersonalSyncIdentity(),
        sessionId,
        queueMessageId: String(body.queueMessageId || body.messageId || ''),
        ...(editing ? { text: String(body.message || body.text || '') } : {}),
      },
    } as ReqFrame)
    return { status: 200, body: { ok: true, queue: host.getRuntime().chatQueue?.getSnapshot(sessionId) } }
  }
  if (pathname === '/sessions/stop' || pathname === '/sessions/terminate') {
    if (worker.status === 'final' || worker.status === 'error' || worker.status === 'aborted') {
      const kind: WorkerMarkdownKind = worker.status === 'final' ? 'completed' : worker.status === 'error' ? 'failed' : 'stopped'
      return { status: 200, body: {
        ok: true,
        alreadyTerminal: true,
        code: 'worker_terminal',
        status: worker.status,
        markdown: formatWorkerMarkdown({
          kind, sessionId, title: worker.title || deriveWorkerTitle(worker.userGoal || worker.summary || ''),
          body: worker.summary || '本次执行已经结束。',
        }),
      } }
    }
    await host.dispatchReq({
      type: 'req', id: `manager-abort-${randomUUID()}`, method: 'chat.abort', params: {
        ...getPersonalSyncIdentity(),
        sessionId,
      },
    })
    host.registry.updateWorker(sessionId, { status: 'aborted' })
    return { status: 200, body: { ok: true, markdown: formatWorkerMarkdown({
      kind: 'stopped', sessionId, title: worker.title || deriveWorkerTitle(worker.userGoal || worker.summary || ''),
      body: '已停止本次执行。',
    }) } }
  }
  if (pathname === '/sessions/read') {
    const limit = Number(body.limit || 200)
    const rawMessages = readMessages(sessionId, { limit: Math.max(limit * 20, limit) })
    return { status: 200, body: {
      ok: true, messages: compactWorkerTranscript(rawMessages, limit), rawMessageCount: rawMessages.length,
    } }
  }
  if (pathname === '/sessions/wait') {
    const timeoutMs = Math.max(1_000, Math.min(Number(body.timeoutMs || 600_000), 600_000))
    const deadline = Date.now() + timeoutMs
    let event: ManagerInboxEvent | undefined
    while (Date.now() < deadline) {
      event = host.registry.listInboxEvents(managerSessionId)
        .find((candidate) => candidate.workerSessionId === sessionId)
      if (event) break
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    if (!event) {
      const latest = host.registry.getWorkerForManager(managerSessionId, sessionId)
      if (latest && (latest.status === 'final' || latest.status === 'error' || latest.status === 'aborted')) {
        const kind: WorkerMarkdownKind = latest.status === 'final'
          ? 'completed'
          : latest.status === 'error' ? 'failed' : 'stopped'
        return { status: 200, body: {
          ok: true,
          timedOut: false,
          alreadyTerminal: true,
          status: latest.status,
          markdown: formatWorkerMarkdown({
            kind,
            sessionId,
            title: latest.title || deriveWorkerTitle(latest.userGoal || latest.summary || ''),
            body: latest.summary || '本次执行已经结束。',
          }),
        } }
      }
      return { status: 200, body: {
        ok: true,
        timedOut: true,
        code: 'wait_timed_out',
        status: latest?.status ?? 'running',
        nextAction: 'Call worker read or worker wait again later with the same workerRef.',
      } }
    }
    const markdown = formatWorkerMarkdown({
      kind: managerInboxKind(event.kind), sessionId,
      title: worker.title || deriveWorkerTitle(worker.userGoal || worker.summary || event.summary), body: event.summary,
    })
    host.registry.removeInboxEvents(managerSessionId, [event.id])
    return { status: 200, body: { ok: true, timedOut: false, markdown, event } }
  }
  return null
}

const EPHEMERAL_ROUTES: Record<string, { action: EphemeralWorkerAction; managerPath: string }> = {
  '/workers/read': { action: 'read', managerPath: '/sessions/read' },
  '/workers/send': { action: 'send', managerPath: '/sessions/send' },
  '/workers/wait': { action: 'wait', managerPath: '/sessions/wait' },
  '/workers/stop': { action: 'stop', managerPath: '/sessions/stop' },
}

export async function handleEphemeralWorkerIpcRoute(
  host: WorkerIpcHost,
  pathname: string,
  body: Record<string, unknown>,
): Promise<WorkerIpcResponse | null> {
  if (!pathname.startsWith('/workers/')) return null
  const config = loadConfig()
  if (!config.machineId || (!config.machineToken && !config.accessToken)) {
    throw new EphemeralWorkerError(
      'auth_required',
      'Shennian CLI must be paired and logged in.',
      'Pair this installation with shennian pair, then retry the same worker command.',
      401,
    )
  }

  if (pathname === '/workers/list') {
    const sessionId = String(body.stewardSessionId || '')
    if (!sessionId || !isStewardSessionId(sessionId)) throw new EphemeralWorkerError('worker_command_unavailable', 'Worker listing requires a personal steward context.', 'External Workers remain controlled by their original workerRef.', 404)
    const workers = Object.values(host.registry.load().managers)
      .filter(manager => manager.stewardSessionId === sessionId && manager.machineId === config.machineId && manager.stewardAccountNamespaceId === (config.accountNamespaceId ?? null))
      .flatMap(manager => host.registry.listWorkers(manager.sessionId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100)
      .map(worker => ({ ...worker, workerRef: host.registry.issueWorkerRef({ managerSessionId: worker.managedBy!, workerSessionId: worker.sessionId, workDir: worker.workDir, machineId: config.machineId!, accountNamespaceId: config.accountNamespaceId ?? null }).workerRef }))
    return { status: 200, body: { ok: true, workers } }
  }
  if (pathname === '/workers/report') {
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message || message.length > 8000 || !host.reportWorkerProgress) throw new Error('personal_worker_report_invalid')
    host.reportWorkerProgress(String(body.workerId || ''), message)
    return { status: 200, body: { ok: true } }
  }
  if (pathname === '/workers/start') {
    const message = String(body.message || '').trim()
    if (!message) {
      throw new EphemeralWorkerError(
        'worker_message_required',
        'A Worker task message is required.',
        'Provide --message or --message-file and retry worker start.',
      )
    }
    const stewardSessionId = typeof body.stewardSessionId === 'string' ? body.stewardSessionId : ''
    if (stewardSessionId && !isStewardSessionId(stewardSessionId)) throw new Error('personal_worker_context_invalid')
    const defaults = stewardSessionId ? readWorkerSettings() : null
    const agentType = String(body.agentType || body.agent || defaults?.agentType || (stewardSessionId ? 'shennian' : '')) as AgentType
    if (!agentType || !isManagerWorkerAgentType(agentType)) {
      throw new EphemeralWorkerError(
        'runtime_unavailable',
        `Unsupported Worker Agent: ${agentType || '(empty)'}`,
        'Run shennian agent discover and select a Worker-capable Agent type.',
      )
    }
    // The daemon already owns an authoritative discovery snapshot. Starting a
    // Worker must not re-run provider/version/auth probes on the hot path.
    const agentInfo = host.getAgentSnapshot?.().find((agent) => agent.type === agentType)
    if (!agentInfo || agentInfo.supportsExternalWorkerTarget !== true) {
      throw new EphemeralWorkerError(
        'runtime_unavailable',
        `Worker Agent is not available on this machine: ${agentType}`,
        'Run shennian agent discover and select a discovered Agent with supportsExternalWorkerTarget=true.',
      )
    }
    if (agentInfo.authState === 'required' || agentInfo.authState === 'error') {
      throw new EphemeralWorkerError(
        'auth_required',
        `Worker Agent requires provider sign-in: ${agentType}`,
        'Sign in with the provider’s own CLI on this computer, refresh discovery, and retry worker start.',
      )
    }
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : (!body.agentType && !body.agent ? defaults?.modelId ?? '' : '')
    if (agentType === 'shennian' && modelId) throw new EphemeralWorkerError(
      'model_unavailable', 'Shennian Workers use the personal model settings.',
      'Set the Shennian model in Main Agent system settings and omit --model.',
    )
    if (modelId && agentInfo.models.length > 0 && !agentInfo.models.some((model) => model.id === modelId)) {
      throw new EphemeralWorkerError(
        'model_unavailable',
        `The selected model was not returned by discovery for ${agentType}.`,
        `Run shennian agent discover and choose a model id returned for ${agentType}.`,
      )
    }
    const workDir = resolveExternalWorkDir(String(body.workDir || defaults?.workDir || (stewardSessionId ? getStewardDir() : process.cwd())))
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    if (stewardSessionId && !/^[A-Za-z0-9_.:@-]{8,128}$/.test(requestId)) throw new Error('personal_worker_request_id_required')
    const notificationMode = body.notificationMode === 'direct' && stewardSessionId ? 'direct' as const : undefined
    const scheduleId = notificationMode && typeof body.scheduleId === 'string' ? body.scheduleId : undefined
    const fingerprint = createHash('sha256').update(JSON.stringify({ message, agentType, modelId, workDir, title: body.title ?? null, ...(notificationMode ? { notificationMode, scheduleId } : {}) })).digest('hex')
    const managerSessionId = stewardSessionId
      ? `steward_worker_${createHash('sha256').update(`${config.accountNamespaceId ?? ""}:${config.machineId}:${stewardSessionId}:${requestId}`).digest('hex')}`
      : `ephemeral_controller_${randomUUID()}`
    const existing = host.registry.getManager(managerSessionId)
    if (existing && existing.requestFingerprint !== fingerprint) throw new Error('personal_worker_request_conflict')
    const priorWorker = existing ? host.registry.listWorkers(managerSessionId)[0] : undefined
    if (priorWorker) {
      const { workerRef, grant } = host.registry.issueWorkerRef({ managerSessionId, workerSessionId: priorWorker.sessionId, workDir, machineId: config.machineId, accountNamespaceId: config.accountNamespaceId ?? null })
      return { status: 200, body: { ok: true, workerId: priorWorker.sessionId, workerRef, resolvedWorkDir: workDir, agentType, status: priorWorker.status, expiresAt: grant.expiresAt, reused: true } }
    }
    host.registry.upsertManager({
      sessionId: managerSessionId,
      agentSessionId: null,
      workDir,
      machineId: config.machineId,
      modelId: 'manager',
      agentType: 'manager',
      controllerKind: 'ephemeral',
      notificationMode, scheduleId,
      ...(stewardSessionId ? { stewardSessionId, stewardAccountNamespaceId: config.accountNamespaceId ?? null, requestFingerprint: fingerprint } : {}),
      status: 'idle',
    })
    let started: WorkerIpcResponse
    try {
      started = (await handleWorkerIpcRoute(host, '/sessions/start', {
        managerSessionId,
        agentType,
        workDir,
        title: body.title,
        modelId: modelId || undefined,
        message,
      }, ''))!
    } catch (error) {
      if (stewardSessionId) {
        for (const worker of host.registry.listWorkers(managerSessionId)) host.registry.updateWorker(worker.sessionId, { status: 'error', summary: '任务入队未确认；请读取状态核对，不要盲目重建。' })
        throw error
      }
      const workers = host.registry.retireManager(managerSessionId)
      for (const worker of workers) {
        host.registry.completeRetiredWorker(managerSessionId, worker.sessionId)
      }
      throw error
    }
    const session = started.body.session as { sessionId?: unknown; status?: unknown } | undefined
    const workerId = typeof session?.sessionId === 'string' ? session.sessionId : ''
    if (!workerId) throw new Error('worker_start_invalid_response')
    const { workerRef, grant } = host.registry.issueWorkerRef({
      managerSessionId,
      workerSessionId: workerId,
      workDir,
      machineId: config.machineId,
      accountNamespaceId: config.accountNamespaceId ?? null,
    })
    return { status: 200, body: {
      ok: true,
      workerId,
      workerRef,
      resolvedWorkDir: workDir,
      agentType,
      status: typeof session?.status === 'string' ? session.status : 'running',
      expiresAt: grant.expiresAt,
    } }
  }

  const route = EPHEMERAL_ROUTES[pathname]
  if (!route) {
    throw new EphemeralWorkerError(
      'worker_command_unavailable',
      'Unknown external Worker command.',
      'Use worker start, read, send, wait, or stop. External Worker history cannot be listed.',
      404,
    )
  }
  const workerRef = String(body.workerRef || body.ref || '')
  const resolution = host.registry.resolveWorkerRefDetailed({
    workerRef,
    action: route.action,
    machineId: config.machineId,
    accountNamespaceId: config.accountNamespaceId ?? null,
  })
  if (!resolution.ok) {
    const code = resolution.reason === 'expired'
      ? 'worker_ref_expired'
      : resolution.reason === 'revoked' ? 'worker_ref_revoked' : 'worker_ref_invalid'
    throw new EphemeralWorkerError(
      code,
      `The Worker reference is ${resolution.reason} or belongs to another local scope.`,
      resolution.reason === 'invalid'
        ? 'Use the exact workerRef returned by worker start. Lost references cannot be rediscovered.'
        : 'Start a new Worker if the task still needs to continue.',
      403,
    )
  }
  const grant = resolution.grant
  let response: WorkerIpcResponse | null
  try {
    response = await handleWorkerIpcRoute(host, route.managerPath, {
      ...body,
      managerSessionId: grant.managerSessionId,
      sessionId: grant.workerSessionId,
    }, '')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'message is required') {
      throw new EphemeralWorkerError(
        'worker_message_required',
        'A non-empty Worker message is required.',
        'Provide --message or --message-file and retry worker send.',
      )
    }
    if (message.includes('not found') || message.includes('not registered')) {
      throw new EphemeralWorkerError(
        'worker_ref_revoked',
        'The Worker is no longer available in this controller scope.',
        'Start a new Worker if the task still needs to continue.',
        410,
      )
    }
    throw new EphemeralWorkerError(
      'worker_command_failed',
      message,
      'Read the Worker state, correct the request, and retry once.',
    )
  }
  if (!response) {
    throw new EphemeralWorkerError(
      'worker_command_unavailable',
      'The requested Worker operation is unavailable.',
      'Use worker start, read, send, wait, or stop.',
      404,
    )
  }
  return { status: response.status, body: {
    ...response.body,
    workerId: grant.workerSessionId,
  } }
}
