// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-adapter.test.ts

import type { AcpAgentType, AgentAuthState } from '@shennian/wire'

const runtimeStates = new Map<AcpAgentType, AgentAuthState>()

export function getAcpRuntimeAuthState(type: AcpAgentType): AgentAuthState | undefined {
  return runtimeStates.get(type)
}

export function setAcpRuntimeAuthState(type: AcpAgentType, state: AgentAuthState): void {
  runtimeStates.set(type, state)
}
