// @arch docs/features/desktop-local-first-client.md#33-进程职责
import type { AgentType, NianSession } from '@shennian/wire'

export type SessionCreateInput = {
  machineId: string
  agentType: AgentType
  workDir: string
  modelId?: string
}

/** `agentType` is accepted for steward conversations only (they switch AI tool in place). */
export type SessionChanges = Partial<Pick<NianSession,
  'title' | 'modelId' | 'modelSource' | 'agentType'
  | 'managerDefaultWorkerAgentType' | 'managerDefaultWorkerModelId'
>>

export type SessionAccountClient = {
  getSession(sessionId: string): Promise<NianSession>
  createSession(input: SessionCreateInput): Promise<NianSession>
  updateSession(sessionId: string, changes: SessionChanges): Promise<void>
}
