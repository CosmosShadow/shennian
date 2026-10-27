// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { CACHE_TTL_MS, CACHE_VERSION, MODEL_CACHE_PATH, type CacheEntry, type CacheFile } from './types.js'

function ensureDirExists(): void {
  fs.mkdirSync(path.dirname(MODEL_CACHE_PATH), { recursive: true })
}

export function readCache(): CacheFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(MODEL_CACHE_PATH, 'utf-8')) as CacheFile
    if (parsed.version === CACHE_VERSION && parsed.agents && typeof parsed.agents === 'object') {
      return parsed
    }
  } catch {
    // fall through
  }
  return { version: CACHE_VERSION, agents: {} }
}

export function writeCache(cache: CacheFile): void {
  try {
    ensureDirExists()
    fs.writeFileSync(MODEL_CACHE_PATH, JSON.stringify(cache, null, 2))
  } catch {
    // Cache is best-effort. Discovery should still succeed when local
    // filesystem writes are unavailable (e.g. restricted sandboxes).
  }
}

export function isCacheFresh(
  entry: CacheEntry | undefined,
  version?: string,
  sourceRevision?: string,
): boolean {
  if (!entry) return false
  if (entry.version !== version) return false
  if (sourceRevision && entry.sourceRevision !== sourceRevision) return false
  // OpenCode and Pi credentials/config can change without a CLI version
  // change. Neither list is a live proof that the next model request is
  // authorized, so do not retain it for the generic 24-hour period.
  const dynamicProviderConfig =
    sourceRevision?.startsWith('opencode-connected-') ||
    sourceRevision?.startsWith('pi-configured-')
  const ttl = dynamicProviderConfig ? 15 * 60 * 1000 : CACHE_TTL_MS
  return Date.now() - entry.refreshedAt < ttl
}
