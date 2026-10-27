// @arch docs/features/agent-local-first-persistence.md#九写操作
import type { AgentWorkspace } from '@shennian/wire'

export type AgentEditorContext = {
  accountId: string
  agentId: string
  isCurrent(): boolean
  onAgent(agent: AgentWorkspace | null): void
  onError(error: unknown): void
}
export type AgentEditorModel = {
  start(): () => void
  retry(): Promise<void>
  save(draft: unknown): Promise<void>
  avatarChanged(agent: AgentWorkspace, avatar: AgentWorkspace['avatar']): Promise<void>
}
export type CreateAgentInput = {
  accountId: string
  draft: unknown
  isCurrent(): boolean
  uploadAvatar?: (agentId: string) => Promise<NonNullable<AgentWorkspace['avatar']>>
  onAvatarError(): void
}
export function assertAgentEditorCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error('agent_editor_context_changed')
}
