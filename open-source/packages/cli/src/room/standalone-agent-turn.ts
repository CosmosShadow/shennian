// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/standalone-agent-turn.test.ts

import { createHash } from 'node:crypto'
import { isRoomRuntimeAdapter, type AgentWorkspace } from '@shennian/wire'
import { PublicAgentClient } from '../agents/public-agent-client.js'
import type { PreparedManagedRoomTurn } from '../session/queue-types.js'
import { resolveManagedAgentPolicy } from './activation-service.js'
import { buildManagedAgentPermissionPrompt, MANAGED_ROOM_POLICY_VERSION } from './managed-prompt-composer.js'

/** Resolve only server-owned, machine-scoped definitions, never enqueue parameters.
 * Repeated at enqueue, Provider dispatch and recovery so edits/deletions fail closed.
 * No registry entry, Room membership, Room token or Room tools are manufactured.
 */
export async function prepareStandaloneAgentTurn(
  sessionId: string,
  deps: {
    list: () => Promise<{ agents?: unknown }>
    resolvePolicy: typeof resolveManagedAgentPolicy
  } = { list: () => new PublicAgentClient().list(), resolvePolicy: resolveManagedAgentPolicy },
): Promise<PreparedManagedRoomTurn | null> {
  const response = await deps.list()
  if (!Array.isArray(response.agents)) throw new Error('managed_agent_context_unavailable')
  const agents = response.agents as AgentWorkspace[]
  const agent = agents.find((candidate) => candidate.sessions?.some((session) => session.id === sessionId))
  const session = agent?.sessions.find((candidate) => candidate.id === sessionId)
  if (!agent || !session) return null
  if (session.room || agent.status !== 'active' || session.status === 'failed' ||
      session.machineId !== agent.machineId || !agent.runtimeAdapter || !isRoomRuntimeAdapter(agent.runtimeAdapter) || !agent.workDir ||
      !agent.permissionPolicy) throw new Error('managed_agent_context_unavailable')
  const policy = await deps.resolvePolicy({
    registration: { runtimeAdapter: agent.runtimeAdapter },
    permissionPolicy: agent.permissionPolicy,
    permissionConfirmation: agent.permissionConfirmation ?? null,
    workDir: agent.workDir,
  })
  const systemPrompt = [
    '[神念自用智能体对话]\n这是创建者与智能体的私有对话，不属于任何群聊。没有群聊读取、发送或成员管理权限。不得猜测或展示内部标识或凭据。',
    buildManagedAgentPermissionPrompt({ requestedPolicy: policy.requestedPolicy,
      enforcement: policy.enforcement, resolvedWorkDir: policy.adapterPolicy.workDir }),
    agent.systemPrompt?.trim() ? `[智能体私有系统提示词]\n${agent.systemPrompt.trim()}` : '',
  ].filter(Boolean).join('\n\n')
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const sessionMode = agent.sessionMode === 'manager' ? 'manager' : 'standard'
  const managerConfig = sessionMode === 'manager' ? agent.managerConfig : null
  return {
    standalone: true,
    agentType: agent.runtimeAdapter,
    effectiveModelId: session.modelId ?? agent.modelId,
    workDir: policy.adapterPolicy.workDir,
    // Queue dispatch resolves this placeholder from the daemon's own native record.
    agentSessionId: `managed:${sessionId}`,
    systemPrompt,
    sessionMode,
    managerConfig,
    managerDefaultWorkerAgentType: managerConfig?.defaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: managerConfig?.defaultWorkerModelId ?? null,
    roomContextRegistryKey: '',
    managedRoomContextToken: '',
    managedAgentPolicy: policy,
    managedRoomPromptSnapshot: {
      agentConfigurationVersion: agent.configurationVersion,
      providerBaseVersion: 'provider-owned',
      managedRoomPolicyVersion: MANAGED_ROOM_POLICY_VERSION,
      sessionModeInstructionsHash: null,
      agentSystemPromptHash: agent.systemPrompt ? hash(agent.systemPrompt) : null,
      runtimePermissionPolicyHash: hash(JSON.stringify({ requestedPolicy: policy.requestedPolicy, enforcement: policy.enforcement })),
      resolvedWorkDirHash: hash(policy.adapterPolicy.workDir),
      enforcementLevel: policy.enforcement.level,
      trustedRoomContextHash: hash(''),
      allowedRoomOperations: [],
    },
  }
}
