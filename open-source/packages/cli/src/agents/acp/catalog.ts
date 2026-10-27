// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-catalog.test.ts

import fs from 'node:fs'
import { renameSyncWithRetry } from '../../fs/atomic-rename.js'
import path from 'node:path'
import type { AcpCatalogPlatform, AcpCatalogSnapshot } from '@shennian/wire'
import { resolveShennianPath } from '../../config/index.js'
import type { AcpAgentManifest } from './types.js'
import { deriveInstalledPackageCommands } from './package-commands.js'

const CACHE_FILE = 'acp-registry-v1.json'
const MAX_CATALOG_BYTES = 2 * 1024 * 1024

export async function loadAcpCatalog(options: {
  serverUrl?: string
  authToken?: string
  fetchImpl?: typeof fetch
} = {}): Promise<{ revision?: string; candidates: AcpAgentManifest[] }> {
  const cached = readSnapshotCache()
  let snapshot: AcpCatalogSnapshot | null = null
  if (options.serverUrl && options.authToken) {
    snapshot = await fetchSnapshot(options).catch(() => null)
    if (snapshot && (!cached || Date.parse(snapshot.fetchedAt) >= Date.parse(cached.fetchedAt))) {
      writeSnapshotCache(snapshot)
    } else if (snapshot && cached) {
      snapshot = cached
    }
  }
  snapshot ??= cached
  if (!snapshot || snapshot.platform !== currentAcpPlatform()) return { candidates: [] }
  return {
    revision: snapshot.revision,
    candidates: snapshot.candidates.flatMap((candidate) => {
      if (candidate.duplicateOf) return []
      const commands = [...new Set([
        ...candidate.commands,
        ...deriveInstalledPackageCommands({ npm: candidate.npmPackage, uv: candidate.uvPackage }),
      ])]
      return commands.map((command): AcpAgentManifest => ({
        id: candidate.id,
        name: candidate.name,
        source: 'registry',
        ...(candidate.website ? { homepage: candidate.website } : {}),
        ...(candidate.npmPackage || candidate.uvPackage ? {
          packageHints: {
            ...(candidate.npmPackage ? { npm: candidate.npmPackage } : {}),
            ...(candidate.uvPackage ? { uv: candidate.uvPackage } : {}),
          },
        } : {}),
        launch: { command, args: candidate.args },
      }))
    }),
  }
}

export function currentAcpPlatform(): AcpCatalogPlatform {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  return `${os}-${arch}` as AcpCatalogPlatform
}

async function fetchSnapshot(options: {
  serverUrl?: string
  authToken?: string
  fetchImpl?: typeof fetch
}): Promise<AcpCatalogSnapshot> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const url = new URL('/api/acp/registry', options.serverUrl)
    url.searchParams.set('platform', currentAcpPlatform())
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: {
        authorization: `Bearer ${options.authToken}`,
        ...(readSnapshotCache()?.revision ? { 'x-shennian-acp-revision': readSnapshotCache()!.revision } : {}),
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`ACP catalog request failed (${response.status})`)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_CATALOG_BYTES) throw new Error('ACP catalog exceeds size limit')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error('ACP catalog exceeds size limit')
    return validateSnapshot(JSON.parse(new TextDecoder().decode(bytes)))
  } finally {
    clearTimeout(timer)
  }
}

function validateSnapshot(value: unknown): AcpCatalogSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid ACP catalog')
  const snapshot = value as AcpCatalogSnapshot
  if (!/^[a-z0-9]+-[a-f0-9]{16}$/.test(snapshot.revision)
    || !/^[a-f0-9]{64}$/.test(snapshot.digest)
    || Number.isNaN(Date.parse(snapshot.fetchedAt))
    || snapshot.platform !== currentAcpPlatform()
    || !Array.isArray(snapshot.candidates)) throw new Error('Invalid ACP catalog')
  for (const candidate of snapshot.candidates) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(candidate.id)
      || !candidate.name || candidate.name.length > 80
      || !Array.isArray(candidate.commands)
      || candidate.commands.some((command) => !/^[a-zA-Z0-9._-]{1,128}$/.test(command))
      || !Array.isArray(candidate.args)) throw new Error('Invalid ACP catalog candidate')
  }
  return snapshot
}

function readSnapshotCache(): AcpCatalogSnapshot | null {
  try {
    const file = resolveShennianPath(CACHE_FILE)
    if (fs.statSync(file).size > MAX_CATALOG_BYTES) return null
    return validateSnapshot(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function writeSnapshotCache(snapshot: AcpCatalogSnapshot): void {
  const file = resolveShennianPath(CACHE_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp-${process.pid}`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600, flag: 'wx' })
    renameSyncWithRetry(temporary, file)
  } finally {
    try { fs.unlinkSync(temporary) } catch {}
  }
}
