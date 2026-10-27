// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-discovery.test.ts

import type { AcpCapabilitySummary, AgentAuthState } from '@shennian/wire'
import { RequestError } from '@agentclientprotocol/sdk'
import {
  buildCommandStringLaunchSpec,
  commandExists,
  resolveCommandFileIdentity,
  resolveCommandFilePath,
} from '../command-spec.js'
import type { DetectedAgent } from '../detect.js'
import { registerAcpAgent } from './adapter.js'
import { getRegisteredAgents, unregisterAgent } from '../adapter.js'
import { readAcpManifests } from './manifests.js'
import { AcpProcessClient } from './process-client.js'
import { acpAgentType, type AcpAgentManifest } from './types.js'
import { loadAcpCatalog } from './catalog.js'
import {
  buildAcpCapabilityCacheKey,
  readAcpCapabilityCache,
  writeAcpCapabilityCache,
} from './capability-cache.js'
import { getAcpRuntimeAuthState, setAcpRuntimeAuthState } from './auth-state.js'
import { recordAcpScan } from './metrics.js'
import { fingerprintNativeExecutable } from '../../security/managed-agent-executable.js'

const BUILTIN_ACP_CANDIDATES: AcpAgentManifest[] = [
  { id: 'qwen-code', name: 'Qwen Code', source: 'registry', launch: { command: 'qwen', args: ['--acp'] } },
  // Keep the fallback id identical to the official Registry id so an outage
  // recovery cannot rename an already-discovered Agent after the catalog heals.
  { id: 'kimi', name: 'Kimi CLI', source: 'registry', launch: { command: 'kimi', args: ['acp'] } },
  // Not in the official Registry; the Server catalog carries the same entry.
  { id: 'dsh', name: 'DSH', source: 'registry', launch: { command: 'dsh', args: ['--profile', 'acp'] } },
  // Same id and launch args under both shipped command names; the installed
  // command is resolved before de-duplication so either build is discovered.
  { id: 'qoder', name: 'Qoder CLI', source: 'registry', launch: { command: 'qoder', args: ['--acp'] } },
  { id: 'qoder', name: 'Qoder CLI', source: 'registry', launch: { command: 'qoderclicn', args: ['--acp'] } },
]

/** A known ACP tool whose command exists here but whose ACP handshake failed. */
export type UnavailableAcpAgent = {
  type: string
  name: string
  command: string
  args: string[]
  reason: string
}

let lastUnavailable: UnavailableAcpAgent[] = []

/** Installed-but-not-connected tools from the most recent scan, for `agent discover` and setup. */
export function getUnavailableAcpAgents(): UnavailableAcpAgent[] {
  return lastUnavailable.map((item) => ({ ...item, args: [...item.args] }))
}

const DEEP_INTEGRATION_COMMANDS = new Set(['claude', 'codex', 'codebuddy', 'cursor', 'opencode', 'pi'])

export async function discoverAcpAgents(
  options: {
    candidates?: AcpAgentManifest[]
    cwd?: string
    serverUrl?: string
    authToken?: string
    fetchImpl?: typeof fetch
    agentType?: string
  } = {},
): Promise<DetectedAgent[]> {
  const startedAt = Date.now()
  let cacheHits = 0
  let handshakeFailures = 0
  const handshakeFailuresByKind: Record<string, number> = {}
  // Keep the last known-good factories available while a refresh probes the
  // filesystem and handshakes candidates. Clearing the registry up front
  // creates a user-visible gap where a machine still advertises an ACP Agent
  // but session/list fails with acp_agent_not_installed.
  const previouslyRegistered = new Set(
    getRegisteredAgents().filter((agentType) => agentType.startsWith('acp:')),
  )
  const catalog = options.candidates
    ? { candidates: options.candidates, revision: undefined }
    : await loadAcpCatalog(options)
  const candidates = mergeCandidates([
    ...(catalog.candidates.length ? catalog.candidates : BUILTIN_ACP_CANDIDATES),
    ...readAcpManifests(),
  ]).filter((candidate) => !options.agentType || acpAgentType(candidate.id) === options.agentType)
  const installed = candidates.filter((candidate) => {
    const command = candidate.launch.command
    if (DEEP_INTEGRATION_COMMANDS.has(command)) return false
    return commandExists(command)
  }).filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index)
  const unavailable: UnavailableAcpAgent[] = []
  const results = await runWithConcurrency(installed, 3, async (candidate): Promise<DetectedAgent | null> => {
    const executablePath = resolveCommandFilePath(candidate.launch.command)
    const executableFingerprint = executablePath
      ? fingerprintNativeExecutable(executablePath)
      : undefined
    const resolvedLaunch = buildCommandStringLaunchSpec(
      candidate.launch.command,
      candidate.launch.args ?? [],
      options.cwd ?? process.cwd(),
    )
    const launch = { ...resolvedLaunch, ...(candidate.launch.env ? { env: candidate.launch.env } : {}) }
    const cacheKey = buildAcpCapabilityCacheKey({
      manifest: candidate,
      platform: process.platform,
      catalogRevision: catalog.revision,
      executableIdentity: resolveCommandFileIdentity(candidate.launch.command),
    })
    const cached = cacheKey ? readAcpCapabilityCache(cacheKey) : null
    if (cached?.type === acpAgentType(candidate.id)
      && cached.integration === 'acp'
      && cached.acpCapabilities?.protocolVersion === 1) {
      cacheHits += 1
      registerAcpAgent({ ...candidate, launch, authLaunch: candidate.launch })
      return {
        ...cached,
        authState: getAcpRuntimeAuthState(acpAgentType(candidate.id)) ?? cached.authState,
        command: launch.command,
        args: launch.args ?? [],
        executableFingerprint,
        display: { ...cached.display, name: candidate.name },
        ...(catalog.revision ? { catalogRevision: catalog.revision } : {}),
      }
    }
    const client = new AcpProcessClient(launch, {
      onSessionUpdate: () => {},
      onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    }, process.env, { terminalAuth: true })
    try {
      const initialized = await client.start(options.cwd ?? process.cwd())
      const capabilities = initialized.agentCapabilities ?? {}
      const summary: AcpCapabilitySummary = {
        protocolVersion: 1,
        listSessions: Boolean(capabilities.sessionCapabilities?.list),
        loadSession: Boolean(capabilities.loadSession),
        resumeSession: Boolean(capabilities.sessionCapabilities?.resume),
        closeSession: Boolean(capabilities.sessionCapabilities?.close),
        deleteSession: Boolean(capabilities.sessionCapabilities?.delete),
        terminal: Boolean(candidate.clientCapabilities?.terminal),
        fileRead: Boolean(candidate.clientCapabilities?.readTextFile),
        fileWrite: Boolean(candidate.clientCapabilities?.writeTextFile),
        permission: true,
        modelConfig: false,
      }
      let authState: AgentAuthState = initialized.authMethods?.length ? 'unknown' : 'ready'
      if (capabilities.sessionCapabilities?.list) {
        try {
          await client.listSessions(options.cwd ?? process.cwd())
          // A successful list is not proof of authentication: real Agents such
          // as Kimi intentionally allow listing before session/new or load.
          authState = initialized.authMethods?.length ? 'unknown' : 'ready'
        } catch (error) {
          authState = error instanceof RequestError && error.code === -32000 ? 'required' : 'unknown'
        }
      }
      const runtimeAuthState = getAcpRuntimeAuthState(acpAgentType(candidate.id))
      if (runtimeAuthState) authState = runtimeAuthState
      else if (authState === 'required') setAcpRuntimeAuthState(acpAgentType(candidate.id), authState)
      registerAcpAgent({ ...candidate, launch, authLaunch: candidate.launch })
      const detected: DetectedAgent = {
        type: acpAgentType(candidate.id),
        command: launch.command,
        args: launch.args ?? [],
        version: initialized.agentInfo?.version ?? undefined,
        runtimePlatform: process.platform,
        executableFingerprint,
        integration: 'acp' as const,
        display: { name: candidate.name, version: initialized.agentInfo?.version ?? undefined },
        acpCapabilities: summary,
        authState,
        acpAuthMethods: (initialized.authMethods ?? []).slice(0, 8).map((method) => ({
          id: method.id.slice(0, 128),
          name: method.name.slice(0, 80),
          type: 'type' in method && method.type === 'terminal' ? 'terminal' as const : 'agent' as const,
        })),
        ...(catalog.revision ? { catalogRevision: catalog.revision } : {}),
      }
      if (cacheKey) writeAcpCapabilityCache(cacheKey, detected)
      return detected
    } catch (error) {
      handshakeFailures += 1
      const kind = classifyHandshakeFailure(error)
      handshakeFailuresByKind[kind] = (handshakeFailuresByKind[kind] ?? 0) + 1
      unavailable.push({
        type: acpAgentType(candidate.id),
        name: candidate.name,
        command: candidate.launch.command,
        args: [...(candidate.launch.args ?? [])],
        reason: kind,
      })
      return null
    } finally {
      await client.close()
    }
  })
  const detected = results.filter((result): result is DetectedAgent => Boolean(result))
  const detectedIds = new Set<string>(detected.map((result) => result.type))
  const failed = unavailable.filter((item, index, all) =>
    !detectedIds.has(item.type) && all.findIndex((other) => other.type === item.type) === index)
  lastUnavailable = options.agentType
    ? [...lastUnavailable.filter((item) => item.type !== options.agentType), ...failed]
    : failed
  const detectedTypes = new Set(detected.map((result) => result.type))
  for (const agentType of previouslyRegistered) {
    if (!detectedTypes.has(agentType)) unregisterAgent(agentType)
  }
  recordAcpScan({
    durationMs: Date.now() - startedAt,
    candidateCount: candidates.length,
    installedCount: detected.length,
    cacheHits,
    handshakeFailures,
    handshakeFailuresByKind,
  })
  return detected
}

function classifyHandshakeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/timed out/i.test(message)) return 'timeout'
  if (/protocol version/i.test(message)) return 'version'
  if (/safety limit|exceeded/i.test(message)) return 'output_limit'
  if (/json|parse/i.test(message)) return 'invalid_protocol'
  if (/enoent|not found/i.test(message)) return 'launch'
  return 'other'
}

function mergeCandidates(candidates: AcpAgentManifest[]): AcpAgentManifest[] {
  const localIds = new Set(candidates.filter((candidate) => candidate.source === 'local').map((candidate) => candidate.id))
  const merged = new Map<string, AcpAgentManifest>()
  for (const candidate of candidates) {
    if (candidate.source !== 'local' && localIds.has(candidate.id)) continue
    const key = `${candidate.id}\0${candidate.launch.command}\0${JSON.stringify(candidate.launch.args ?? [])}`
    if (!merged.has(key)) merged.set(key, candidate)
  }
  return [...merged.values()]
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await work(items[index]!)
    }
  }))
  return results
}
