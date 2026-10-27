// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-discovery.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../../fs/atomic-rename.js'
import path from 'node:path'
import type { DetectedAgent } from '../detect.js'
import { resolveShennianPath } from '../../config/index.js'
import type { AcpAgentManifest } from './types.js'

const CACHE_FILE = 'acp-capabilities-v1.json'
const MAX_CACHE_BYTES = 2 * 1024 * 1024
type CacheDocument = { version: 1; entries: Record<string, DetectedAgent> }

export function buildAcpCapabilityCacheKey(input: {
  manifest: AcpAgentManifest
  platform: NodeJS.Platform
  catalogRevision?: string
  executableIdentity?: { pathHash: string; fingerprint: string } | null
}): string | null {
  if (!input.executableIdentity) return null
  return crypto.createHash('sha256').update(JSON.stringify({
    id: input.manifest.id,
    command: input.manifest.launch.command,
    args: input.manifest.launch.args ?? [],
    env: input.manifest.launch.env ?? {},
    clientCapabilities: input.manifest.clientCapabilities ?? {},
    platform: input.platform,
    catalogRevision: input.catalogRevision ?? 'local',
    executable: input.executableIdentity,
  })).digest('hex')
}

export function readAcpCapabilityCache(key: string): DetectedAgent | null {
  return readDocument().entries[key] ?? null
}

export function writeAcpCapabilityCache(key: string, agent: DetectedAgent): void {
  const document = readDocument()
  document.entries[key] = agent
  const entries = Object.entries(document.entries).slice(-256)
  writeDocument({ version: 1, entries: Object.fromEntries(entries) })
}

export function clearAcpCapabilityCache(): void {
  try { fs.unlinkSync(resolveShennianPath(CACHE_FILE)) } catch {}
}

function readDocument(): CacheDocument {
  try {
    const file = resolveShennianPath(CACHE_FILE)
    if (fs.statSync(file).size > MAX_CACHE_BYTES) return { version: 1, entries: {} }
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheDocument
    if (value.version !== 1 || !value.entries || typeof value.entries !== 'object') throw new Error('invalid')
    return value
  } catch {
    return { version: 1, entries: {} }
  }
}

function writeDocument(document: CacheDocument): void {
  const target = resolveShennianPath(CACHE_FILE)
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporary, target)
  } finally {
    try { fs.unlinkSync(temporary) } catch {}
  }
}
