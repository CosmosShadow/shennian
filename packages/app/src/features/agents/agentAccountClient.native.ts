// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/agent-account-client-platform-errors.test.ts

export { isAgentAccountNotFound } from './agentAccountClient.types'

import type { AgentWorkspace, NianSession } from '@shennian/wire'
import { authApi } from '../../config/api'
import type { NativeAgentAccountClient } from './agentAccountClient.types'

export const agentAccountClient: NativeAgentAccountClient = {
  async createConversationSession(agentId, creationIntentId) {
    return (await authApi<{ session: NianSession }>(
      `/agents/${encodeURIComponent(agentId)}/sessions`,
      { method: 'POST', body: JSON.stringify({ assignmentIntentId: creationIntentId }) },
    )).session
  },
  async createRoomSession(agentId, assignmentIntentId) {
    return (await authApi<{ session: NianSession }>(
      `/agents/${encodeURIComponent(agentId)}/sessions`,
      { method: 'POST', body: JSON.stringify({ assignmentIntentId }) },
    )).session
  },
  async listAgents() {
    return (await authApi<{ agents: AgentWorkspace[] }>('/agents')).agents
  },
  async getAgent(agentId) {
    return (await authApi<{ agent: AgentWorkspace }>(`/agents/${agentId}`)).agent
  },
  async createAgent(definition) {
    return (await authApi<{ agent: AgentWorkspace }>('/agents', {
      method: 'POST',
      body: JSON.stringify(definition),
    })).agent
  },
  async updateAgent(agentId, changes) {
    return (await authApi<{ agent: AgentWorkspace }>(`/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    })).agent
  },
  async deleteAgent(agentId) {
    await authApi(`/agents/${agentId}`, { method: 'DELETE' })
  },
  async setAgentAvatar(agentId, image, contentType) {
    return (await authApi<{ avatar: NonNullable<AgentWorkspace['avatar']> }>(
      `/agents/${agentId}/avatar`,
      { method: 'PUT', headers: { 'Content-Type': contentType }, body: image },
    )).avatar
  },
  async removeAgentAvatar(agentId) {
    await authApi(`/agents/${agentId}/avatar`, { method: 'DELETE' })
  },
  async recoverAgent(agentId) {
    return (await authApi<{ agent: AgentWorkspace }>(`/agents/${agentId}/recover`, {
      method: 'POST',
    })).agent
  },
  async configureAgentDraft<T>(transcript: string, draft: unknown) {
    return authApi<T>('/agents/configure-draft', {
      method: 'POST',
      body: JSON.stringify({ transcript, draft }),
    })
  },
}
