// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/agent-permissions.test.ts

import {
  resolveManagedAgentPermissionPolicy,
  type AgentWorkspace,
  type ManagedAgentPermissionPolicy,
} from '@shennian/wire'

export type AgentWorkspaceWithPermissionPolicy = AgentWorkspace & {
  permissionPolicy: ManagedAgentPermissionPolicy
}

/**
 * Hydrate server or Local-first Agent projections without claiming that legacy,
 * policy-less payloads are restricted.
 */
export function normalizeAgentWorkspacePermissionPolicy(
  agent: AgentWorkspace,
): AgentWorkspaceWithPermissionPolicy {
  return {
    ...agent,
    permissionPolicy: resolveManagedAgentPermissionPolicy(agent.permissionPolicy, 'legacy'),
  }
}
