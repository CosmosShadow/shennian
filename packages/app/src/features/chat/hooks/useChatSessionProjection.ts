// @arch docs/architecture/app/modular-features.md#聊天-feature

import { useMemo } from 'react'
import { filterManagerSubstrateSessions } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'

export function useChatSessionProjection(sessions: NianSession[], workDir: string) {
  return useMemo(
    () =>
      filterManagerSubstrateSessions(sessions)
        .filter((item) => item.workDir === workDir && item.agentType !== 'manager')
        .slice(0, 80)
        .map((item) => ({
          id: item.id,
          machineId: item.machineId,
          userId: item.userId,
          agentType: item.agentType,
          agentSessionId: item.agentSessionId,
          modelId: item.modelId,
          managerDefaultWorkerAgentType: item.managerDefaultWorkerAgentType,
          managerDefaultWorkerModelId: item.managerDefaultWorkerModelId,
          title: item.title,
          status: item.status,
          workDir: item.workDir,
          lastMessagePreview: item.lastMessagePreview,
          lastActivityAt: item.lastActivityAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          deletedAt: item.deletedAt,
          machineName: item.machineName,
          ownerName: item.ownerName,
          ownerPhone: item.ownerPhone,
          ownerEmail: item.ownerEmail,
          canManage: item.canManage,
          sharedMachineSession: item.sharedMachineSession,
          activity: item.activity,
          externalChannel: item.externalChannel,
        })),
    [sessions, workDir],
  )
}
