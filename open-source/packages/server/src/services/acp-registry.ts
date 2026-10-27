// @arch open-source/docs/server-runtime.md
// @test src/__tests__/acp-registry.test.ts

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import Ajv from 'ajv'
import type { AcpCatalogCandidate, AcpCatalogPlatform, AcpCatalogSnapshot } from '@shennian/wire'
import { redis } from '../lib/redis.js'

const require = createRequire(import.meta.url)
const registrySchema = require('../schemas/acp-registry-v1/registry.schema.json') as object
const agentSchema = require('../schemas/acp-registry-v1/agent.schema.json') as object

export const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const SNAPSHOT_KEY = 'catalog:acp:v1:last-known-good'
const PREVIOUS_SNAPSHOT_KEY = 'catalog:acp:v1:previous-known-good'
const ETAG_KEY = 'catalog:acp:v1:etag'
const LAST_MODIFIED_KEY = 'catalog:acp:v1:last-modified'
const SUPPLEMENTS_DIGEST_KEY = 'catalog:acp:v1:supplements-digest'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const registryMetrics = {
  refreshSuccess: 0,
  refreshNotModified: 0,
  refreshRejected: 0,
  refreshFailed: 0,
  lastSuccessAt: null as string | null,
}
const daemonRevisionDistribution = new Map<string, number>()
const registrySchemaValidator = (() => {
  const ajv = new Ajv({ allErrors: true, strict: false, formats: { uri: true } })
  ajv.addSchema(agentSchema)
  return ajv.compile(registrySchema)
})()

type RegistryAgent = {
  id: string
  name: string
  version: string
  website?: string
  repository?: string
  distribution: {
    binary?: Partial<Record<AcpCatalogPlatform, { cmd: string; args?: string[] }>>
    npx?: { package: string; args?: string[] }
    uvx?: { package: string; args?: string[] }
  }
}

type RegistryDocument = { version: string; agents: RegistryAgent[] }

export type AcpRegistryStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
}

const OVERLAYS: Record<string, { commands: string[]; args?: string[]; duplicateOf?: AcpCatalogCandidate['duplicateOf'] }> = {
  'qwen-code': { commands: ['qwen'], args: ['--acp'] },
  kimi: { commands: ['kimi'], args: ['acp'] },
  qoder: { commands: ['qoder', 'qoderclicn'], args: ['--acp'] },
  'codebuddy-code': { commands: ['codebuddy'], duplicateOf: 'workbuddy' },
  'codex-acp': { commands: ['codex'], duplicateOf: 'codex' },
  opencode: { commands: ['opencode'], duplicateOf: 'opencode' },
}

/**
 * ACP tools that are not in the official Registry yet. Launch metadata only: the
 * daemon still requires the command on PATH and a successful ACP handshake, and never
 * installs anything. The official Registry wins when it later lists the same id.
 */
export const SUPPLEMENTS: AcpCatalogCandidate[] = [
  {
    id: 'dsh',
    name: 'DSH',
    version: '0.1.7',
    commands: ['dsh'],
    args: ['--profile', 'acp'],
    npmPackage: '@deepseek-ai/dsh',
    website: 'https://www.npmjs.com/package/@deepseek-ai/dsh',
  },
  {
    id: 'qoder',
    name: 'Qoder CLI',
    version: '1.1.73',
    commands: ['qoder', 'qoderclicn'],
    args: ['--acp'],
    npmPackage: '@qodercn-ai/qoderclicn',
    website: 'https://qoder.cn',
  },
]
const SUPPLEMENTS_DIGEST = createHash('sha256').update(JSON.stringify(SUPPLEMENTS)).digest('hex')

export async function refreshAcpRegistry(options: {
  fetchImpl?: typeof fetch
  store?: AcpRegistryStore
  now?: Date
} = {}): Promise<{ changed: boolean; snapshots: AcpCatalogSnapshot[] }> {
  const store = options.store ?? redis
  const headers: Record<string, string> = { accept: 'application/json' }
  // A changed supplement list must rebuild snapshots even when the Registry is unchanged.
  const supplementsCurrent = await store.get(SUPPLEMENTS_DIGEST_KEY) === SUPPLEMENTS_DIGEST
  const etag = supplementsCurrent ? await store.get(ETAG_KEY) : null
  const lastModified = supplementsCurrent ? await store.get(LAST_MODIFIED_KEY) : null
  if (etag) headers['if-none-match'] = etag
  if (lastModified) headers['if-modified-since'] = lastModified
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await (options.fetchImpl ?? fetch)(ACP_REGISTRY_URL, {
      headers,
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.status === 304) {
      registryMetrics.refreshNotModified += 1
      return { changed: false, snapshots: await readAllSnapshots(store) }
    }
    if (!response.ok) throw new Error(`ACP Registry responded ${response.status}`)
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error('ACP Registry response exceeds size limit')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('ACP Registry response exceeds size limit')
    const document = validateRegistryDocument(JSON.parse(new TextDecoder().decode(bytes)))
    const now = options.now ?? new Date()
    const blockedIds = new Set((process.env.ACP_REGISTRY_BLOCKED_IDS ?? '').split(',')
      .map((id) => id.trim()).filter((id) => /^[a-z][a-z0-9-]{0,63}$/.test(id)))
    const snapshots = supportedPlatforms().map((platform) => normalizeSnapshot(document, platform, now, blockedIds))
    // One atomic value is the last-known-good boundary. Validators run before this write.
    const previous = await store.get(SNAPSHOT_KEY)
    if (previous) await store.set(PREVIOUS_SNAPSHOT_KEY, previous)
    await store.set(SNAPSHOT_KEY, JSON.stringify(snapshots))
    const nextEtag = response.headers.get('etag')
    const nextLastModified = response.headers.get('last-modified')
    if (nextEtag) await store.set(ETAG_KEY, nextEtag)
    if (nextLastModified) await store.set(LAST_MODIFIED_KEY, nextLastModified)
    await store.set(SUPPLEMENTS_DIGEST_KEY, SUPPLEMENTS_DIGEST)
    registryMetrics.refreshSuccess += 1
    registryMetrics.lastSuccessAt = now.toISOString()
    return { changed: true, snapshots }
  } catch (error) {
    if (/Schema|Registry (root|shape|Agent|distribution|extensions)|ACP (Agent|binary|npx|uvx)/i.test(error instanceof Error ? error.message : '')) {
      registryMetrics.refreshRejected += 1
    } else {
      registryMetrics.refreshFailed += 1
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function getAcpRegistryMetrics(now = new Date()) {
  return {
    ...registryMetrics,
    lastKnownGoodAgeSeconds: registryMetrics.lastSuccessAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(registryMetrics.lastSuccessAt)) / 1_000))
      : null,
    daemonRevisionDistribution: Object.fromEntries(daemonRevisionDistribution),
  }
}

export function recordAcpDaemonCatalogRevision(revision: unknown): void {
  const key = typeof revision === 'string' && /^[a-z0-9]+-[a-f0-9]{16}$/.test(revision)
    ? revision
    : 'none'
  daemonRevisionDistribution.set(key, (daemonRevisionDistribution.get(key) ?? 0) + 1)
  if (daemonRevisionDistribution.size > 64) {
    const oldest = daemonRevisionDistribution.keys().next().value
    if (oldest) daemonRevisionDistribution.delete(oldest)
  }
}

export async function rollbackAcpRegistry(store: AcpRegistryStore = redis): Promise<boolean> {
  const previous = await store.get(PREVIOUS_SNAPSHOT_KEY)
  if (!previous) return false
  const parsed = JSON.parse(previous) as unknown
  if (!Array.isArray(parsed) || parsed.length !== supportedPlatforms().length) return false
  await store.set(SNAPSHOT_KEY, previous)
  return true
}

export async function getAcpRegistrySnapshot(
  platform: AcpCatalogPlatform,
  store: AcpRegistryStore = redis,
): Promise<AcpCatalogSnapshot | null> {
  return (await readAllSnapshots(store)).find((snapshot) => snapshot.platform === platform) ?? null
}

export type PublicAcpAgent = {
  id: string
  name: string
  version: string
  website?: string
  platforms: AcpCatalogPlatform[]
}

/** Public, display-only projection of the validated last-known-good Registry. */
export async function getPublicAcpAgentCatalog(
  store: AcpRegistryStore = redis,
): Promise<{ sourceVersion: string; fetchedAt: string; agents: PublicAcpAgent[] } | null> {
  const snapshots = await readAllSnapshots(store)
  if (!snapshots.length) return null

  const agents = new Map<string, PublicAcpAgent>()
  for (const snapshot of snapshots) {
    for (const candidate of snapshot.candidates) {
      const existing = agents.get(candidate.id)
      if (existing) {
        if (!existing.platforms.includes(snapshot.platform)) existing.platforms.push(snapshot.platform)
        continue
      }
      agents.set(candidate.id, {
        id: candidate.id,
        name: candidate.name,
        version: candidate.version,
        ...(candidate.website ? { website: candidate.website } : {}),
        platforms: [snapshot.platform],
      })
    }
  }

  return {
    sourceVersion: snapshots[0]!.sourceVersion,
    fetchedAt: snapshots.map((snapshot) => snapshot.fetchedAt).sort().at(-1)!,
    agents: [...agents.values()]
      .map((agent) => ({ ...agent, platforms: agent.platforms.sort() }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  }
}

async function readAllSnapshots(store: AcpRegistryStore): Promise<AcpCatalogSnapshot[]> {
  const raw = await store.get(SNAPSHOT_KEY)
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function validateRegistryDocument(value: unknown): RegistryDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ACP Registry root')
  const rawRoot = value as Record<string, unknown>
  // The live v1 CDN currently adds an empty `extensions` array before the
  // published v1 Schema does. Accept only that inert rollout marker, strip it,
  // and still validate every effective Registry field with the official Schema.
  if ('extensions' in rawRoot && (!Array.isArray(rawRoot.extensions) || rawRoot.extensions.length > 0)) {
    throw new Error('Unsupported ACP Registry extensions')
  }
  const root = Object.fromEntries(Object.entries(rawRoot).filter(([key]) => key !== 'extensions'))
  if (!registrySchemaValidator(root)) throw new Error('ACP Registry failed official Schema validation')
  if (!Object.keys(root).every((key) => key === 'version' || key === 'agents')) {
    throw new Error('Unknown ACP Registry top-level field')
  }
  if (typeof root.version !== 'string' || !Array.isArray(root.agents)) throw new Error('Invalid ACP Registry shape')
  const agents = root.agents.map(validateRegistryAgent)
  return { version: root.version.slice(0, 64), agents }
}

function validateRegistryAgent(value: unknown): RegistryAgent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ACP Registry Agent')
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id)) throw new Error('Invalid ACP Agent id')
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new Error('Invalid ACP Agent name')
  if (typeof item.version !== 'string' || item.version.length > 64) throw new Error('Invalid ACP Agent version')
  if (!item.distribution || typeof item.distribution !== 'object' || Array.isArray(item.distribution)) {
    throw new Error('Invalid ACP Agent distribution')
  }
  const website = safeHttpsUrl(item.website) ?? safeHttpsUrl(item.repository)
  return {
    id: item.id,
    name: item.name.trim(),
    version: item.version,
    ...(website ? { website } : {}),
    distribution: validateDistribution(item.distribution),
  }
}

function validateDistribution(value: unknown): RegistryAgent['distribution'] {
  const input = value as Record<string, unknown>
  const allowed = new Set(['binary', 'npx', 'uvx'])
  if (!Object.keys(input).every((key) => allowed.has(key))) {
    throw new Error('Unknown ACP distribution field')
  }
  const distribution: RegistryAgent['distribution'] = {}
  if (input.binary !== undefined) {
    if (!input.binary || typeof input.binary !== 'object' || Array.isArray(input.binary)) {
      throw new Error('Invalid ACP binary distribution')
    }
    const binary: Partial<Record<AcpCatalogPlatform, { cmd: string; args?: string[] }>> = {}
    for (const [platform, raw] of Object.entries(input.binary)) {
      if (!supportedPlatforms().includes(platform as AcpCatalogPlatform)
        || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.cmd !== 'string' || entry.cmd.length > 4096
        || (entry.args !== undefined && !isStringArray(entry.args))) {
        throw new Error('Invalid ACP binary launch metadata')
      }
      binary[platform as AcpCatalogPlatform] = {
        cmd: entry.cmd,
        ...(entry.args ? { args: entry.args as string[] } : {}),
      }
    }
    distribution.binary = binary
  }
  for (const kind of ['npx', 'uvx'] as const) {
    if (input[kind] === undefined) continue
    if (!input[kind] || typeof input[kind] !== 'object' || Array.isArray(input[kind])) {
      throw new Error(`Invalid ACP ${kind} distribution`)
    }
    const entry = input[kind] as Record<string, unknown>
    if (typeof entry.package !== 'string' || entry.package.length > 256
      || (entry.args !== undefined && !isStringArray(entry.args))) {
      throw new Error(`Invalid ACP ${kind} metadata`)
    }
    distribution[kind] = {
      package: entry.package,
      ...(entry.args ? { args: entry.args as string[] } : {}),
    }
  }
  return distribution
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64
    && value.every((item) => typeof item === 'string' && item.length <= 16_384)
}

function normalizeSnapshot(document: RegistryDocument, platform: AcpCatalogPlatform, now: Date, blockedIds = new Set<string>()): AcpCatalogSnapshot {
  const candidates = document.agents.flatMap((agent): AcpCatalogCandidate[] => {
    if (blockedIds.has(agent.id)) return []
    const overlay = OVERLAYS[agent.id]
    const binary = agent.distribution.binary?.[platform]
    const inferred = binary?.cmd
      ? [binary.cmd.replace(/^\.\//, '').split(/[\\/]/).at(-1)!]
      : inferPackageCommands(agent.distribution.npx?.package ?? agent.distribution.uvx?.package)
    const commands = uniqueSafeCommands([...(overlay?.commands ?? []), ...inferred])
    if (!commands.length) return []
    const args = sanitizeArgs(overlay?.args ?? binary?.args ?? agent.distribution.npx?.args ?? agent.distribution.uvx?.args ?? [])
    return [{
      id: agent.id,
      name: agent.name,
      version: agent.version,
      commands,
      args,
      ...(agent.distribution.npx?.package ? { npmPackage: agent.distribution.npx.package } : {}),
      ...(agent.distribution.uvx?.package ? { uvPackage: agent.distribution.uvx.package } : {}),
      ...(agent.website ? { website: agent.website } : {}),
      ...(overlay?.duplicateOf ? { duplicateOf: overlay.duplicateOf } : {}),
    }]
  })
  const registryIds = new Set(document.agents.map((agent) => agent.id))
  for (const supplement of SUPPLEMENTS) {
    if (!registryIds.has(supplement.id) && !blockedIds.has(supplement.id)) candidates.push({ ...supplement })
  }
  candidates.sort((left, right) => left.id.localeCompare(right.id))
  const canonical = JSON.stringify({ sourceVersion: document.version, platform, candidates })
  const digest = createHash('sha256').update(canonical).digest('hex')
  return {
    revision: `${now.getTime().toString(36)}-${digest.slice(0, 16)}`,
    digest, fetchedAt: now.toISOString(), sourceVersion: document.version,
    platform, candidates,
  }
}

function inferPackageCommands(packageName: string | undefined): string[] {
  if (!packageName) return []
  // npm uses @version; uvx uses PEP 440 specifiers such as ==0.10.1.
  // Strip only a valid package requirement; URLs or shell text are never commands.
  const name = /^(?:@[a-zA-Z0-9._-]+\/)?([a-zA-Z0-9._-]+)(?:@[a-zA-Z0-9._+-]+|(?:==|~=|>=|<=|>|<)[a-zA-Z0-9.*+-]+)?$/.exec(packageName)?.[1]
  return name ? [name] : []
}

function uniqueSafeCommands(values: string[]): string[] {
  return [...new Set(values.filter((value) => /^[a-zA-Z0-9._-]{1,128}$/.test(value)))].slice(0, 8)
}

function sanitizeArgs(values: string[]): string[] {
  return values.filter((value) => typeof value === 'string' && value.length <= 4096 && !value.includes('\0')).slice(0, 64)
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try { return new URL(value).protocol === 'https:' ? value : undefined } catch { return undefined }
}

function supportedPlatforms(): AcpCatalogPlatform[] {
  return ['darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64', 'windows-aarch64', 'windows-x86_64']
}
