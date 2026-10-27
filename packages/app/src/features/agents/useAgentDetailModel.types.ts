// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
import type { AgentWorkspace } from '@shennian/wire'

export interface AgentDetailModelOptions {
  accountId: string | null
  agentId: string
  onUnavailable(): void
}
export interface AgentDetailModel {
  agent: AgentWorkspace | null
  repairing: boolean
  failed: boolean
  refresh(): Promise<void>
  repair(): Promise<void>
  isCurrent(): boolean
}
