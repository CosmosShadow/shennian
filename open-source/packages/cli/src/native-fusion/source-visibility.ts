// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-state.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveShennianPath } from '../config/index.js'
import { parseRunJournalRecord } from '../session/run-recovery/schema.js'
import { isInternalSession, type AgentType, type SessionMode } from '@shennian/wire'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import {
  loadNativeScannerState,
  saveNativeScannerState,
  validateNativeScannerState,
} from './state.js'
import type { NativeScannerState } from './types.js'

type OwnerRecord = {
  sessionId: string; agentType: AgentType; agentSessionId?: string | null
  modelId?: string | null; sessionMode?: SessionMode; nativeSessionVisibility?: 'user' | 'internal'
}

/** Only exact, persisted ownership is eligible. Titles/prompts/provider analytics are never evidence. */
export function knownInternalNativeSources(records: readonly OwnerRecord[]): Array<{
  sessionId: string; agentType: string; sourceSessionKey: string
}> {
  return records.flatMap((record) => {
    if (!record.agentSessionId || !isInternalSession({ ...record, id: record.sessionId })) return []
    const agentType = record.agentType === 'manager' ? record.modelId : record.agentType
    if (!agentType || !['codex', 'claude', 'opencode'].includes(agentType)) return []
    return [{ sessionId: record.sessionId, agentType, sourceSessionKey: record.agentSessionId }]
  })
}

/** Run history preserves rotated provider IDs that the current session index no longer carries. */
export function knownJournalInternalNativeSources(
  daemonInstallationId: string,
  directory = resolveShennianPath('runtime', 'run-recovery', 'active'),
): ReturnType<typeof knownInternalNativeSources> {
  if (!fs.existsSync(directory)) return []
  const owners: ReturnType<typeof knownInternalNativeSources> = []
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.json')) continue
    try {
      const file = path.join(directory, name)
      if (!fs.lstatSync(file).isFile()) continue
      const record = parseRunJournalRecord(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (record.daemonInstallationId !== daemonInstallationId) continue
      const expected = createHash('sha256').update(`${record.sessionId}\0${record.runId}`).digest('hex') + '.json'
      if (name !== expected) continue
      owners.push(...knownInternalNativeSources([record]))
    } catch { /* Read-only discovery never repairs or quarantines historical journals. */ }
  }
  return owners
}

// Atomic state writes replace the inode. Avoid reparsing the full cursor map for
// every event, while still noticing a registration made during a yielded scan.
const readCache = new Map<string, { signature: string; state: NativeScannerState }>()

/** The provider ID, not the transcript location or a message's Worker link, owns visibility. */
export function registerInternalNativeSource(
  sessionId: string,
  agentType: string,
  sourceSessionKey: string,
): void {
  if (!sessionId || !sourceSessionKey) throw new Error('internal_native_source_identity_required')
  if (!['codex', 'claude', 'opencode'].includes(agentType)) return
  const state = loadNativeScannerState()
  const key = `${agentType}:${sourceSessionKey}`
  const existing = state.internalSourceOwners?.[key]
  if (existing && existing.sessionId !== sessionId) {
    throw new Error('internal_native_source_owner_conflict')
  }
  if (existing && state.ignoredSources?.[key]) return
  state.ignoredSources = { ...state.ignoredSources, [key]: true }
  state.internalSourceOwners = {
    ...state.internalSourceOwners,
    [key]: existing ?? { sessionId, registeredAt: new Date().toISOString() },
  }
  saveNativeScannerState(state)
}

/** Read-only commit fence, including registrations made while a cooperative scan yielded. */
export function isInternalNativeSource(
  agentType: string,
  sourceSessionKey: string,
  options: { filePath?: string; daemonInstallationId?: string } = {},
): boolean {
  const file = options.filePath ?? resolvePersonalSyncV1Path('native-fusion-state.json')
  if (!fs.existsSync(file)) { readCache.delete(file); return false }
  const stat = fs.statSync(file)
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  const cached = readCache.get(file)
  const state = cached?.signature === signature ? cached.state
    : JSON.parse(fs.readFileSync(file, 'utf8')) as NativeScannerState
  const installationId = options.daemonInstallationId ?? getDaemonInstallationId()
  if (cached?.signature !== signature || state.daemonInstallationId !== installationId) {
    validateNativeScannerState(state, installationId)
    if (readCache.size > 32) readCache.clear()
    readCache.set(file, { signature, state })
  }
  const key = `${agentType}:${sourceSessionKey}`
  return state.ignoredSources?.[key] === true || Boolean(state.internalSourceOwners?.[key])
}
