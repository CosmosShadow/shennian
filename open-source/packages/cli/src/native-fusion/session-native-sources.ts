// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-core.test.ts

import type { SessionDeletionCommand } from '@shennian/wire'
import { NativeFusionLocalRepository } from './local-repository.js'
import { loadNativeScannerState } from './state.js'
import type { NativeScannerState } from './types.js'

const MANAGER_PROVIDERS = new Set(['codex', 'claude', 'opencode'])

type NativeSource =SessionDeletionCommand['sources'][number]
type SessionRecordSource = {
  sessionId: string
  agentType: string
  agentSessionId?: string | null
  modelId?: string | null
}

/**
 * Native sources this daemon has exact local evidence for. The Server only
 * knows the Session row's current `agentSessionId`; Room, Manager and Worker
 * sessions can also own rotated or managed-echo-suppressed provider threads.
 * Deleting the Session must tombstone those too, otherwise a later cursor
 * reset (archive move, reboot, epoch replay) re-imports them as personal chats.
 */
export function collectLocalNativeSources(
  sessionId: string,
  input: {
    records: readonly SessionRecordSource[]
    sourceOwners?: ReadonlyArray<NativeSource & { sessionId: string }>
    scannerState?: Pick<NativeScannerState, 'internalSourceOwners'>
  },
): NativeSource[] {
  const sourceOwners = input.sourceOwners ?? new NativeFusionLocalRepository().listSourceOwners()
  const internalOwners = (input.scannerState ?? loadNativeScannerState()).internalSourceOwners ?? {}
  const owners = new Map<string, string>()
  for (const owner of sourceOwners) {
    owners.set(`${owner.agentType}:${owner.sourceSessionKey}`, owner.sessionId)
  }
  for (const [key, owner] of Object.entries(internalOwners)) {
    if (!owners.has(key)) owners.set(key, owner.sessionId)
  }

  const candidates = new Map<string, NativeSource>()
  const add = (agentType: string | null | undefined, sourceSessionKey: string | null | undefined) => {
    if (!agentType || !sourceSessionKey) return
    const key = `${agentType}:${sourceSessionKey}`
    const owner = owners.get(key)
    // Never tombstone a provider thread that exact evidence assigns elsewhere.
    if (owner && owner !== sessionId) return
    // Local keys only come from AgentType records and codex/claude/opencode bindings.
    candidates.set(key, { agentType: agentType as NativeSource['agentType'], sourceSessionKey })
  }

  const record = input.records.find((item) => item.sessionId === sessionId)
  if (record?.agentSessionId) {
    const agentType = record.agentType === 'manager' ? record.modelId : record.agentType
    if (record.agentType !== 'manager' || MANAGER_PROVIDERS.has(agentType ?? '')) {
      add(agentType, record.agentSessionId)
    }
  }
  for (const [key, owner] of owners) {
    if (owner !== sessionId) continue
    const separator = key.indexOf(':')
    add(key.slice(0, separator), key.slice(separator + 1))
  }
  return [...candidates.values()]
}
