// @arch docs/features/agent-workspaces.md#四信息架构
// @test packages/app/src/__tests__/agent-workspaces-navigation.test.ts

import type { AgentWorkspace } from '@shennian/wire'
import { db } from '../../storage/db.native'
import { agentAccountClient } from './agentAccountClient.native'
import { getAgentListSnapshot, setAgentListSnapshot } from './agentListCache'

/**
 * Account-level Agent deletion for native surfaces.
 *
 * The remote deletion must commit before any local projection is removed so a
 * retryable failure never makes the Agent disappear from the device.
 */
export async function deleteAgentWorkspace(
  accountId: string,
  agent: AgentWorkspace,
): Promise<void> {
  await agentAccountClient.deleteAgent(agent.id)
  await Promise.all([
    db.removeAgent(accountId, agent.id),
    ...agent.sessions.map((session) => db.deleteSession(session.id)),
  ])
  const snapshot = getAgentListSnapshot(accountId)
  if (snapshot) {
    setAgentListSnapshot(accountId, snapshot.filter((item) => item.id !== agent.id))
  }
}
