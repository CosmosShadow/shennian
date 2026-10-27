// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-session-title-set.test.ts

import type { AgentType, ReqFrame, SessionTitleSetParams } from '@shennian/wire'
import { createAgent } from '../../agents/adapter.js'
import { buildManagedAgentEnv } from '../../agents/config-status.js'
import type { SessionManagerRuntime } from '../types.js'
import { listSessionRecords, recordSession } from '../store.js'
import { requestSessionIndexPublish } from '../index-publisher.js'
import { assertPersonalSyncIdentity } from '../../personal-sync/epoch.js'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleSessionTitleSet(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const params = req.params as Partial<SessionTitleSetParams>
  assertPersonalSyncIdentity(params)

  const sessionId = cleanString(params.sessionId)
  const title = cleanString(params.title)
  const agentSessionId = cleanString(params.agentSessionId)
  const agentType = cleanString(params.agentType) as AgentType | ''
  const workDir = cleanString(params.workDir) || process.cwd()
  const titleOriginEventId = cleanString(params.titleOriginEventId)
  const titleRevision = params.titleRevision

  if (!sessionId || !title || !agentType || params.titleSource !== 'shennian_manual'
    || !Number.isSafeInteger(titleRevision) || Number(titleRevision) < 1 || !titleOriginEventId) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'explicit shennian_manual title authority is required',
    })
    return
  }

  recordSession({
    sessionId,
    agentType,
    workDir,
    agentSessionId: agentSessionId || null,
    title,
    titleSource: 'shennian_manual',
    titleRevision: Number(titleRevision),
    titleLockedByUser: true,
    titleOriginEventId,
  })
  requestSessionIndexPublish(runtime.client)

  if (agentType !== 'codex' || !agentSessionId) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: { localApplied: true, nativeWriteback: 'unsupported' },
    })
    return
  }

  const active = runtime.sessions.get(sessionId)
  if (active?.agentType === 'codex' && active.adapter.setTitle) {
    await active.adapter.setTitle(agentSessionId, title, active.workDir || workDir)
    active.agentSessionId = agentSessionId
    active.lastActiveAt = Date.now()
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: { synced: true } })
    return
  }

  const adapter = createAgent('codex')
  if (!adapter?.setTitle) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'Codex adapter does not support title sync',
    })
    return
  }

  adapter.configure?.({ sessionId, env: buildManagedAgentEnv('codex'),
    codexSettings: listSessionRecords().find((record) => record.sessionId === sessionId)?.codexSettings })
  try {
    await adapter.start(sessionId, workDir, agentSessionId)
    await adapter.setTitle(agentSessionId, title, workDir)
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: { synced: true } })
  } finally {
    await adapter.stop().catch(() => {})
  }
}
