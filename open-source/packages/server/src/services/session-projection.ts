// @arch open-source/docs/server-runtime.md
// @test src/__tests__/sessions-messages.test.ts
import {
  SESSION_SYNC_DATA_EPOCH,
  type NianSession,
  type SessionActivitySnapshot,
  type SessionUserState,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'

export const BASE_SESSION_SELECT = {
  id: true,
  agentIdentityId: true,
  machineId: true,
  userId: true,
  agentType: true,
  sessionMode: true,
  nativeSessionVisibility: true,
  sessionScope: true,
  managerConfig: true,
  agentSessionId: true,
  roomNativeSources: {
    orderBy: { updatedAt: 'desc' as const },
    take: 1,
    select: { sourceMode: true },
  },
  externalBindings: {
    where: { provider: { in: ['wecom', 'feishu'] as string[] }, status: 'active' },
    take: 1,
    select: {
      id: true,
      provider: true,
      allowSend: true,
      systemPrompt: true,
      conversation: {
        select: { name: true },
      },
      feishuConversation: {
        select: { name: true },
      },
    },
  },
  wechatChannelBindings: {
    where: { enabled: true },
    orderBy: { updatedAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      machineId: true,
      conversationDisplayName: true,
      allowReply: true,
      downloadMedia: true,
    },
  },
  modelId: true,
  modelSource: true,
  agentIdentity: {
    select: { ownerUserId: true, modelId: true, systemPrompt: true },
  },
  managerDefaultWorkerAgentType: true,
  managerDefaultWorkerModelId: true,
  title: true,
  titleSource: true,
  titleRevision: true,
  titleLockedByUser: true,
  titleOriginEventId: true,
  status: true,
  workDir: true,
  lastMessagePreview: true,
  lastMessagePreviewMessageId: true,
  lastMessagePreviewAt: true,
  lastVisibleEventAt: true,
  bodyStorageMode: true,
  localReadyAt: true,
  bodyRevision: true,
  indexRevision: true,
  dataEpoch: true,
  firstAvailableSeq: true,
  visibleMessageCount: true,
  lastVisibleMessageId: true,
  attentionCount: true,
  lastAttentionId: true,
  lastBodyCommittedAt: true,
  deletionRevision: true,
  lastActivityAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export const USER_STATE_SELECT = {
  userId: true,
  sessionId: true,
  pinnedAt: true,
  lastReadAt: true,
  lastReadBodyRevision: true,
  lastReadVisibleMessageCount: true,
  lastReadVisibleMessageId: true,
  lastReadAttentionCount: true,
  lastReadAttentionId: true,
  manualUnread: true,
  updatedAt: true,
} as const

export type SessionRecord = {
  id: string
  agentIdentityId: string | null
  machineId: string
  userId: string
  agentType: string
  sessionMode: string
  nativeSessionVisibility?: string
  sessionScope?: string
  managerConfig: unknown
  agentSessionId: string | null
  roomNativeSources: Array<{
    sourceMode: string
  }>
  externalBindings?: Array<{
    id: string
    provider: string
    allowSend: boolean
    systemPrompt: string | null
    conversation: {
      name: string
    } | null
    feishuConversation: {
      name: string
    } | null
  }>
  wechatChannelBindings?: Array<{
    id: string
    machineId: string
    conversationDisplayName: string
    allowReply: boolean
    downloadMedia: boolean
  }>
  modelId: string | null
  modelSource: string
  agentIdentity?: {
    ownerUserId: string | null
    modelId: string | null
    systemPrompt: string
  } | null
  managerDefaultWorkerAgentType: string | null
  managerDefaultWorkerModelId: string | null
  title: string
  titleSource: string
  titleRevision: number
  titleLockedByUser: boolean
  titleOriginEventId: string | null
  status: string
  workDir: string
  lastMessagePreview: string | null
  lastMessagePreviewMessageId: string | null
  lastMessagePreviewAt: Date | null
  lastVisibleEventAt: Date | null
  bodyStorageMode: string
  localReadyAt: Date | null
  bodyRevision: number
  indexRevision: number
  firstAvailableSeq: number | null
  visibleMessageCount: number
  lastVisibleMessageId: string | null
  attentionCount: number
  lastAttentionId: string | null
  lastBodyCommittedAt: Date | null
  deletionRevision: number
  lastActivityAt: Date
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  userStates: Array<{
    userId: string
    sessionId: string
    pinnedAt: Date | null
    lastReadAt: Date | null
    lastReadBodyRevision: number
    lastReadVisibleMessageCount: number
    lastReadVisibleMessageId: string | null
    lastReadAttentionCount: number
    lastReadAttentionId: string | null
    manualUnread: boolean
    updatedAt: Date
  }>
}

export type SessionDeletionRecord = {
  sessionId: string
  machineId: string
  userId: string
  deletedAt: Date
  deletionRevision?: number
}

export type NativeSourceDeletionInput = {
  agentType: string
  sourceSessionKey: string
}

export type SessionUpdatePatch = {
  id: string
  updatedAt: Date
  lastActivityAt?: Date
  lastMessagePreview?: string | null
  lastMessagePreviewMessageId?: string | null
  lastMessagePreviewAt?: Date | null
  lastVisibleEventAt?: Date | null
  title?: string
  titleSource?: NianSession['titleSource']
  titleRevision?: number
  titleLockedByUser?: boolean
  titleOriginEventId?: string | null
  modelId?: string | null
  modelSource?: 'agent' | 'session'
  agentDefaultModelId?: string | null
  agentSystemPrompt?: string | null
  managerDefaultWorkerAgentType?: string | null
  managerDefaultWorkerModelId?: string | null
  agentType?: string
  agentSessionId?: string | null
  sourceMode?: NianSession['sourceMode']
  status?: string
  workDir?: string
  deletedAt?: Date | null
}

export function buildSessionSelect(userId: string) {
  return {
    ...BASE_SESSION_SELECT,
    userStates: {
      where: { userId },
      take: 1,
      select: USER_STATE_SELECT,
    },
  }
}

export async function getManagerAgentSessionIds(machineIds: string[]): Promise<string[]> {
  if (machineIds.length === 0) return []
  const managers = await prisma.nianSession.findMany({
    where: {
      machineId: { in: machineIds },
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      deletedAt: null,
      OR: [
        { sessionMode: 'manager' },
        { agentType: 'manager' },
        { nativeSessionVisibility: 'internal' },
        { sessionScope: 'steward' },
      ],
      agentSessionId: { not: null },
    },
    select: { agentSessionId: true },
  })
  return [
    ...new Set(
      managers.map((session) => session.agentSessionId).filter((id): id is string => Boolean(id)),
    ),
  ]
}

export function buildOrdinarySessionWhere(
  machineFilter: { machineId: string } | { machineId: { in: string[] } },
  managerAgentSessionIds: string[],
  extra: Record<string, unknown> = {},
  options: { includeProjectWorkers?: boolean } = {},
): Record<string, unknown> {
  const hiddenSessionFilters: Record<string, unknown>[] = [
    { sessionScope: 'steward' },
    { sessionMode: 'manager' },
    { agentType: 'manager' },
    { agentIdentityId: { not: null } },
  ]

  if (options.includeProjectWorkers) {
    hiddenSessionFilters.push({
      AND: [
        { nativeSessionVisibility: 'internal' },
        { id: { not: { startsWith: 'sess_worker_' } } },
      ],
    })
  } else {
    hiddenSessionFilters.unshift(
      { id: { startsWith: 'sess_worker_' } },
      { nativeSessionVisibility: 'internal' },
    )
  }

  if (managerAgentSessionIds.length > 0) {
    hiddenSessionFilters.push({
      AND: [
        { agentType: { not: 'manager' } },
        { sessionMode: { not: 'manager' } },
        ...(options.includeProjectWorkers
          ? [{ id: { not: { startsWith: 'sess_worker_' } } }]
          : []),
      ],
      // NULL native IDs belong to queued/unstarted tasks. Guard before negating IN:
      // SQL NOT(NULL IN (...)) would otherwise hide those legitimate sessions.
      agentSessionId: { not: null, in: managerAgentSessionIds },
    })
  }

  return {
    ...machineFilter,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    ...extra,
    NOT: hiddenSessionFilters,
  }
}

export function serializeUserState(
  userState: SessionRecord['userStates'][number] | null | undefined,
): SessionUserState | null {
  if (!userState) return null
  return {
    userId: userState.userId,
    sessionId: userState.sessionId,
    pinnedAt: userState.pinnedAt?.toISOString() ?? null,
    lastReadAt: userState.lastReadAt?.toISOString() ?? null,
    lastReadBodyRevision: userState.lastReadBodyRevision,
    lastReadVisibleMessageCount: userState.lastReadVisibleMessageCount,
    lastReadVisibleMessageId: userState.lastReadVisibleMessageId,
    lastReadAttentionCount: userState.lastReadAttentionCount,
    lastReadAttentionId: userState.lastReadAttentionId,
    manualUnread: userState.manualUnread,
    updatedAt: userState.updatedAt.toISOString(),
  }
}

export function serializeSession(
  session: SessionRecord,
  machineName: string | null,
  activity: SessionActivitySnapshot | null,
  viewerUserId: string,
  owner: { name: string; phone: string | null; email: string | null } | null,
): NianSession {
  const externalBinding = session.externalBindings?.[0] ?? null
  const wechatBinding = session.wechatChannelBindings?.[0] ?? null
  const canManage = session.userId === viewerUserId
  const ownedAgent =
    canManage && session.agentIdentity?.ownerUserId === viewerUserId ? session.agentIdentity : null
  return {
    id: session.id,
    agentIdentityId: session.agentIdentityId,
    nativeSessionVisibility: session.nativeSessionVisibility === 'internal' ? 'internal' : 'user',
    sessionScope: session.sessionScope === 'steward' ? 'steward' : 'personal',
    machineId: session.machineId,
    userId: session.userId,
    agentType: session.agentType as NianSession['agentType'],
    sessionMode:
      session.agentType === 'manager'
        ? 'manager'
        : session.sessionMode === 'manager'
          ? 'manager'
          : 'standard',
    managerConfig: normalizeManagerConfig(
      session.managerConfig,
      session.managerDefaultWorkerAgentType,
      session.managerDefaultWorkerModelId,
    ),
    agentSessionId: session.agentSessionId,
    sourceMode: session.roomNativeSources[0]?.sourceMode as NianSession['sourceMode'],
    modelId: session.modelId,
    modelSource: session.modelSource === 'agent' ? 'agent' : 'session',
    ...(ownedAgent
      ? {
          agentDefaultModelId: ownedAgent.modelId,
          agentSystemPrompt: ownedAgent.systemPrompt,
        }
      : {}),
    managerDefaultWorkerAgentType:
      session.managerDefaultWorkerAgentType as NianSession['managerDefaultWorkerAgentType'],
    managerDefaultWorkerModelId: session.managerDefaultWorkerModelId,
    title: session.title,
    titleSource: session.titleSource as NianSession['titleSource'],
    titleRevision: session.titleRevision,
    titleLockedByUser: session.titleLockedByUser,
    titleOriginEventId: session.titleOriginEventId,
    status: session.status as NianSession['status'],
    workDir: session.workDir ?? '',
    lastMessagePreview: session.lastMessagePreview,
    lastMessagePreviewMessageId: session.lastMessagePreviewMessageId,
    lastMessagePreviewAt: session.lastMessagePreviewAt?.toISOString() ?? null,
    lastVisibleEventAt: session.lastVisibleEventAt?.toISOString() ?? null,
    bodyStorageMode:
      session.bodyStorageMode === 'machine_local' ? 'machine_local' : undefined,
    localReady: session.localReadyAt != null,
    bodyRevision: session.bodyRevision,
    indexRevision: session.indexRevision,
    firstAvailableSeq: session.firstAvailableSeq,
    visibleMessageCount: session.visibleMessageCount,
    lastVisibleMessageId: session.lastVisibleMessageId,
    attentionCount: session.attentionCount,
    lastAttentionId: session.lastAttentionId,
    lastBodyCommittedAt: session.lastBodyCommittedAt?.toISOString() ?? null,
    deletionRevision: session.deletionRevision,
    lastActivityAt: session.lastActivityAt.toISOString(),
    deletedAt: session.deletedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    machineName,
    ownerName: owner?.name ?? null,
    ownerPhone: owner?.phone ?? null,
    ownerEmail: owner?.email ?? null,
    canManage,
    sharedMachineSession: !canManage,
    userState: serializeUserState(session.userStates[0]),
    activity,
    externalChannel: externalBinding
      ? {
          connected: true,
          configured: true,
          type: externalBinding.provider,
          channelId: externalBinding.id,
          name:
            externalBinding.conversation?.name ?? externalBinding.feishuConversation?.name ?? null,
          canReply: externalBinding.allowSend,
          systemPrompt: externalBinding.systemPrompt,
        }
      : wechatBinding
        ? {
            connected: true,
            configured: true,
            type: 'wechat-rpa',
            channelId: wechatBinding.id,
            machineId: wechatBinding.machineId,
            name: wechatBinding.conversationDisplayName,
            canReply: wechatBinding.allowReply,
            systemPrompt: null,
            wechatRpaSource: 'wechat-channel',
            wechatRpaGroups: [{ name: wechatBinding.conversationDisplayName }],
            downloadAttachments: wechatBinding.downloadMedia,
          }
        : null,
  }
}

export function normalizeManagerConfig(
  value: unknown,
  legacyAgentType: string | null,
  legacyModelId: string | null,
): NianSession['managerConfig'] {
  const object =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const defaultWorkerAgentType =
    typeof object.defaultWorkerAgentType === 'string'
      ? object.defaultWorkerAgentType
      : legacyAgentType
  const defaultWorkerModelId =
    typeof object.defaultWorkerModelId === 'string' ? object.defaultWorkerModelId : legacyModelId
  if (!defaultWorkerAgentType && !defaultWorkerModelId) return null
  return {
    defaultWorkerAgentType: defaultWorkerAgentType as NianSession['agentType'] | null,
    defaultWorkerModelId,
  }
}

export function serializeDeletedSession(
  deletion: SessionDeletionRecord,
  machineName: string | null,
): NianSession {
  const deletedAt = deletion.deletedAt.toISOString()
  return {
    id: deletion.sessionId,
    machineId: deletion.machineId,
    userId: deletion.userId,
    agentType: 'claude',
    sessionMode: 'standard',
    managerConfig: null,
    agentSessionId: null,
    sourceMode: null,
    modelId: null,
    managerDefaultWorkerAgentType: null,
    managerDefaultWorkerModelId: null,
    title: '',
    status: 'completed',
    workDir: '',
    lastMessagePreview: null,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    lastActivityAt: deletedAt,
    deletedAt,
    createdAt: deletedAt,
    updatedAt: deletedAt,
    machineName,
    userState: null,
    activity: null,
  }
}
