// @arch docs/features/agent-provider-config.md
// @test src/__tests__/machine-feature-utils.test.ts

import type { AgentType } from '@shennian/wire'

export function isConfigurableAgent(agent: AgentType): agent is 'codex' | 'claude' {
  return agent === 'codex' || agent === 'claude'
}
