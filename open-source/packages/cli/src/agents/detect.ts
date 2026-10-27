import { personalModelSummary } from '../personal-agent/model-settings.js'
// @arch open-source/docs/cli-runtime.md
import { normalizeAgentModels } from './model-values.js'
import { probeBuiltinAuthStatus } from './auth-status.js'
import {
  AVAILABLE_BUILTIN_AGENT_TYPES,
  type AgentType,
  type BuiltinAgentType,
  type CustomAgentType,
  type ModelInfo,
  type AgentIntegration,
  type AgentDisplayMetadata,
  type AcpCapabilitySummary,
  type AgentAuthState,
  type AcpAuthMethodSummary,
} from '@shennian/wire'
import { loadConfig } from '../config/index.js'
import { getBuiltinAgentVersion, resolveBuiltinCommand } from './command-spec.js'
import {
  registerCustomRuntimeSecurity,
  resolveCustomRuntimeExecutableFingerprint,
} from './custom-managed-runtime.js'
import { resolveManagedAgentExecutableIdentity } from '../security/managed-agent-executable.js'
import { discoverAcpAgents } from './acp/discovery.js'
import { listNodeAdapters, type NodeAdapterRegistration } from '../adapter-kit/registry.js'
import { syncNodeAdapterAgents } from './node-adapter.js'

export type DetectedAgent = {
  type: AgentType
  command: string
  args: string[]
  version?: string
  runtimePlatform?: NodeJS.Platform
  runtimeIsWsl?: boolean
  executableFingerprint?: string
  models?: ModelInfo[]
  integration?: AgentIntegration
  display?: AgentDisplayMetadata
  acpCapabilities?: AcpCapabilitySummary
  authState?: AgentAuthState
  acpAuthMethods?: AcpAuthMethodSummary[]
  catalogRevision?: string
  /** Local-only V1 registration used to refresh listModels through Runtime. */
  nodeAdapter?: NodeAdapterRegistration
}

const AGENTS: BuiltinAgentType[] = AVAILABLE_BUILTIN_AGENT_TYPES.filter(
  (agent): agent is Exclude<(typeof AVAILABLE_BUILTIN_AGENT_TYPES)[number], 'pi'> =>
    agent !== 'pi' && agent !== 'shennian',
)

function versionAtLeast(actual: string | undefined, minimum: readonly number[]): boolean {
  const match = actual?.match(/(?:^|v)(\d+)\.(\d+)\.(\d+)/)
  if (!match) return false
  const parts = match.slice(1, 4).map(Number)
  for (let index = 0; index < minimum.length; index += 1) {
    if (parts[index] === minimum[index]) continue
    return parts[index]! > minimum[index]!
  }
  return true
}

export function isPiCodingAgentRuntimeCompatible(
  piVersion: string | undefined,
): boolean {
  // getBuiltinAgentVersion executes the resolved `pi` launcher itself. That
  // launcher may deliberately select a user-scoped Node runtime newer than
  // the Node process hosting Shennian (notably on Windows). If `pi --version`
  // succeeds, gate on the Pi protocol line; checking process.versions.node
  // here would reject a working isolated launcher for the wrong runtime.
  return versionAtLeast(piVersion, [0, 85, 0])
}

function getCustomAgentModels(caps: {
  model?: string
  models?: string[]
  defaultModel?: string
}): ModelInfo[] {
  const ids = caps.models?.length
    ? caps.models
    : caps.model
      ? [caps.model]
      : []
  const defaultModel = caps.defaultModel ?? caps.model
  return normalizeAgentModels(ids, defaultModel)
}

export async function detectAgents(options: {
  serverUrl?: string
  authToken?: string
  agentType?: AgentType
} = {}): Promise<DetectedAgent[]> {
  // Manager is a session mode on supported real providers. The legacy
  // manager AgentType remains restorable, but is never advertised for new use.
  const detected: DetectedAgent[] = []
  if (!options.agentType || options.agentType === 'shennian') {
    let models: ModelInfo[] = []
    let authState: AgentAuthState = 'unknown'
    try { const model = personalModelSummary(); models = [{ id: model.model, name: model.model, isDefault: true }]; authState = 'ready' } catch { /* A corrupt personal configuration must not disable other Agents. */ }
    detected.push({ type: 'shennian', command: process.execPath, args: [], runtimePlatform: process.platform, authState,
      display: { name: 'Shennian' }, models })
  }

  for (const agent of AGENTS) {
    if (options.agentType && options.agentType !== agent) continue
    const spec = resolveBuiltinCommand(agent)
    if (!spec) continue

    const version = getBuiltinAgentVersion(agent, spec)
    if ((agent === 'codex' || agent === 'claude') && !version) continue
    if (agent === 'pi-coding-agent' && !isPiCodingAgentRuntimeCompatible(version)) continue
    const executableIdentity = resolveManagedAgentExecutableIdentity(spec)
    detected.push({
      type: agent,
      command: spec.command,
      args: spec.args,
      version,
      runtimePlatform: executableIdentity.platform,
      runtimeIsWsl: executableIdentity.isWsl,
      executableFingerprint: executableIdentity.executableFingerprint,
      authState: await probeBuiltinAuthStatus(agent, spec, version),
    })
  }

  const config = loadConfig()
  const legacyCustomNames = new Set(Object.keys(config.customAgents ?? {}))
  for (const [name, entry] of Object.entries(config.customAgents ?? {})) {
    const agentType = `custom:${name}` as CustomAgentType
    if (options.agentType && options.agentType !== agentType) continue
    registerCustomRuntimeSecurity(agentType, entry)
    detected.push({
      type: agentType,
      command: entry.command,
      args: [],
      version: entry.caps.version,
      runtimePlatform: process.platform,
      runtimeIsWsl:
        process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP),
      executableFingerprint: resolveCustomRuntimeExecutableFingerprint(entry),
      models: getCustomAgentModels(entry.caps),
    })
  }

  const nodeAdapters = listNodeAdapters()
  syncNodeAdapterAgents(nodeAdapters, legacyCustomNames)
  for (const [name, entry] of Object.entries(nodeAdapters)) {
    if (legacyCustomNames.has(name)) continue
    const agentType = `custom:${name}` as CustomAgentType
    if (options.agentType && options.agentType !== agentType) continue
    detected.push({
      type: agentType,
      command: process.execPath,
      args: [],
      version: entry.version,
      runtimePlatform: process.platform,
      runtimeIsWsl:
        process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP),
      executableFingerprint: entry.entrySha256,
      models: normalizeAgentModels(entry.models, entry.defaultModel),
      display: { name: entry.name, version: entry.version },
      authState: 'ready',
      nodeAdapter: entry,
    })
  }

  if (!options.agentType || options.agentType.startsWith('acp:')) {
    detected.push(...await discoverAcpAgents(options))
  }
  return detected
}
