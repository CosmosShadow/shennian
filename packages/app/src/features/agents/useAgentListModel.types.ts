// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
import type { AgentWorkspace } from '@shennian/wire'
import type { AgentListUiState } from './agentListUiState'
export type AgentListModel = {
  agents: AgentWorkspace[]
  listUiState: AgentListUiState
  load(): Promise<void>
  togglePin(agent: AgentWorkspace): Promise<void>
  remove(agent: AgentWorkspace): Promise<void>
}
