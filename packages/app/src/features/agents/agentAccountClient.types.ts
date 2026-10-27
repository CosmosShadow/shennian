// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type { AgentWorkspace, NianSession } from '@shennian/wire'

export type AgentAccountClient = {
  listAgents(): Promise<AgentWorkspace[]>
  getAgent(agentId: string): Promise<AgentWorkspace>
  createAgent(definition: unknown): Promise<AgentWorkspace>
  updateAgent(agentId: string, changes: unknown): Promise<AgentWorkspace>
  deleteAgent(agentId: string): Promise<void>
  setAgentAvatar(
    agentId: string,
    image: Blob,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  ): Promise<NonNullable<AgentWorkspace['avatar']>>
  removeAgentAvatar(agentId: string): Promise<void>
  recoverAgent(agentId: string): Promise<AgentWorkspace>
  configureAgentDraft<T>(transcript: string, draft: unknown): Promise<T>
}

/** Native owns its dispatch workflow; Desktop dispatch is one main-owned command. */
export type NativeAgentAccountClient = AgentAccountClient & {
  createRoomSession(agentId: string, assignmentIntentId: string): Promise<NianSession>
  createConversationSession(agentId: string, creationIntentId: string): Promise<NianSession>
}

export function isAgentAccountNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; status?: unknown }
  return candidate.code === 'NOT_FOUND' || candidate.status === 404
}
