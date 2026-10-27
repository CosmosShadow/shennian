// @arch docs/features/desktop-local-first-client.md#33-进程职责
import type { AgentWorkspace } from '@shennian/wire'
import type { AgentListUiState } from './agentListUiState'
export type AgentSidebarModel = { agents: AgentWorkspace[]; state: AgentListUiState; retry(): Promise<void> }
