// @arch docs/features/agent-workspaces.md#二智能体
// @test packages/app/src/__tests__/agent-list-cache.test.ts

import type { AgentWorkspace } from '@shennian/wire'

const snapshots = new Map<string, AgentWorkspace[]>()
const listeners = new Set<() => void>()

export function getAgentListSnapshot(accountId: string | null): AgentWorkspace[] | null {
  return accountId ? (snapshots.get(accountId) ?? null) : null
}

export function setAgentListSnapshot(accountId: string | null, agents: AgentWorkspace[]): void {
  if (!accountId) return
  snapshots.set(accountId, agents)
  for (const listener of listeners) listener()
}

export function subscribeAgentListSnapshots(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearAgentListSnapshots(): void {
  snapshots.clear()
  for (const listener of listeners) listener()
}
