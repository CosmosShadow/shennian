// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test packages/app/src/__tests__/agent-list-account-state.test.ts

import type { AgentWorkspace } from '@shennian/wire'

export type AgentListAccountState = {
  accountId: string | null
  agents: AgentWorkspace[]
}

export function switchAgentListAccount(
  current: AgentListAccountState,
  accountId: string | null,
  snapshot: AgentWorkspace[] | null,
): AgentListAccountState {
  if (current.accountId === accountId) return current
  return { accountId, agents: snapshot ?? [] }
}

export function applyAgentListResult(
  current: AgentListAccountState,
  accountId: string | null,
  agents: AgentWorkspace[],
): AgentListAccountState {
  if (!accountId || current.accountId !== accountId) return current
  return { accountId, agents }
}

export function updateAgentListForAccount(
  current: AgentListAccountState,
  accountId: string | null,
  update: (agents: AgentWorkspace[]) => AgentWorkspace[],
): AgentListAccountState {
  if (!accountId || current.accountId !== accountId) return current
  return { accountId, agents: update(current.agents) }
}
