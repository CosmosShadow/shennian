// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-chat-queue-1.test.ts
import { isInternalSession, type AgentType, type SessionMode } from '@shennian/wire'
import { createHash } from 'node:crypto'
import type { AgentSendContext } from '../../agents/adapter.js'
import type { ManagedRoomPromptSnapshot } from '../../room/managed-prompt-composer.js'
import type { CompiledManagedAgentPolicy } from '../../security/managed-agent-policy.js'
import { listSessionRecords, recordSession } from '../store.js'
import type { SessionManagerRuntime } from '../types.js'

export type ChatSendExecutionContext =
  | (AgentSendContext & {
      source: 'room_activation'
      /** Local-only snapshot produced by RoomActivationService; never accepted from Relay input. */
      managedAgentPolicy: CompiledManagedAgentPolicy
      managedRoomPromptSnapshot: ManagedRoomPromptSnapshot
    })
  | {
      /** A Worker event may reuse the Room's current permission ceiling, but it
       * is a private Manager continuation and must never receive Room tools. */
      source: 'manager_event'
      /** Trusted local preparation only; no token or Room tools are allowed. */
      standalone?: true
      managedAgentPolicy: CompiledManagedAgentPolicy
      managedRoomPolicyVersion: string
      managedRuntimePolicyHash: string | null
    }

export function validateManagedRoomExecutionContext(
  context: ChatSendExecutionContext,
  systemPrompt: string | null | undefined,
  managedRoomContextToken: string | null | undefined,
): void {
  if (context.source !== 'room_activation') {
    throw new Error('managed_room_execution_context_required')
  }
  if (!context.managedAgentPolicy) throw new Error('managed_agent_policy_missing')
  const snapshot = context.managedRoomPromptSnapshot
  if (!snapshot) throw new Error('managed_room_prompt_snapshot_missing')
  if (!systemPrompt?.trim()) throw new Error('managed_room_prompt_incomplete')
  if (!managedRoomContextToken || !/^mrc_[A-Za-z0-9_-]{43}$/.test(managedRoomContextToken)) {
    throw new Error('managed_room_context_unavailable')
  }
  const policyHash = createHash('sha256')
    .update(
      JSON.stringify({
        requestedPolicy: context.managedAgentPolicy.requestedPolicy,
        enforcement: context.managedAgentPolicy.enforcement,
      }),
    )
    .digest('hex')
  const workDirHash = createHash('sha256')
    .update(context.managedAgentPolicy.adapterPolicy.workDir)
    .digest('hex')
  if (
    snapshot.runtimePermissionPolicyHash !== policyHash ||
    snapshot.resolvedWorkDirHash !== workDirHash ||
    snapshot.enforcementLevel !== context.managedAgentPolicy.enforcement.level
  ) {
    throw new Error('managed_room_prompt_snapshot_mismatch')
  }
}

export function sendSessionUpdateEvent(
  runtime: SessionManagerRuntime,
  input: {
    sessionId: string
    agentType: AgentType
    sessionMode?: SessionMode
    managerConfig?: import('@shennian/wire').ManagerConfig | null
    workDir: string
    agentSessionId?: string | null
    modelId?: string
    managerDefaultWorkerAgentType?: AgentType | null
    managerDefaultWorkerModelId?: string | null
  },
): void {
  const record = recordSession({
    sessionId: input.sessionId,
    agentType: input.agentType,
    sessionMode: input.sessionMode,
    managerConfig: input.managerConfig,
    workDir: input.workDir,
    agentSessionId: input.agentSessionId ?? null,
    modelId: input.modelId ?? null,
    managerDefaultWorkerAgentType: input.managerDefaultWorkerAgentType,
    managerDefaultWorkerModelId: input.managerDefaultWorkerModelId,
  })
  runtime.client.sendEvent({
    type: 'event',
    event: 'session.update',
    payload: {
      session: {
        id: input.sessionId,
        agentType: input.agentType,
        nativeSessionVisibility: record.nativeSessionVisibility,
        sessionMode: input.sessionMode,
        managerConfig: input.managerConfig,
        agentSessionId: input.agentSessionId ?? null,
        modelId: input.modelId ?? null,
        workDir: input.workDir,
        status: 'active',
        externalChannel: null,
      },
    },
  })
}

export function resolveNativeSessionVisibility(sessionId: string, agentType: AgentType,
  sessionMode: SessionMode, managed: boolean): 'user' | 'internal' {
  const previous = listSessionRecords().find((record) => record.sessionId === sessionId)
  return managed || isInternalSession({ ...previous, id: sessionId }) || isInternalSession({ id: sessionId, agentType, sessionMode,
    nativeSessionVisibility: previous?.nativeSessionVisibility }) ? 'internal' : 'user'
}
