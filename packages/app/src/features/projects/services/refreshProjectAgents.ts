// @arch docs/architecture/launch-config.md#项目内启动面板
// @test src/__tests__/project-launch-entry.test.ts

import type { AgentInfo, AgentType, ResFrame } from '@shennian/wire'

export async function refreshProjectAgents(input: {
  machineId: string
  request: (machineId: string) => Promise<ResFrame>
  update: (machineId: string, agentList: AgentType[], agents: AgentInfo[]) => void
  failureMessage: string
}): Promise<void> {
  const response = await input.request(input.machineId)
  if (!response.ok) throw new Error(response.error ?? input.failureMessage)
  const payload = response.payload as { agentList?: AgentType[]; agents?: AgentInfo[] } | undefined
  if (!Array.isArray(payload?.agentList) || !Array.isArray(payload.agents)) {
    throw new Error(input.failureMessage)
  }
  input.update(input.machineId, payload.agentList, payload.agents)
}
