// @arch docs/features/desktop-personal-session-navigation.md
// @test src/__tests__/machine-feature-utils.test.ts

import type { AgentType, SessionMode } from '@shennian/wire'

export type SessionLaunchPayload = {
  machineId: string
  agentType: AgentType
  workDir: string
  modelId?: string
  sessionMode: SessionMode
  managerConfig?: {
    defaultWorkerAgentType?: AgentType | null
    defaultWorkerModelId?: string | null
  }
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
}

export function buildSessionLaunchPayload(input: {
  machineId: string
  agentType: AgentType
  workDir: string
  modelId?: string | null
  sessionMode: SessionMode
}): SessionLaunchPayload {
  const machineId = input.machineId.trim()
  const workDir = input.workDir.trim()
  if (!machineId || !workDir) throw new Error('project_context_required')

  const payload: SessionLaunchPayload = {
    machineId,
    agentType: input.agentType,
    workDir,
    sessionMode: input.sessionMode,
  }
  if (input.modelId) payload.modelId = input.modelId

  if (input.sessionMode === 'manager') {
    payload.managerConfig = {
      defaultWorkerAgentType: input.agentType,
      defaultWorkerModelId: input.modelId ?? null,
    }
    payload.managerDefaultWorkerAgentType = input.agentType
    payload.managerDefaultWorkerModelId = input.modelId ?? null
  }

  return payload
}
