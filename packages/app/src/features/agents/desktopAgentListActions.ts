// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test packages/app/src/__tests__/agent-list-platform-model.test.ts
import type { AgentWorkspace } from '@shennian/wire'
import type { AgentAccountClient } from './agentAccountClient.types'
export function createDesktopAgentListActions(options: {
  isCurrent(): boolean
  client: Pick<AgentAccountClient, 'updateAgent' | 'deleteAgent'>
  onError(action: 'pin' | 'delete'): void
}) {
  const pending = new Map<string, symbol>()
  let active = true
  let generation = 0
  async function run(agent: AgentWorkspace, action: 'pin' | 'delete'): Promise<void> {
    if (!active || !options.isCurrent() || pending.has(agent.id)) return
    const epoch = generation
    const request = Symbol(agent.id)
    pending.set(agent.id, request)
    try {
      if (action === 'pin') await options.client.updateAgent(agent.id, { pinned: !agent.pinnedAt })
      else await options.client.deleteAgent(agent.id)
    } catch {
      if (active && epoch === generation && options.isCurrent()) options.onError(action)
    } finally {
      if (pending.get(agent.id) === request) pending.delete(agent.id)
    }
  }
  return {
    start: () => { active = true; generation += 1 },
    stop: () => { active = false; generation += 1; pending.clear() },
    togglePin: (agent: AgentWorkspace) => run(agent, 'pin'),
    remove: (agent: AgentWorkspace) => run(agent, 'delete'),
  }
}
