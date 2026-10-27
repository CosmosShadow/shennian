// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-model-gateway.test.ts
import { getDeploymentMode } from './instance-settings.js'
/** Preserve official defaults; self-hosting never enables the official gateway implicitly. */
export function builtinPersonalAgentEnabled(): boolean {
  if (getDeploymentMode() === 'self-hosted') return process.env.SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED === 'true'
  return process.env.SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED !== 'false'
}
