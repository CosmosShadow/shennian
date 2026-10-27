// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-task-router.test.ts

import { createHash } from 'node:crypto'
import type {
  VoiceChiefOperationStatus,
  VoiceChiefProjectBrief,
  VoiceChiefReadableMessage,
} from '@shennian/wire'
import {
  createProjectConversation,
  getConversationMessages,
  type ProjectRuntime,
  sendMessageToConversation,
  stopConversation,
} from './voice-chief-control.js'

export type VoiceTaskState =
  | 'working'
  | 'queued'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'stopped'

type ConversationRuntime = ProjectRuntime['conversations'][number]

export type VoiceTaskBrief = {
  taskRef: string
  title: string
  state: VoiceTaskState
  summary: string
  latestProgress: string
  updatedAt: string
  needsUserResponse: boolean
}

function compact(value: string | null | undefined, limit: number): string {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, Math.max(limit - 1, 1))}…` : text
}

function lookupKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toLocaleLowerCase()
    .replace(/[\s·_.，。、“”‘’：:()（）【】[\]-]+/g, '')
    .replace(/(?:项目|工程|对话|会话|任务)$/u, '')
}

function taskRef(conversationId: string): string {
  return `task_${createHash('sha256').update(conversationId).digest('hex').slice(0, 12)}`
}

function findProject(projects: ProjectRuntime[], projectRef: string): ProjectRuntime | null {
  const value = lookupKey(projectRef)
  const exact = projects.find((project) =>
    [project.projectId, project.displayName].some((candidate) => lookupKey(candidate) === value),
  )
  if (exact) return exact
  const partial = projects.filter((project) => {
    const name = lookupKey(project.displayName)
    return name.includes(value) || value.includes(name)
  })
  return partial.length === 1 ? partial[0] : null
}

function resolveTask(
  projects: ProjectRuntime[],
  ref: string,
): { project: ProjectRuntime; conversation: ConversationRuntime } | null | 'ambiguous' {
  const value = lookupKey(ref)
  const all = projects.flatMap((project) =>
    project.conversations.map((conversation) => ({ project, conversation })),
  )
  const exact = all.filter(
    ({ conversation }) =>
      lookupKey(conversation.conversationId) === value ||
      lookupKey(taskRef(conversation.conversationId)) === value ||
      lookupKey(conversation.title) === value,
  )
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return 'ambiguous'
  const partial = all.filter(({ conversation }) => {
    const title = lookupKey(conversation.title)
    return title.includes(value) || value.includes(title)
  })
  return partial.length === 1 ? partial[0] : partial.length > 1 ? 'ambiguous' : null
}

function isQuestion(text: string): boolean {
  return (
    /[？?](?:[”"'）】》]*)$/u.test(text) ||
    /(?:请确认|需要你|是否要|是否需要|请选择|可以吗|要不要)/u.test(text)
  )
}

function normalizedTaskState(
  conversation: ConversationRuntime,
  latestAgentText: string,
): VoiceTaskState {
  if (
    conversation.runPhase === 'waiting_approval' ||
    conversation.runPhase === 'waiting_user_input'
  ) {
    return 'waiting_user'
  }
  if (conversation.runPhase || conversation.canStop) return 'working'
  if (conversation.status === 'failed') return 'failed'
  if (/(?:已停止|已取消|已中止)/u.test(latestAgentText)) return 'stopped'
  return 'completed'
}

function buildTaskBrief(
  conversation: ConversationRuntime,
  messages: VoiceChiefReadableMessage[],
): VoiceTaskBrief {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')?.text ?? ''
  const latestAgent =
    [...messages].reverse().find((message) => message.role === 'agent')?.text ?? ''
  const objective = compact(latestUser, 140)
  const progress = compact(latestAgent || conversation.lastMessagePreview, 200)
  const summary =
    objective && progress
      ? `目标：${objective}；最近进展：${progress}`
      : progress || objective || '暂无可见进展。'
  const state = normalizedTaskState(conversation, latestAgent)
  return {
    taskRef: taskRef(conversation.conversationId),
    title: compact(conversation.title, 60),
    state,
    summary: compact(summary, 320),
    latestProgress: progress,
    updatedAt: conversation.lastActivityAt,
    needsUserResponse: state === 'waiting_user' || isQuestion(latestAgent),
  }
}

async function loadTaskBrief(
  userId: string,
  conversation: ConversationRuntime,
  messageLimit: number,
  callId: string,
): Promise<{ brief: VoiceTaskBrief; messages: VoiceChiefReadableMessage[] }> {
  const result = await getConversationMessages({
    userId,
    conversationId: conversation.conversationId,
    limit: messageLimit,
    callId,
  })
  const messages = result.status === 'ok' ? (result.messages ?? []) : []
  return { brief: buildTaskBrief(conversation, messages), messages }
}

function projectFailure(projectRef: string): VoiceChiefOperationStatus {
  return {
    status: 'failed',
    message: `找不到与“${compact(projectRef, 40)}”唯一匹配的项目。`,
  }
}

function taskFailure(taskRefValue: string): VoiceChiefOperationStatus {
  return {
    status: 'failed',
    message: `找不到与“${compact(taskRefValue, 40)}”唯一匹配的任务。`,
  }
}

export async function listProjectTasksFromVoice(params: {
  userId: string
  projects: ProjectRuntime[]
  projectRef: string
  page?: number | null
}): Promise<
  VoiceChiefOperationStatus & {
    action?: 'list'
    projectSummary?: string
    tasks?: VoiceTaskBrief[]
    page?: number
    hasMore?: boolean
  }
> {
  const project = findProject(params.projects, params.projectRef)
  if (!project) return projectFailure(params.projectRef)
  const page = Number.isFinite(params.page) ? Math.max(1, Math.floor(params.page as number)) : 1
  const sorted = [...project.conversations].sort(
    (left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt),
  )
  const offset = (page - 1) * 20
  const selected = sorted.slice(offset, offset + 20)
  // List tools are index-only. Reading every task body here would create an
  // N+1 relay and make Voice availability depend on every origin machine.
  const tasks = selected.map((conversation) => buildTaskBrief(conversation, []))
  const activeCount = tasks.filter((task) =>
    ['working', 'queued', 'waiting_user'].includes(task.state),
  ).length
  const projectSummary = tasks.length
    ? `“${project.displayName}”第 ${page} 页有 ${tasks.length} 个任务，其中 ${activeCount} 个仍需跟进。`
    : `“${project.displayName}”第 ${page} 页没有可见任务。`
  return {
    status: 'ok',
    action: 'list',
    projectId: project.projectId,
    projectName: project.displayName,
    projectSummary,
    tasks,
    page,
    hasMore: offset + selected.length < sorted.length,
    message: projectSummary,
  }
}

export async function inspectTaskFromVoice(params: {
  userId: string
  projects: ProjectRuntime[]
  taskRef: string
  callId: string
}): Promise<
  VoiceChiefOperationStatus & {
    action?: 'read'
    task?: VoiceTaskBrief
    recent?: Array<Pick<VoiceChiefReadableMessage, 'role' | 'ts' | 'text'>>
  }
> {
  const resolved = resolveTask(params.projects, params.taskRef)
  if (!resolved || resolved === 'ambiguous') return taskFailure(params.taskRef)
  const { project, conversation } = resolved
  const { brief, messages } = await loadTaskBrief(
    params.userId,
    conversation,
    8,
    params.callId,
  )
  return {
    status: 'ok',
    action: 'read',
    projectId: project.projectId,
    projectName: project.displayName,
    conversationId: conversation.conversationId,
    conversationTitle: conversation.title,
    task: brief,
    recent: messages.map(({ role, ts, text }) => ({ role, ts, text })),
    message: brief.summary,
  }
}

export async function createTaskFromVoice(params: {
  userId: string
  projects: ProjectRuntime[]
  projectRef: string
  instruction: string
  chiefConversationId: string
  callId: string
  operationId?: string
}): Promise<
  VoiceChiefOperationStatus & { action?: 'created'; taskRef?: string; taskTitle?: string }
> {
  const project = findProject(params.projects, params.projectRef)
  if (!project) return projectFailure(params.projectRef)
  if (project.machineStatus === 'offline') {
    return {
      status: 'unavailable',
      message: `${project.displayName} 所在机器当前离线，暂时无法创建任务。`,
      projectId: project.projectId,
      projectName: project.displayName,
    }
  }
  const result = await createProjectConversation({
    userId: params.userId,
    projects: params.projects,
    projectId: project.projectId,
    message: params.instruction,
    chiefConversationId: params.chiefConversationId,
    callId: params.callId,
    operationId: params.operationId,
  })
  if (result.conversationId && ['created', 'delivered'].includes(result.status)) {
    const title = result.conversationTitle ?? '新任务'
    return {
      ...result,
      action: 'created',
      taskRef: taskRef(result.conversationId),
      taskTitle: title,
      message: `已在“${project.displayName}”新建任务并发送。`,
    }
  }
  return result
}

export async function continueTaskFromVoice(params: {
  userId: string
  projects: ProjectRuntime[]
  taskRef: string
  instruction: string
  chiefConversationId: string
  callId: string
}): Promise<
  VoiceChiefOperationStatus & { action?: 'continued'; taskRef?: string; taskTitle?: string }
> {
  const resolved = resolveTask(params.projects, params.taskRef)
  if (!resolved || resolved === 'ambiguous') return taskFailure(params.taskRef)
  const { project, conversation } = resolved
  const result = await sendMessageToConversation({
    userId: params.userId,
    conversationId: conversation.conversationId,
    message: params.instruction,
    chiefConversationId: params.chiefConversationId,
    callId: params.callId,
  })
  return result.status === 'delivered' || result.status === 'created'
    ? {
        ...result,
        status: 'delivered',
        action: 'continued',
        taskRef: taskRef(conversation.conversationId),
        taskTitle: conversation.title,
        projectId: project.projectId,
        projectName: project.displayName,
        message: `已补充到“${conversation.title}”任务。`,
      }
    : result
}

export async function stopTaskFromVoice(params: {
  userId: string
  projects: ProjectRuntime[]
  taskRef: string
}): Promise<VoiceChiefOperationStatus & { action?: 'stopped' }> {
  const resolved = resolveTask(params.projects, params.taskRef)
  if (!resolved || resolved === 'ambiguous') return taskFailure(params.taskRef)
  const { conversation } = resolved
  const stopped = await stopConversation({
    userId: params.userId,
    conversationId: conversation.conversationId,
  })
  return stopped.status === 'stopped'
    ? { ...stopped, action: 'stopped', message: `已请求停止“${conversation.title}”。` }
    : stopped
}

export function sanitizeVoiceTaskResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const value = result as Record<string, unknown>
  const sanitized = { ...value }
  delete sanitized.projectId
  delete sanitized.conversationId
  delete sanitized.conversationIds
  delete sanitized.taskId
  sanitized.spokenSummary =
    typeof value.spokenSummary === 'string'
      ? value.spokenSummary
      : typeof value.message === 'string'
        ? value.message
        : ''
  delete sanitized.message
  return sanitized
}

export function taskProjectBriefs(projects: ProjectRuntime[]): VoiceChiefProjectBrief[] {
  return projects.map((project) => ({
    projectId: project.projectId,
    displayName: compact(project.displayName, 64),
    summary: '',
    machineId: project.machineId,
    machineName: compact(project.machineName, 64),
    machineStatus: project.machineStatus,
    recentProgress: [],
    conversations: [],
  }))
}
