// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test packages/app/src/__tests__/agent-detail-account-state.test.ts

import type { AgentWorkspace } from '@shennian/wire'

export type AgentDetailAccountState = {
  accountId: string | null
  agentId: string
  agent: AgentWorkspace | null
}

export function switchAgentDetailAccount(
  current: AgentDetailAccountState,
  accountId: string | null,
  agentId: string,
): AgentDetailAccountState {
  if (current.accountId === accountId && current.agentId === agentId) return current
  return { accountId, agentId, agent: null }
}

export function applyAgentDetailResult(
  current: AgentDetailAccountState,
  accountId: string | null,
  agentId: string,
  agent: AgentWorkspace,
): AgentDetailAccountState {
  if (!accountId || current.accountId !== accountId || current.agentId !== agentId) return current
  return { accountId, agentId, agent }
}

export function updateAgentDetailForAccount(
  current: AgentDetailAccountState,
  accountId: string | null,
  agentId: string,
  update: (agent: AgentWorkspace) => AgentWorkspace,
): AgentDetailAccountState {
  if (
    !accountId ||
    current.accountId !== accountId ||
    current.agentId !== agentId ||
    !current.agent
  )
    return current
  return { accountId, agentId, agent: update(current.agent) }
}
