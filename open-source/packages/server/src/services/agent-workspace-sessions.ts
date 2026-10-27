// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-workspaces.test.ts
import { isAvailableAgentType, type NianSession } from '@shennian/wire'
import type { Prisma } from '../generated/prisma/client.js'
import type { createSessionForUser } from './sessions.js'
import { normalizeManagerConfig } from './agent-workspace-session-mode.js'

// Explicit Agent views include their owner's direct chats, not the global
// personal list. Internal Workers and steward runs remain hidden.
const standaloneContextWhere = {
  roomBinding: { is: null }, sessionScope: 'personal', creationKey: { not: null },
  NOT: { id: { startsWith: 'sess_worker_' } },
} satisfies Prisma.NianSessionWhereInput

export const AGENT_INCLUDE = {
  machine: { select: { id: true, name: true, paired: true, online: true } },
  sessions: {
    where: {
      deletedAt: null,
      OR: [{ roomBinding: { isNot: null } }, { nativeSessionVisibility: 'user' }, standaloneContextWhere],
    },
    orderBy: { lastActivityAt: 'desc' as const },
    include: {
      machine: { select: { name: true, paired: true, online: true } },
      roomBinding: {
        include: {
          machine: { select: { paired: true, online: true } },
          room: { select: { id: true, name: true, status: true } },
          agentMembership: { select: { status: true } },
        },
      },
    },
  },
} satisfies Prisma.AgentIdentityInclude

export function isOwnerStandaloneContext(session: {
  id: string; sessionScope: string; creationKey: string | null; roomBinding: unknown
}): boolean {
  return !session.roomBinding && session.sessionScope === 'personal'
    && Boolean(session.creationKey) && !session.id.startsWith('sess_worker_')
}

export function serializeCreatedSession(
  session: Awaited<ReturnType<typeof createSessionForUser>>,
): NianSession {
  return {
    id: session.id,
    agentIdentityId: session.agentIdentityId,
    machineId: session.machineId,
    machineName: session.machineName ?? null,
    userId: session.userId,
    agentType: isAvailableAgentType(session.agentType) ? session.agentType : 'codex',
    sessionMode: session.sessionMode === 'manager' ? 'manager' : 'standard',
    managerConfig: normalizeManagerConfig(session.managerConfig),
    agentSessionId: session.agentSessionId,
    sourceMode: null,
    modelId: session.modelId,
    managerDefaultWorkerAgentType: isAvailableAgentType(session.managerDefaultWorkerAgentType ?? '')
      ? (session.managerDefaultWorkerAgentType as NianSession['managerDefaultWorkerAgentType'])
      : null,
    managerDefaultWorkerModelId: session.managerDefaultWorkerModelId,
    title: session.title,
    status:
      session.status === 'completed' || session.status === 'failed' ? session.status : 'active',
    workDir: session.workDir,
    lastMessagePreview: session.lastMessagePreview,
    lastActivityAt: session.lastActivityAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    deletedAt: session.deletedAt?.toISOString() ?? null,
    ownerName: null,
    ownerPhone: null,
    ownerEmail: null,
    canManage: true,
    sharedMachineSession: false,
    userState: null,
    activity: null,
  }
}
