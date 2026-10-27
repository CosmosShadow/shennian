// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-capabilities.test.ts

import type { AgentCapabilitiesListPayload, ReqFrame } from '@shennian/wire'
import { isNativeCapabilityProvider, listAgentNativeCapabilities } from '../../agents/native-capabilities.js'
import type { SessionManagerRuntime } from '../types.js'

export async function handleAgentCapabilitiesList(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const agentType = typeof req.params.agentType === 'string' ? req.params.agentType : ''
  const workDir = typeof req.params.workDir === 'string' ? req.params.workDir : process.cwd()
  const supported = isNativeCapabilityProvider(agentType)
  const payload: AgentCapabilitiesListPayload = {
    supported,
    agentType,
    capabilities: supported ? listAgentNativeCapabilities({ agentType, workDir }) : [],
  }
  runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload })
}
