// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-state.test.ts
// Read-only: pnpm --dir open-source/packages/cli exec tsx src/native-fusion/source-visibility-audit.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import type { LocalSessionRecord } from '../session/store.js'
import {
  knownInternalNativeSources,
  knownJournalInternalNativeSources,
} from './source-visibility.js'
import type { NativeScannerState } from './types.js'

type Binding = { sessionId: string; agentType: string; sourceSessionKey: string; daemonInstallationId?: string }

/** No titles, message contents, Codex databases or deletion APIs are read. */
export function auditInternalNativeVisibility(root = resolvePersonalSyncV1Path()) {
  function read<T>(relative: string, fallback: T): T {
    const file = path.join(root, relative)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as T : fallback
  }
  const records = Object.values(read<Record<string, LocalSessionRecord>>('session-index.json', {}))
  const state = read<Partial<NativeScannerState>>('native-fusion-state.json', {})
  const bindings = Object.values(read<{ sources: Record<string, Binding> }>(
    'native-fusion/sources.json', { sources: {} },
  ).sources)
  const scopedRecords = records.filter(record => Boolean(state.daemonInstallationId)
    && record.daemonInstallationId === state.daemonInstallationId)
  const owners = new Map<string, Set<string>>()
  const add = (key: string, sessionId: string) => {
    const ids = owners.get(key) ?? new Set<string>()
    ids.add(sessionId)
    owners.set(key, ids)
  }
  for (const owner of [
    ...knownInternalNativeSources(scopedRecords),
    ...knownJournalInternalNativeSources(state.daemonInstallationId ?? ''),
  ]) {
    add(`${owner.agentType}:${owner.sourceSessionKey}`, owner.sessionId)
  }
  for (const [key, owner] of Object.entries(state.internalSourceOwners ?? {})) add(key, owner.sessionId)
  const conflicts = [...owners].filter(([, ids]) => ids.size !== 1).map(([key]) => key)
  const confirmed = bindings.flatMap((binding) => {
    if (!state.daemonInstallationId || binding.daemonInstallationId !== state.daemonInstallationId) return []
    const sourceKey = `${binding.agentType}:${binding.sourceSessionKey}`
    const owner = owners.get(sourceKey)
    if (!owner || owner.size !== 1 || owner.has(binding.sessionId)) return []
    return [{ sourceKey, canonicalSessionId: [...owner][0]!, importedSessionId: binding.sessionId }]
  })
  return {
    mode: 'dry-run' as const,
    counts: { knownInternalSources: owners.size, importedSources: bindings.length, confirmedDuplicateProjections: confirmed.length },
    conflicts,
    confirmed,
    // Everything else remains untouched; no content/title heuristic is eligible for automatic repair.
    actionsApplied: 0,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(auditInternalNativeVisibility(), null, 2))
}
