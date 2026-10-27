// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts

export {
  getCachedAgentInfos,
  recordAcpAgentModels,
  refreshAgentInfos,
  resolveAgentInfos,
} from './model-registry/service.js'
import {
  applyClaudeModelEnvOverrides,
  discoverClaudeAliasModelsFromEnv,
  fallbackCodexModels,
  fallbackClaudeAliasModels,
  parseClaudeBinaryModels,
  parseClaudeModels,
  parseCodexModels,
  parseCodexAppServerModels,
  parseCursorModels,
  parseGeminiModels,
  parseOpenClawModels,
  stripAnsi,
} from './model-registry/parsers.js'

/** Used by Vitest / `model-switching-e2e.ts` — not a stable public API. */
export const modelSwitchingTestExports = {
  applyClaudeModelEnvOverrides,
  discoverClaudeAliasModelsFromEnv,
  fallbackCodexModels,
  fallbackClaudeAliasModels,
  parseClaudeBinaryModels,
  parseClaudeModels,
  parseCodexModels,
  parseCodexAppServerModels,
  parseCursorModels,
  parseOpenClawModels,
  parseGeminiModels,
  stripAnsi,
} as const
