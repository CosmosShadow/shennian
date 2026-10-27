// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts
// @test src/__tests__/model-registry-service.test.ts

import type { AgentAuthState, AgentInfo, ModelInfo } from '@shennian/wire'
import { getAgentConfigSummary } from '../config-status.js'
import type { DetectedAgent } from '../detect.js'
import { isCacheFresh, readCache, writeCache } from './cache.js'
import { discoverModelsForAgent } from './discovery.js'
import {
  ModelDiscoveryFallbackError,
  type CacheEntry,
  type DiscoveryContext,
} from './types.js'
import { getAgentRuntimeSummary } from '../runtime-compatibility.js'
import {
  isRestrictedRoomChatUnsupported,
  resolveManagedAgentRuntimeProtection,
} from '../../security/managed-agent-runtime.js'

const MODEL_DISCOVERY_SOURCE_REVISIONS: Record<string, string> = {
  claude: 'claude-alias-v2',
  codex: 'codex-app-server-v2',
  opencode: 'opencode-connected-v1',
  'pi-coding-agent': 'pi-configured-v1',
}

type ResolveAgentInfoOptions = {
  forceRefresh?: boolean
}

function reportDiscoveryFallback(agentType: string, failureCode: string, usedCache: boolean): void {
  console.warn(
    `[model-discovery] agent=${agentType} source=fallback reason=${failureCode} usedCache=${usedCache}`,
  )
}

function uniqueModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>()
  const unique: ModelInfo[] = []
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    unique.push(model)
  }
  return unique
}

function runtimeCapabilities(agent: DetectedAgent) {
  if (agent.type === 'shennian') return { supportsFreshPersonalContext: true, supportsStandardSession: true, supportsAgent: true, supportsManagedAgent: false, supportsManagedNativeFull: true, supportsRoomTools: true, supportsWorker: false, supportsManagerMode: false, supportsExternalWorkerTarget: true, supportedAgentExecutionModes: ['native-full' as const] }
  // Every discovered real Adapter implements the common session, prompt and
  // lifecycle contracts. Legacy virtual providers are the only exclusions;
  // capability consumers never maintain a Codex/Claude/provider allow-list.
  const realAdapter = agent.type !== 'manager' && agent.type !== 'pi' && agent.type !== 'openclaw'
  const nativeFullCandidate = realAdapter
  const restrictedCandidate = nativeFullCandidate && !agent.type.startsWith('acp:')
  const managedAgentProtection = nativeFullCandidate
    ? resolveManagedAgentRuntimeProtection({
        agentType: agent.type,
        runtimeVersion: agent.version,
        platform: agent.runtimePlatform,
        isWsl: agent.runtimeIsWsl,
        executableFingerprint: agent.executableFingerprint,
        requireExecutableFingerprint: true,
      })
    : null
  // Partial runtimes remain selectable only through the explicit limited-
  // protection confirmation flow. Unverified runtimes never auto-run.
  const supportsManagedAgent =
    restrictedCandidate &&
    !isRestrictedRoomChatUnsupported(agent.type) &&
    (managedAgentProtection?.level === 'hard' || managedAgentProtection?.level === 'partial')
  const supportsManagedNativeFull = nativeFullCandidate
  const supportsAgent = nativeFullCandidate
  const supportedAgentExecutionModes = [
    ...(supportsManagedNativeFull ? ['native-full' as const] : []),
    ...(supportsManagedAgent ? ['restricted' as const] : []),
  ]
  const supportsRoomTools = supportsAgent
  const supportsWorker = realAdapter
  return {
    supportsStandardSession: realAdapter,
    supportsAgent,
    supportedAgentExecutionModes,
    // Compatibility fields retain their deployed meanings. In particular,
    // supportsManagedAgent remains the restricted-mode gate for old clients.
    supportsManagedAgent,
    // This daemon implements the explicit native-full managed launch contract.
    // It remains separate from supportsManagedAgent because native-full does not
    // depend on the provider having a verifiable restricted sandbox.
    supportsManagedNativeFull,
    supportsRoomTools,
    supportsWorker,
    supportsManagerMode: supportsRoomTools && supportsWorker,
    supportsExternalWorkerTarget: supportsWorker,
    ...(managedAgentProtection
      ? {
          managedAgentProtection,
        }
      : {}),
  }
}

/**
 * OpenCode has no login probe, but its model discovery only returns models of
 * providers that are actually connected. Any discovered model therefore means a
 * usable connection exists; no models stays `unknown` because it cannot tell
 * "not logged in" from a failed discovery. Identity signal only, not proof of
 * quota or a working reply.
 */
function authStateFor(agent: DetectedAgent, models: ModelInfo[]): { authState?: AgentAuthState } {
  if (agent.type === 'opencode' && (!agent.authState || agent.authState === 'unknown') && models.length > 0) {
    return { authState: 'ready' }
  }
  return agent.authState ? { authState: agent.authState } : {}
}

/**
 * Store the model list an ACP provider reported inside a live session. The
 * newest non-empty list replaces the previous one; an empty list (for example
 * an unauthenticated provider) never clears a known-good entry.
 * Returns true when the cached list changed.
 */
export function recordAcpAgentModels(agentType: string, models: ModelInfo[]): boolean {
  if (!agentType.startsWith('acp:')) return false
  const next = uniqueModels(models)
  if (next.length === 0) return false
  const cache = readCache()
  const previous = cache.agents[agentType]
  if (JSON.stringify(previous?.models) === JSON.stringify(next)) return false
  cache.agents[agentType] = { refreshedAt: Date.now(), models: next }
  writeCache(cache)
  return true
}

export function getCachedAgentInfos(detectedAgents: DetectedAgent[]): AgentInfo[] {
  const cache = readCache()
  return detectedAgents.map((agent) => {
    const cached = cache.agents[agent.type]
    const sourceRevision = MODEL_DISCOVERY_SOURCE_REVISIONS[agent.type]
    const models = cached && (!sourceRevision || cached.sourceRevision === sourceRevision)
      ? cached.models
      : agent.models ?? []
    const config = getAgentConfigSummary(agent.type)
    const runtime = getAgentRuntimeSummary(agent)
    return {
      type: agent.type,
      models,
      ...(agent.integration ? { integration: agent.integration } : {}),
      ...(agent.display ? { display: agent.display } : {}),
      ...(agent.acpCapabilities ? { acpCapabilities: agent.acpCapabilities } : {}),
      ...authStateFor(agent, models),
      ...(agent.acpAuthMethods ? { acpAuthMethods: agent.acpAuthMethods } : {}),
      ...(agent.catalogRevision ? { catalogRevision: agent.catalogRevision } : {}),
      ...runtimeCapabilities(agent),
      ...(config ? { config } : {}),
      ...(runtime ? { runtime } : {}),
    }
  })
}

export async function refreshAgentInfos(
  detectedAgents: DetectedAgent[],
  context: DiscoveryContext,
): Promise<AgentInfo[]> {
  // Keep the previous authoritative result available while forcing a live
  // probe. A failed refresh must not destroy the last known-good model list.
  return resolveAgentInfos(detectedAgents, context, { forceRefresh: true })
}

export async function resolveAgentInfos(
  detectedAgents: DetectedAgent[],
  context: DiscoveryContext,
  options: ResolveAgentInfoOptions = {},
): Promise<AgentInfo[]> {
  const cache = readCache()
  let changed = false

  const infos: AgentInfo[] = []
  for (const agent of detectedAgents) {
    const cached = cache.agents[agent.type]
    const sourceRevision = MODEL_DISCOVERY_SOURCE_REVISIONS[agent.type]
    const trustedCached =
      cached && (!sourceRevision || cached.sourceRevision === sourceRevision)
        ? cached
        : undefined
    let models: ModelInfo[]

    if (!options.forceRefresh && isCacheFresh(cached, agent.version, sourceRevision)) {
      models = cached!.models
    } else {
      let discovered: ModelInfo[] | null = null
      try {
        discovered = uniqueModels(await discoverModelsForAgent(agent, context))
        models = discovered.length > 0 ? discovered : (trustedCached?.models ?? agent.models ?? [])
      } catch (error) {
        if (error instanceof ModelDiscoveryFallbackError) {
          const useCached = Boolean(trustedCached?.models.length)
          models = useCached ? trustedCached!.models : error.fallbackModels
          reportDiscoveryFallback(agent.type, error.failureCode, useCached)
        } else {
          models = trustedCached?.models ?? agent.models ?? []
        }
      }

      if (discovered && discovered.length > 0) {
        const nextEntry: CacheEntry = {
          version: agent.version,
          ...(sourceRevision ? { sourceRevision } : {}),
          refreshedAt: Date.now(),
          models,
        }
        if (JSON.stringify(cached) !== JSON.stringify(nextEntry)) {
          cache.agents[agent.type] = nextEntry
          changed = true
        }
      }
    }

    const config = getAgentConfigSummary(agent.type)
    const runtime = getAgentRuntimeSummary(agent)
    infos.push({
      type: agent.type,
      models,
      ...(agent.integration ? { integration: agent.integration } : {}),
      ...(agent.display ? { display: agent.display } : {}),
      ...(agent.acpCapabilities ? { acpCapabilities: agent.acpCapabilities } : {}),
      ...authStateFor(agent, models),
      ...(agent.acpAuthMethods ? { acpAuthMethods: agent.acpAuthMethods } : {}),
      ...(agent.catalogRevision ? { catalogRevision: agent.catalogRevision } : {}),
      ...runtimeCapabilities(agent),
      ...(config ? { config } : {}),
      ...(runtime ? { runtime } : {}),
    })
  }

  if (changed) {
    writeCache(cache)
  }

  return infos
}
