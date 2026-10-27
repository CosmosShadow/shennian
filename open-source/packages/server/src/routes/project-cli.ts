import { createStewardProject, updateStewardProject } from '../services/steward-projects.js'
import { registerStewardTaskWatch, readStewardTaskEvent } from '../services/steward-task-watch.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/project-cli-routes.test.ts

import { randomUUID } from 'node:crypto'
import { ownedMachine } from '../services/local-apps/gateway.js'
import { sendServerReqToMachine } from '../relay/server-requests.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AgentType, VoiceChiefOperationStatus } from '@shennian/wire'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireUserOrMachineAuth,
} from '../middleware/auth.js'
import {
  createProjectConversation,
  getConversationMessages,
  listProjectConversations,
  loadVoiceChiefProjects,
  sendMessageToConversation,
  stopConversation,
  type ProjectRuntime,
} from '../services/voice-chief-control.js'

const ID = /^[A-Za-z0-9_.:@-]{1,191}$/
const REQUEST_ID = /^[A-Za-z0-9_.:@-]{8,128}$/
const AGENT_TYPE = /^[A-Za-z0-9_.:@-]{1,191}$/
const MAX_TEXT = 20_000
const PROJECT_TASK_PREVIEW = 3

/**
 * Project control for the local Shennian steward. Every call is scoped to the
 * paired machine's user; the steward's own session is never a target because
 * conversations are read from the ordinary (non-steward) session list.
 */
export async function projectCliRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const machineAuth = { preHandler: [requireUserOrMachineAuth, requireActivePlan] }

  app.post<{ Body: { machineId?: unknown; workDir?: unknown; command?: unknown } }>('/coordination', machineAuth, async (request, reply) => {
    const body = request.body
    if (!body || typeof body.machineId !== 'string' || typeof body.workDir !== 'string' || body.workDir.length > 4000) return badRequest(reply, 'coordination_request_invalid')
    try {
      const machine = await ownedMachine(request.userId, body.machineId)
      if (!machine.online) return reply.code(503).send({ error: 'coordination_machine_offline' })
      const { machineId: _machineId, ...params } = body
      const result = await sendServerReqToMachine(machine.id, { type: 'req', method: 'personal.workspace', params: { ...params, action: 'project_coordination' } }, 20000)
      if (!result.ok) return reply.code(409).send({ error: result.error ?? 'coordination_unavailable' })
      return result.payload
    } catch { return reply.code(403).send({ error: 'coordination_owner_required' }) }
  })

  app.post('/projects', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    try { return { project: await createStewardProject(request.userId, request.body) } }
    catch (error) { return projectError(reply, error) }
  })
  app.patch<{ Params: { projectId: string } }>('/projects/:projectId', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    try { return { project: await updateStewardProject(request.userId, request.params.projectId, request.body) } }
    catch (error) { return projectError(reply, error) }
  })
  app.post<{ Params: { taskId: string }; Body: { stewardSessionId?: unknown } }>('/tasks/:taskId/watch', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    try { return await registerStewardTaskWatch(request.userId, request.machineId!, request.params.taskId, request.body?.stewardSessionId) }
    catch (error) { return projectError(reply, error) }
  })
  app.post('/events/delivery', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    try { return await readStewardTaskEvent(request.userId, request.machineId!, request.body) }
    catch (error) { return projectError(reply, error) }
  })

  app.get('/projects', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const projects = await loadVoiceChiefProjects(request.userId)
    return { projects: projects.map((project) => projectBrief(project)) }
  })

  app.get<{
    Params: { projectId: string }
    Querystring: { limit?: string }
  }>('/projects/:projectId/tasks', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    if (!ID.test(request.params.projectId)) return badRequest(reply, 'project_id_invalid')
    const projects = await loadVoiceChiefProjects(request.userId)
    const result = await listProjectConversations({
      projects,
      projectId: request.params.projectId,
      limit: Number(request.query.limit) || undefined,
    })
    if (result.status !== 'ok') return sendOperation(reply, result)
    return {
      projectId: result.projectId,
      projectName: result.projectName,
      tasks: (result.conversations ?? []).map(taskBrief),
    }
  })

  app.post<{
    Params: { projectId: string }
    Body: { instruction?: unknown; agentType?: unknown; modelId?: unknown; requestId?: unknown }
  }>('/projects/:projectId/tasks', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const { projectId } = request.params
    const body = request.body ?? {}
    if (!ID.test(projectId)) return badRequest(reply, 'project_id_invalid')
    const instruction = boundedText(body.instruction, MAX_TEXT)
    if (!instruction) return badRequest(reply, 'instruction_invalid')
    const requestId = requestIdOf(body.requestId)
    if (!requestId) return badRequest(reply, 'request_id_invalid')
    const agentType = optionalToken(body.agentType, AGENT_TYPE)
    const modelId = optionalToken(body.modelId, AGENT_TYPE)
    if (agentType === false || modelId === false) return badRequest(reply, 'agent_invalid')
    if (agentType === 'pi' || agentType === 'manager') return badRequest(reply, 'agent_invalid')
    const projects = await loadVoiceChiefProjects(request.userId)
    const result = await createProjectConversation({
      userId: request.userId,
      projects,
      projectId,
      message: instruction,
      agentType: agentType as AgentType | null,
      modelId,
      chiefConversationId: `steward-${request.userId}`,
      callId: requestId,
      operationId: requestId,
    })
    return sendOperation(reply, result)
  })

  app.get<{
    Params: { taskId: string }
    Querystring: { limit?: string }
  }>('/tasks/:taskId/messages', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    if (!ID.test(request.params.taskId)) return badRequest(reply, 'task_id_invalid')
    const result = await getConversationMessages({
      userId: request.userId,
      conversationId: request.params.taskId,
      limit: Number(request.query.limit) || undefined,
      callId: `steward-read-${randomUUID()}`,
    })
    if (result.status !== 'ok') return sendOperation(reply, result)
    return {
      taskId: result.conversationId,
      title: result.conversationTitle,
      messages: result.messages ?? [],
    }
  })

  app.post<{
    Params: { taskId: string }
    Body: { text?: unknown; requestId?: unknown }
  }>('/tasks/:taskId/messages', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    if (!ID.test(request.params.taskId)) return badRequest(reply, 'task_id_invalid')
    const text = boundedText(request.body?.text, MAX_TEXT)
    if (!text) return badRequest(reply, 'text_invalid')
    const requestId = requestIdOf(request.body?.requestId)
    if (!requestId) return badRequest(reply, 'request_id_invalid')
    const result = await sendMessageToConversation({
      userId: request.userId,
      conversationId: request.params.taskId,
      message: text,
      chiefConversationId: `steward-${request.userId}`,
      callId: requestId,
    })
    return sendOperation(reply, result)
  })

  app.post<{ Params: { taskId: string } }>('/tasks/:taskId/stop', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    if (!ID.test(request.params.taskId)) return badRequest(reply, 'task_id_invalid')
    const result = await stopConversation({
      userId: request.userId,
      conversationId: request.params.taskId,
      reason: 'steward',
    })
    return sendOperation(reply, result)
  })
}

/** Only the fields a steward needs; never internal ids, prompts or provider session ids. */
function projectBrief(project: ProjectRuntime) {
  return {
    projectId: project.projectId,
    name: project.displayName,
    workDir: project.workDir,
    machineId: project.machineId,
    machineName: project.machineName,
    machineStatus: project.machineStatus,
    summary: project.summary,
    recentTasks: project.conversations.slice(0, PROJECT_TASK_PREVIEW).map(taskBrief),
  }
}

function taskBrief(task: {
  conversationId: string
  title: string
  agentType: string
  modelId?: string | null
  status: string
  runPhase?: string | null
  canStop?: boolean
  lastActivityAt: string
  lastMessagePreview?: string | null
}) {
  return {
    taskId: task.conversationId,
    title: task.title,
    agentType: task.agentType,
    modelId: task.modelId ?? null,
    status: task.status,
    runPhase: task.runPhase ?? null,
    canStop: Boolean(task.canStop),
    lastActivityAt: task.lastActivityAt,
    lastMessagePreview: task.lastMessagePreview ?? '',
  }
}

function sendOperation(
  reply: FastifyReply,
  result: VoiceChiefOperationStatus & { projectId?: string; projectName?: string },
) {
  if (result.status === 'unavailable') {
    return reply.code(503).send({ error: 'machine_unavailable', message: result.message })
  }
  if (result.status === 'failed') {
    const missing = /不存在|不属于/u.test(result.message)
    return reply.code(missing ? 404 : 422).send({
      error: missing ? 'not_found' : 'task_failed',
      message: result.message,
    })
  }
  return {
    status: result.status,
    message: result.message,
    ...(result.projectId ? { projectId: result.projectId, projectName: result.projectName } : {}),
    ...(result.conversationId ? { taskId: result.conversationId, title: result.conversationTitle } : {}),
  }
}

function requireMachine(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.machineId) return true
  void reply.code(403).send({ error: 'machine_auth_required' })
  return false
}

function badRequest(reply: FastifyReply, error: string) {
  return reply.code(400).send({ error, message: 'The request is invalid.' })
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= max ? text : null
}

function requestIdOf(value: unknown): string | null {
  return typeof value === 'string' && REQUEST_ID.test(value) ? value : null
}

/** null when absent, false when present but invalid. */
function optionalToken(value: unknown, pattern: RegExp): string | null | false {
  if (value === undefined || value === null || value === '') return null
  return typeof value === 'string' && pattern.test(value) ? value : false
}

function projectError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const safe = /^(project_input_invalid|task_watch_invalid|task_watch_forbidden|task_watch_client_upgrade_required|machine_owner_required|invalid_machine|Project not found|Invalid project directory|Machine not found)$/.test(message)
  return reply.code(/forbidden|owner_required/.test(message) ? 403 : /not found/.test(message) ? 404 : safe ? 400 : 503).send({ error: safe ? message : 'project_unavailable' })
}
