// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
import type { AgentType, ChatEnqueueParams, SessionMode, ManagerConfig } from '@shennian/wire'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import type { ManagedRoomPromptSnapshot } from '../room/managed-prompt-composer.js'
import type { ManagedRoomAction } from '../room/managed-context.js'
import type { ManagedWorkerRoomOrigin } from '../manager/registry.js'
export type PreparedManagedTurnContext = {
  /** Daemon-resolved owner conversation with no Room capability. Never read from wire input. */
  standalone?: true
  agentType: AgentType
  /** Trusted status lookup at the turn boundary; undefined preserves old-server fallback. */
  effectiveModelId?: string | null
  workDir: string
  agentSessionId: string
  systemPrompt: string
  sessionMode: SessionMode
  managerConfig: ManagerConfig | null
  managerDefaultWorkerAgentType: AgentType | null
  managerDefaultWorkerModelId: string | null
  roomContextRegistryKey: string
  managedRoomContextToken: string
  managedAgentPolicy: CompiledManagedAgentPolicy
  managedRoomPromptSnapshot: ManagedRoomPromptSnapshot
}
/** @deprecated Compatibility name for callers migrated incrementally. */
export type PreparedManagedRoomTurn = PreparedManagedTurnContext
export type ManagedAgentDirectTurnOptions = {
  roomOrigin?: ManagedWorkerRoomOrigin
  allowedRoomActions?: ManagedRoomAction[]
  /** Defaults to true; Owner private turns set false. */
  propagateWorkerRoomOrigin?: boolean
  managerEvent?: boolean
  /** Trusted Server schedule delivery, not an Owner chat request. */
  scheduledTask?: boolean
}
export type ManagedAgentDirectTurnPreparer = (
  sessionId: string,
  options?: ManagedAgentDirectTurnOptions,
) => Promise<PreparedManagedRoomTurn | null>
export type ManagedRoomEnqueueParams = Omit<
  ChatEnqueueParams,
  'protocolVersion' | 'dataEpoch' | 'daemonInstallationId'
> & {
  /** Original authoritative Room timestamp; never accepted from App chat.enqueue. */
  roomMessageCreatedAt?: string
}
