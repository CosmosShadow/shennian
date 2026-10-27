// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-workspaces.test.ts

import {
  isAvailableAgentType,
  type AgentType,
  type ManagerConfig,
  type SessionMode,
} from '@shennian/wire'
import { AgentWorkspaceError } from './agent-workspace-error.js'

export function normalizeSessionMode(
  value: unknown,
  fallback: SessionMode = 'standard',
): SessionMode {
  if (value === undefined) return fallback
  if (value === 'standard' || value === 'manager') return value
  throw new AgentWorkspaceError('invalid', 'sessionMode is invalid')
}

export function normalizeManagedAgentSessionMode(
  value: unknown,
  fallback: SessionMode = 'standard',
): SessionMode {
  return normalizeSessionMode(value, fallback)
}

export function normalizeManagerConfig(value: unknown): ManagerConfig | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentWorkspaceError('invalid', 'managerConfig is invalid')
  }
  const raw = value as Record<string, unknown>
  const workerType = raw.defaultWorkerAgentType
  const workerModel = raw.defaultWorkerModelId
  if (
    workerType !== undefined &&
    workerType !== null &&
    (typeof workerType !== 'string' ||
      !isAvailableAgentType(workerType) ||
      ['manager', 'pi', 'openclaw'].includes(workerType))
  ) {
    throw new AgentWorkspaceError('invalid', 'managerConfig.defaultWorkerAgentType is invalid')
  }
  if (workerModel !== undefined && workerModel !== null && typeof workerModel !== 'string') {
    throw new AgentWorkspaceError('invalid', 'managerConfig.defaultWorkerModelId is invalid')
  }
  return {
    defaultWorkerAgentType: (workerType as AgentType | null | undefined) ?? null,
    defaultWorkerModelId: typeof workerModel === 'string' ? workerModel.trim() || null : null,
  }
}
