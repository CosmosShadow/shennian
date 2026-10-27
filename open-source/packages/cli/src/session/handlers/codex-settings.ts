// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-conversation-settings.test.ts

import { DEFAULT_CODEX_CONVERSATION_SETTINGS, type ReqFrame } from '@shennian/wire'
import { normalizeCodexConversationSettings } from '../../agents/codex-conversation-settings.js'
import { assertPersonalSyncIdentity } from '../../personal-sync/epoch.js'
import { isStewardSessionId } from '../../steward/session.js'
import { listSessionRecords, recordSession } from '../store.js'
import type { SessionManagerRuntime } from '../types.js'
import { configureAdapterForSession } from './chat-adapter-config.js'

/** Both reads and writes require the Relay-attested personal Codex session row. */
export function handleCodexSettings(runtime: SessionManagerRuntime, req: ReqFrame): void {
  assertPersonalSyncIdentity(req.params)
  const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : ''
  const attested = req.params.codexSettingsSession as {
    agentType?: string; workDir?: string; agentSessionId?: string | null;
    sessionMode?: string; sessionScope?: string; agentIdentityId?: string | null
  } | undefined
  if (!sessionId || !attested) throw new Error('codex_settings_requires_server_upgrade')
  const record = listSessionRecords().find((item) => item.sessionId === sessionId)
  if (attested.agentType !== 'codex' || !attested.workDir || attested.agentIdentityId ||
      attested.sessionMode === 'manager' || attested.sessionScope === 'steward' || isStewardSessionId(sessionId) ||
      record?.deletedAt || record?.nativeSessionVisibility === 'internal' || record?.sessionScope === 'steward' ||
      (record && (record.agentType !== 'codex' || record.sessionMode === 'manager'))) {
    throw new Error('codex_settings_personal_only')
  }
  const session = runtime.sessions.get(sessionId)
  const queue = runtime.chatQueue?.getSnapshot(sessionId)
  const busy = Boolean(session?.currentRunId || session?.journalRunId || queue?.busy || queue?.pending.length ||
    runtime.recoveryBarrier?.isDispatchFrozen() || runtime.recoveryBarrier?.isRecovering(sessionId))
  const homeLocked = Boolean(record?.agentSessionId || attested.agentSessionId || session?.agentSessionId)
  if (req.method === 'chat.codex.settings.set') {
    if (busy) throw new Error('codex_settings_busy')
    const settings = normalizeCodexConversationSettings(req.params.settings)
    const previous = record?.codexSettings ?? DEFAULT_CODEX_CONVERSATION_SETTINGS
    if (homeLocked && settings.codexHome !== previous.codexHome) throw new Error('codex_home_locked')
    recordSession({ sessionId, agentType: 'codex', workDir: record?.workDir ?? attested.workDir,
      agentSessionId: record?.agentSessionId ?? attested.agentSessionId, codexSettings: settings })
    if (session) configureAdapterForSession(session.adapter, sessionId, 'codex')
  }
  runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: {
    settings: listSessionRecords().find((item) => item.sessionId === sessionId)?.codexSettings ?? DEFAULT_CODEX_CONVERSATION_SETTINGS,
    homeLocked, busy,
  } })
}
