// @arch docs/features/desktop-local-first-client.md#33-进程职责
import type { AgentType, NianProject } from '@shennian/wire'

export type ProjectDefaults = {
  defaultAgentType: AgentType
  defaultModelId: string | null
}

export type ProjectAccountClient = {
  updateDefaults(projectId: string, defaults: ProjectDefaults): Promise<NianProject>
}
