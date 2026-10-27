// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-control.test.ts

import { createHash, randomUUID } from 'node:crypto'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  extractPayloadText,
  isAgentHiddenPayload,
  isSystemControlPayload,
  isToolPayload,
  type AgentType,
  type NianSession,
  type ReqFrame,
  type SessionDeliveryState,
  type SessionDurableSendAck,
  type VoiceChiefConversationBrief,
  type VoiceChiefOperationStatus,
  type VoiceChiefProjectBrief,
  type VoiceChiefReadableMessage,
  type VoiceSessionBodyWindow,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { sendServerReqToMachine } from '../relay/server-requests.js'
import { createSessionForUser, deleteSessionForUser, listUserSessions } from './sessions.js'
import { listUserProjects, normalizeProjectWorkDir } from './projects.js'
import {
  registerVoiceTaskCompletionNotify,
  type VoiceTaskCompletionNotifyMode,
} from './voice-task-completion-notify.js'
import { readVoiceBodyCache, writeVoiceBodyCache } from './voice-body-cache.js'

const MAX_PROJECT_SESSIONS = 160
const MAX_CONVERSATIONS = 15
const MAX_MESSAGES = 8
const MAX_SUMMARY_LENGTH = 260
const VOICE_BODY_MAX_BYTES = 32 * 1024
const VOICE_BODY_CACHE_TTL_MS = 2 * 60_000
const VOICE_AGENT_DISPATCH_ACK_TIMEOUT_MS = 4_000
const DEFAULT_AGENT_TYPE: AgentType = 'codex'
export const HANG_UP_CALL_TOOL = {
  name: 'hang_up',
  description: '结束当前神念语音通话。只在用户明确说“拜拜”“好了”“就这样”“挂了”等结束语时调用。',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: '可选。挂断原因短句，例如“用户结束通话”。',
      },
    },
    required: [],
    additionalProperties: false,
  },
} as const

export type ProjectRuntime = Omit<VoiceChiefProjectBrief, 'conversations'> & {
  workDir: string
  latestAgentType: AgentType | null
  latestModelId: string | null
  conversations: ConversationRuntime[]
}

type ConversationRuntime = VoiceChiefConversationBrief & {
  workDir: string
  machineId: string
  machineName: string
  machineStatus: 'online' | 'offline' | 'unknown'
  agentSessionId: string | null
  systemPrompt: string | null
  isUnread?: boolean
  bodyRevision: number
  daemonInstallationId: string
}

function compact(value: string | null | undefined, limit = MAX_SUMMARY_LENGTH): string {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function displayProjectName(workDir: string): string {
  const normalized = workDir.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) || workDir || '未命名项目'
}

export function voiceChiefProjectId(machineId: string, workDir: string): string {
  return `project_${createHash('sha256').update(`${machineId}\0${workDir}`).digest('hex').slice(0, 20)}`
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(Math.max(Math.floor(numeric), 1), max)
}

function conversationTitle(session: Pick<NianSession, 'title' | 'id'>): string {
  return compact(session.title, 60) || `会话 ${session.id.slice(0, 8)}`
}

function sessionIsUnread(session: NianSession): boolean {
  if (session.userState?.manualUnread) return true
  if (!session.userState) return false
  const attentionCount = session.attentionCount ?? 0
  const readCount = session.userState.lastReadAttentionCount ?? 0
  if (attentionCount > readCount) return true
  return (
    attentionCount > 0 &&
    (session.lastAttentionId ?? null) !==
      (session.userState.lastReadAttentionId ?? null)
  )
}

function toConversationBrief(
  session: NianSession,
  machineStatus: 'online' | 'offline' | 'unknown',
  daemonInstallationId = '',
): ConversationRuntime {
  return {
    conversationId: session.id,
    title: conversationTitle(session),
    agentType: session.agentType,
    modelId:
      session.modelSource === 'agent'
        ? (session.agentDefaultModelId ?? null)
        : (session.modelId ?? null),
    status: session.status,
    runPhase: session.activity?.runPhase ?? null,
    canStop: Boolean(session.activity?.canStop),
    lastActivityAt: session.lastActivityAt,
    lastMessagePreview: compact(session.lastMessagePreview, 160),
    workDir: session.workDir,
    machineId: session.machineId,
    machineName: session.machineName || session.machineId,
    machineStatus,
    agentSessionId: session.agentSessionId ?? null,
    systemPrompt: session.agentSystemPrompt ?? null,
    isUnread: sessionIsUnread(session),
    bodyRevision: session.bodyRevision ?? 0,
    daemonInstallationId,
  }
}

export async function loadVoiceChiefProjects(userId: string): Promise<ProjectRuntime[]> {
  const [projectRecords, sessions] = await Promise.all([
    listUserProjects(userId),
    listUserSessions({ userId, limit: 160, excludeRoomBound: true }),
  ])
  const grouped = new Map<string, NianSession[]>()
  for (const session of sessions) {
    if (
      session.deletedAt ||
      session.agentType === 'manager' ||
      !session.machineId ||
      !session.workDir
    )
      continue
    const key = `${session.machineId}\0${normalizeProjectWorkDir(session.workDir)}`
    const group = grouped.get(key) ?? []
    group.push(session)
    grouped.set(key, group)
  }

  return projectRecords.map((project): ProjectRuntime => {
    const projectSessions = grouped.get(`${project.machineId}\0${project.workDir}`) ?? []
    const sorted = [...projectSessions].sort(
      (left, right) =>
        new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime(),
    )
    const latest = sorted[0]
    const displayName = project.displayName || displayProjectName(project.workDir)
    const machineStatus = project.machineOnline ? 'online' : 'offline'
    const conversations = sorted
      .slice(0, MAX_PROJECT_SESSIONS)
      .map((session) => toConversationBrief(session, machineStatus))
    const recentProgress = sorted
      .map((session) => compact(session.lastMessagePreview, 120))
      .filter(Boolean)
      .slice(0, 3)
    const latestWorker = sorted.find((session) => session.agentType !== 'manager') ?? latest
    return {
      projectId: project.id,
      displayName,
      summary: recentProgress[0] || `${displayName} 项目`,
      machineId: project.machineId,
      machineName: project.machineName || project.machineId,
      machineStatus,
      recentProgress,
      conversations,
      workDir: project.workDir,
      latestAgentType: project.defaultAgentType ?? latestWorker?.agentType ?? null,
      latestModelId: project.defaultAgentType
        ? (project.defaultModelId ?? null)
        : (latestWorker?.modelId ?? null),
    }
  })
}

function findProject(projects: ProjectRuntime[], projectId: string): ProjectRuntime | null {
  return projects.find((project) => project.projectId === projectId) ?? null
}

async function loadConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationRuntime | null> {
  const sessions = await listUserSessions({ userId, limit: 200, excludeRoomBound: true })
  const session = sessions.find(
    (candidate) => candidate.id === conversationId && !candidate.deletedAt,
  )
  if (!session) return null
  const machine = await prisma.machine.findUnique({
    where: { id: session.machineId },
    select: { online: true, daemonInstallationId: true },
  })
  const machineStatus = machine ? (machine.online ? 'online' : 'offline') : 'unknown'
  if (!machine?.daemonInstallationId) return null
  return toConversationBrief(session, machineStatus, machine.daemonInstallationId)
}

function personalIdentity(daemonInstallationId: string) {
  return {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId,
  }
}

function readableMessage(message: {
  id: string
  role: string
  ts: number
  payload: string
}): VoiceChiefReadableMessage | null {
  if (isToolPayload(message.payload)) return null
  if (isSystemControlPayload(message.payload)) return null
  if (isAgentHiddenPayload(message.payload)) return null
  if (message.role !== 'user' && message.role !== 'agent') return null
  const text = compact(extractPayloadText(message.payload), 500)
  if (!text) return null
  return { id: message.id, role: message.role as 'user' | 'agent', ts: message.ts, text }
}

export async function listProjectConversations(params: {
  projects: ProjectRuntime[]
  projectId: string
  limit?: number
}): Promise<{
  status: 'ok' | 'failed'
  projectId: string
  projectName?: string
  conversations?: VoiceChiefConversationBrief[]
  message: string
}> {
  const project = findProject(params.projects, params.projectId)
  if (!project)
    return {
      status: 'failed',
      projectId: params.projectId,
      message: '项目不存在或不属于当前用户。',
    }
  const limit = parseLimit(params.limit, 3, MAX_CONVERSATIONS)
  return {
    status: 'ok',
    projectId: project.projectId,
    projectName: project.displayName,
    conversations: project.conversations.slice(0, limit),
    message: `已返回 ${project.displayName} 最近 ${Math.min(project.conversations.length, limit)} 个会话。`,
  }
}

export async function getConversationMessages(params: {
  userId: string
  conversationId: string
  limit?: number
  callId?: string
}): Promise<{
  status: 'ok' | 'failed'
  conversationId: string
  conversationTitle?: string
  messages?: VoiceChiefReadableMessage[]
  message: string
}> {
  const conversation = await loadConversation(params.userId, params.conversationId)
  if (!conversation)
    return {
      status: 'failed',
      conversationId: params.conversationId,
      message: '会话不存在或不属于当前用户。',
    }
  const limit = parseLimit(params.limit, 4, MAX_MESSAGES)
  const callId = params.callId?.trim() || `voice-read-${randomUUID()}`
  const cached = readVoiceBodyCache(callId, conversation.conversationId, conversation.bodyRevision)
  if (cached) {
    return {
      status: 'ok',
      conversationId: conversation.conversationId,
      conversationTitle: conversation.title,
      messages: cached.slice(-limit),
      message: `已返回 ${conversation.title} 最近 ${Math.min(cached.length, limit)} 条可见消息。`,
    }
  }
  if (conversation.machineStatus !== 'online') {
    return {
      status: 'failed',
      conversationId: conversation.conversationId,
      conversationTitle: conversation.title,
      message: `${conversation.machineName} 当前离线，只能读取任务索引摘要。`,
    }
  }

  let response: Awaited<ReturnType<typeof sendServerReqToMachine>>
  try {
    response = await sendServerReqToMachine(
      conversation.machineId,
      {
        type: 'req',
        method: 'voice.session.body.window',
        params: {
          ...personalIdentity(conversation.daemonInstallationId),
          sessionId: conversation.conversationId,
          callId,
          bodyRevision: conversation.bodyRevision,
          limit,
          maxBytes: VOICE_BODY_MAX_BYTES,
        },
      },
      8_000,
    )
  } catch (error) {
    return {
      status: 'failed',
      conversationId: conversation.conversationId,
      conversationTitle: conversation.title,
      message: error instanceof Error ? error.message : '运行机器暂时无法读取任务正文。',
    }
  }
  if (!response.ok) {
    return {
      status: 'failed',
      conversationId: conversation.conversationId,
      conversationTitle: conversation.title,
      message: response.error || '运行机器暂时无法读取任务正文。',
    }
  }
  const bodyWindow = response.payload as VoiceSessionBodyWindow | undefined
  if (
    bodyWindow?.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION ||
    bodyWindow.dataEpoch !== SESSION_SYNC_DATA_EPOCH ||
    bodyWindow.daemonInstallationId !== conversation.daemonInstallationId ||
    bodyWindow.sessionId !== conversation.conversationId ||
    bodyWindow.callId !== callId ||
    bodyWindow.bodyRevision !== conversation.bodyRevision
  ) {
    return {
      status: 'failed',
      conversationId: conversation.conversationId,
      conversationTitle: conversation.title,
      message: '运行机器返回了不匹配的任务正文身份。',
    }
  }
  const messages = (Array.isArray(bodyWindow?.messages) ? bodyWindow.messages : [])
    .map(readableMessage)
    .filter((item): item is VoiceChiefReadableMessage => item !== null)
    .slice(-limit)
  writeVoiceBodyCache({
    callId,
    sessionId: conversation.conversationId,
    bodyRevision: conversation.bodyRevision,
    expiresAt: Date.now() + VOICE_BODY_CACHE_TTL_MS,
    messages,
  })
  return {
    status: 'ok',
    conversationId: conversation.conversationId,
    conversationTitle: conversation.title,
    messages,
    message: `已返回 ${conversation.title} 最近 ${messages.length} 条可见消息。`,
  }
}

function sendTextFrame(
  input: {
    conversation: ConversationRuntime
    text: string
    clientMessageId: string
  },
): Omit<ReqFrame, 'id'> {
  return {
    type: 'req',
    method: 'chat.enqueue',
    params: {
      ...personalIdentity(input.conversation.daemonInstallationId),
      sessionId: input.conversation.conversationId,
      text: input.text,
      agentType: input.conversation.agentType,
      workDir: input.conversation.workDir,
      agentSessionId: input.conversation.agentSessionId,
      modelId: input.conversation.modelId ?? undefined,
      systemPrompt: input.conversation.systemPrompt,
      clientMessageId: input.clientMessageId,
      queueMessageId: input.clientMessageId,
    },
  }
}

const VOICE_SEND_DELIVERY_STATES = new Set<SessionDeliveryState>([
  'queued', 'committed', 'executing', 'completed', 'failed', 'cancelled',
])

function parseVoiceDurableAck(
  payload: unknown,
  input: { conversation: ConversationRuntime; clientMessageId: string },
): SessionDurableSendAck | null {
  const value = payload as Partial<SessionDurableSendAck> | null | undefined
  if (
    !value ||
    value.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION ||
    value.dataEpoch !== SESSION_SYNC_DATA_EPOCH ||
    value.daemonInstallationId !== input.conversation.daemonInstallationId ||
    value.sessionId !== input.conversation.conversationId ||
    value.clientMessageId !== input.clientMessageId ||
    typeof value.messageId !== 'string' || !value.messageId ||
    typeof value.deliveryState !== 'string' ||
    !VOICE_SEND_DELIVERY_STATES.has(value.deliveryState as SessionDeliveryState) ||
    !Number.isSafeInteger(value.bodyRevision) || Number(value.bodyRevision) < 1 ||
    typeof value.committedAt !== 'string' ||
    !Number.isFinite(new Date(value.committedAt).getTime())
  ) return null
  return value as SessionDurableSendAck
}

async function sendVoiceCommandDurably(input: {
  conversation: ConversationRuntime
  text: string
  clientMessageId: string
}): Promise<SessionDurableSendAck> {
  const frame = sendTextFrame(input)
  let firstFailure = '发送失败。'
  try {
    const response = await sendServerReqToMachine(
      input.conversation.machineId, frame, VOICE_AGENT_DISPATCH_ACK_TIMEOUT_MS,
    )
    const ack = response.ok ? parseVoiceDurableAck(response.payload, input) : null
    if (ack) return ack
    firstFailure = response.ok
      ? 'Invalid daemon durable ACK'
      : response.error || firstFailure
    if (!response.ok && isConfirmedPreDispatchRejection(firstFailure)) {
      throw new VoiceCommandDispatchError(firstFailure, true)
    }
  } catch (error) {
    if (error instanceof VoiceCommandDispatchError) throw error
    firstFailure = error instanceof Error ? error.message : firstFailure
  }

  let statusResponse: Awaited<ReturnType<typeof sendServerReqToMachine>>
  try {
    statusResponse = await sendServerReqToMachine(
      input.conversation.machineId,
      {
        type: 'req', method: 'session.message.status',
        params: {
          ...personalIdentity(input.conversation.daemonInstallationId),
          sessionId: input.conversation.conversationId,
          clientMessageId: input.clientMessageId,
        },
      },
      VOICE_AGENT_DISPATCH_ACK_TIMEOUT_MS,
    )
  } catch (error) {
    throw new VoiceCommandDispatchError(
      error instanceof Error ? error.message : firstFailure,
      false,
    )
  }
  if (!statusResponse.ok) {
    throw new VoiceCommandDispatchError(statusResponse.error || firstFailure, false)
  }
  const recovered = parseVoiceDurableAck(statusResponse.payload, input)
  if (recovered) return recovered
  const status = statusResponse.payload as { state?: unknown } | null | undefined
  if (status?.state !== 'not_found') {
    throw new VoiceCommandDispatchError('Invalid daemon message status', false)
  }

  const retry = await sendServerReqToMachine(
    input.conversation.machineId, frame, VOICE_AGENT_DISPATCH_ACK_TIMEOUT_MS,
  )
  if (!retry.ok) {
    const message = retry.error || firstFailure
    throw new VoiceCommandDispatchError(message, isConfirmedPreDispatchRejection(message))
  }
  const retriedAck = parseVoiceDurableAck(retry.payload, input)
  if (!retriedAck) throw new VoiceCommandDispatchError('Invalid daemon durable ACK', false)
  return retriedAck
}

class VoiceCommandDispatchError extends Error {
  constructor(message: string, readonly confirmedNotCommitted: boolean) {
    super(message)
    this.name = 'VoiceCommandDispatchError'
  }
}

function isConfirmedPreDispatchRejection(message: string): boolean {
  return /^(?:personal_sync_identity_mismatch|invalid_identity|epoch_mismatch|upgrade_required|ownership_transferred|token_revoked)(?::|$)/u.test(
    message.trim(),
  )
}

type VoiceDispatchOutcome = {
  result: VoiceChiefOperationStatus
  confirmedNotCommitted: boolean
}

async function sendToConversation(input: {
  conversation: ConversationRuntime
  text: string
  clientMessageId: string
}): Promise<VoiceDispatchOutcome> {
  if (input.conversation.machineStatus === 'offline') {
    return {
      result: {
        status: 'unavailable',
        message: `${input.conversation.machineName} 当前离线，消息没有开始执行。`,
        conversationId: input.conversation.conversationId,
        conversationTitle: input.conversation.title,
      },
      confirmedNotCommitted: true,
    }
  }
  let ack: SessionDurableSendAck
  try {
    ack = await sendVoiceCommandDurably(input)
  } catch (error) {
    return {
      result: {
        status: 'failed',
        message: error instanceof Error ? error.message : '发送失败。',
        conversationId: input.conversation.conversationId,
        conversationTitle: input.conversation.title,
      },
      confirmedNotCommitted:
        error instanceof VoiceCommandDispatchError && error.confirmedNotCommitted,
    }
  }
  if (ack.deliveryState === 'queued') {
    return {
      result: {
        status: 'delivered',
        message: `已加入 ${input.conversation.title} 的待执行队列。`,
        conversationId: input.conversation.conversationId,
        conversationTitle: input.conversation.title,
      },
      confirmedNotCommitted: false,
    }
  }
  return {
    result: {
      status: 'delivered',
      message: `已发送给 ${input.conversation.title}。`,
      conversationId: input.conversation.conversationId,
      conversationTitle: input.conversation.title,
    },
    confirmedNotCommitted: false,
  }
}

async function maybeRegisterCompletionCall(input: {
  mode?: VoiceTaskCompletionNotifyMode
  userId: string
  sessionId: string
  status: VoiceChiefOperationStatus['status']
  projectHint?: string | null
  sourceConversationId: string
  sourceCallId: string
}) {
  if (input.mode !== 'call') return
  if (input.status !== 'created' && input.status !== 'delivered') return
  try {
    await registerVoiceTaskCompletionNotify({
      userId: input.userId,
      sessionId: input.sessionId,
      mode: input.mode,
      reason: '任务完成',
      initialPrompt:
        '接通后先说明这是按用户设置在任务完成后回拨，并查看该会话的最新结果，然后自然询问用户是否继续处理。',
      projectHint: input.projectHint,
      sourceConversationId: input.sourceConversationId,
      sourceCallId: input.sourceCallId,
    })
  } catch (error) {
    console.warn('[voice-chief] failed to register task completion call', error)
  }
}

export async function createProjectConversation(params: {
  userId: string
  projects: ProjectRuntime[]
  projectId: string
  message: string
  agentType?: AgentType | null
  modelId?: string | null
  chiefConversationId: string
  callId: string
  operationId?: string
  completionNotifyMode?: VoiceTaskCompletionNotifyMode
}): Promise<VoiceChiefOperationStatus & { projectId?: string; projectName?: string }> {
  const project = findProject(params.projects, params.projectId)
  if (!project) return { status: 'failed', message: '项目不存在或不属于当前用户。' }
  const message = params.message.trim()
  if (!message) return { status: 'failed', message: '发送内容为空。' }
  if (project.machineStatus === 'offline') {
    return {
      status: 'unavailable',
      message: `${project.displayName} 所在机器当前离线，无法开始新会话。`,
      projectId: project.projectId,
      projectName: project.displayName,
    }
  }
  const agentType = params.agentType ?? project.latestAgentType ?? DEFAULT_AGENT_TYPE
  const operationId = params.operationId?.trim() || params.callId
  const creationKey = createHash('sha256')
    .update(
      `voice-task-v1\0${params.chiefConversationId}\0${operationId}\0${project.projectId}\0${message.replace(/\s+/gu, ' ')}`,
    )
    .digest('hex')
  const session = await createSessionForUser({
    creationKey,
    userId: params.userId,
    machineId: project.machineId,
    workDir: project.workDir,
    agentType,
    modelId: params.modelId || (params.agentType ? undefined : project.latestModelId) || undefined,
  })
  const conversation: ConversationRuntime = {
    conversationId: session.id,
    title: conversationTitle(session),
    agentType: session.agentType as AgentType,
    modelId: session.modelId ?? null,
    status: session.status as 'active' | 'completed' | 'failed',
    runPhase: null,
    canStop: false,
    lastActivityAt: session.lastActivityAt.toISOString(),
    lastMessagePreview: '',
    workDir: session.workDir ?? project.workDir,
    machineId: session.machineId,
    machineName: session.machineName || project.machineName,
    machineStatus: project.machineStatus,
    agentSessionId: session.agentSessionId ?? null,
    systemPrompt: null,
    bodyRevision: session.bodyRevision ?? 0,
    daemonInstallationId: session.daemonInstallationId ?? '',
  }
  if (!conversation.daemonInstallationId) {
    throw new Error('upgrade_required: daemonInstallationId is required')
  }
  const dispatch = await sendToConversation({
    conversation,
    text: message,
    clientMessageId: `voice-shennian-${params.chiefConversationId}-${operationId}`,
  })
  if (dispatch.confirmedNotCommitted) {
    try {
      await deleteSessionForUser(session.id, params.userId)
    } catch (error) {
      console.warn('[voice-chief] failed to remove an uncommitted session shell', error)
    }
  }
  const result = dispatch.result
  const operation = {
    ...result,
    status: result.status === 'delivered' ? 'created' : result.status,
    message:
      result.status === 'delivered'
        ? result.message.includes('响应较慢')
          ? `已在 ${project.displayName} 新建会话并发送命令；机器响应较慢，我会继续监听后续进展。`
          : `已在 ${project.displayName} 新建会话并发送命令。`
        : result.message,
    projectId: project.projectId,
    projectName: project.displayName,
    conversationId: conversation.conversationId,
    conversationTitle: conversation.title,
  }
  await maybeRegisterCompletionCall({
    mode: params.completionNotifyMode,
    userId: params.userId,
    sessionId: conversation.conversationId,
    status: operation.status,
    projectHint: project.displayName,
    sourceConversationId: params.chiefConversationId,
    sourceCallId: params.callId,
  })
  return operation
}

export async function sendMessageToConversation(params: {
  userId: string
  conversationId: string
  message: string
  chiefConversationId: string
  callId: string
  completionNotifyMode?: VoiceTaskCompletionNotifyMode
}): Promise<VoiceChiefOperationStatus> {
  const message = params.message.trim()
  if (!message) return { status: 'failed', message: '发送内容为空。' }
  const conversation = await loadConversation(params.userId, params.conversationId)
  if (!conversation)
    return {
      status: 'failed',
      message: '会话不存在或不属于当前用户。',
      conversationId: params.conversationId,
    }
  const { result } = await sendToConversation({
    conversation,
    text: message,
    clientMessageId: `voice-shennian-${params.chiefConversationId}-${params.callId}`,
  })
  await maybeRegisterCompletionCall({
    mode: params.completionNotifyMode,
    userId: params.userId,
    sessionId: conversation.conversationId,
    status: result.status,
    projectHint: displayProjectName(conversation.workDir),
    sourceConversationId: params.chiefConversationId,
    sourceCallId: params.callId,
  })
  return result
}

export async function stopConversation(params: {
  userId: string
  conversationId: string
  reason?: string | null
}): Promise<VoiceChiefOperationStatus> {
  const conversation = await loadConversation(params.userId, params.conversationId)
  if (!conversation)
    return {
      status: 'failed',
      message: '会话不存在或不属于当前用户。',
      conversationId: params.conversationId,
    }
  if (conversation.machineStatus === 'offline') {
    return {
      status: 'unavailable',
      message: `${conversation.machineName} 当前离线，无法停止该会话。`,
      conversationId: conversation.conversationId,
      conversationTitle: conversation.title,
    }
  }
  const frame: Omit<ReqFrame, 'id'> = {
    type: 'req',
    method: 'chat.abort',
    params: {
      ...personalIdentity(conversation.daemonInstallationId),
      sessionId: conversation.conversationId,
      reason: params.reason ?? undefined,
    },
  }
  const res = await sendServerReqToMachine(conversation.machineId, frame, 10_000)
  if (!res.ok) {
    return {
      status: 'failed',
      message: res.error || '停止失败。',
      conversationId: conversation.conversationId,
      conversationTitle: conversation.title,
    }
  }
  return {
    status: 'stopped',
    message: `已请求停止 ${conversation.title}。`,
    conversationId: conversation.conversationId,
    conversationTitle: conversation.title,
  }
}

export function hangUpVoiceCall(params: { reason?: string | null } = {}) {
  return {
    status: 'ended' as const,
    message: params.reason?.trim() || '通话已结束。',
    reason: params.reason?.trim() || undefined,
  }
}

export function voiceChiefCallId(): string {
  return randomUUID()
}
