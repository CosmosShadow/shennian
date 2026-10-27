// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/custom-recovery-conformance.test.ts

import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveShennianPath } from '../config/index.js'

type Entry = { fingerprint: string; runtimeVersion: string | null; verifiedAt: string }
type Cache = { schemaVersion: 1; agents: Record<string, Entry> }

function cachePath(): string {
  return resolveShennianPath('runtime', 'recovery-conformance', 'custom.json')
}

function readCache(): Cache {
  try {
    const value = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as Cache
    return value?.schemaVersion === 1 && value.agents && typeof value.agents === 'object'
      ? value
      : { schemaVersion: 1, agents: {} }
  } catch {
    return { schemaVersion: 1, agents: {} }
  }
}

export function hasCustomResumeConformance(
  agentType: string,
  fingerprint: string | undefined,
  runtimeVersion: string | undefined,
): boolean {
  if (!fingerprint) return false
  const entry = readCache().agents[agentType]
  return Boolean(
    entry && entry.fingerprint === fingerprint && entry.runtimeVersion === (runtimeVersion ?? null),
  )
}

export function recordCustomResumeConformance(
  agentType: string,
  fingerprint: string,
  runtimeVersion: string | undefined,
): void {
  const filePath = cachePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(path.dirname(filePath), 0o700)
  const cache = readCache()
  cache.agents[agentType] = {
    fingerprint,
    runtimeVersion: runtimeVersion ?? null,
    verifiedAt: new Date().toISOString(),
  }
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    const fd = fs.openSync(temp, 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    renameSyncWithRetry(temp, filePath)
  } finally {
    try { fs.unlinkSync(temp) } catch {}
  }
}
