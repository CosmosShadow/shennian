// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-agent-events-include-sessionid.test.ts

import crypto from 'node:crypto'
import { isAvailableAgentType, type ReqFrame } from '@shennian/wire'
import { createAgent } from '../../agents/adapter.js'
import type { SessionManagerRuntime } from '../types.js'
import { upsertMessage, recordSession } from '../store.js'
import { requestSessionIndexPublish } from '../index-publisher.js'

export async function handleAgentPermissionResponse(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : ''
  const permissionId = typeof req.params.permissionId === 'string' ? req.params.permissionId : ''
  const optionId = typeof req.params.optionId === 'string' ? req.params.optionId : ''
  const session = runtime.sessions.get(sessionId)
  if (!sessionId || !permissionId || !optionId || !session?.adapter.respondToPermission) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'permission_request_unavailable' })
    return
  }
  try {
    await session.adapter.respondToPermission(permissionId, optionId)
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: { accepted: true } })
  } catch (error) {
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: false,
      error: error instanceof Error ? error.message : 'permission_response_failed',
    })
  }
}

export async function handleAcpAgentRequest(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const agentType = typeof req.params.agentType === 'string' ? req.params.agentType : ''
  if (!agentType.startsWith('acp:') || !isAvailableAgentType(agentType)) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'invalid_acp_agent' })
    return
  }
  const activeAuthAdapter = req.method === 'agent.auth.start'
    ? [...runtime.sessions.values()].find((session) =>
        session.agentType === agentType
        && session.adapter.hasPendingAuthenticationRetry?.(),
      )?.adapter
    : undefined
  if (String(req.method) === 'agent.session-options.get') {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : ''
    const active = runtime.sessions.get(sessionId)
    if (!active || active.agentType !== agentType || !active.adapter.getSessionOptions) {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'acp_session_not_active' })
      return
    }
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: active.adapter.getSessionOptions() })
    return
  }
  const adapter = activeAuthAdapter ?? createAgent(agentType)
  if (!adapter) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'acp_agent_not_installed' })
    return
  }
  const workDir = typeof req.params.cwd === 'string' && req.params.cwd ? req.params.cwd : process.cwd()
  const ownsAdapter = !activeAuthAdapter
  try {
    if (ownsAdapter) await adapter.start(`acp-control-${crypto.randomUUID()}`, workDir)
    let payload: unknown = { ok: true }
    if (req.method === 'agent.external-sessions.list') {
      payload = { sessions: await adapter.listExternalSessions?.({ cwd: typeof req.params.cwd === 'string' ? req.params.cwd : undefined }) ?? [] }
    } else if (req.method === 'agent.external-sessions.import') {
      if (!adapter.loadExternalSession) throw new Error('ACP session history import is unsupported')
      const agentSessionId = String(req.params.agentSessionId ?? '')
      const sessionId = String(req.params.sessionId ?? '')
      if (!agentSessionId || !sessionId) throw new Error('ACP and Shennian session ids are required')
      const messages = await adapter.loadExternalSession(agentSessionId)
      const now = Date.now()
      for (const [index, message] of messages.entries()) {
        const id = `acp-import-${crypto.createHash('sha256')
          .update(`${agentType}\0${agentSessionId}\0${message.sourceId}`)
          .digest('hex')}`
        upsertMessage(sessionId, {
          id,
          sessionId,
          role: message.role,
          ts: now + index,
          payload: message.payload,
        })
      }
      recordSession({
        sessionId,
        agentType,
        workDir,
        agentSessionId,
        title: typeof req.params.title === 'string' ? req.params.title.slice(0, 120) : undefined,
        titleSource: typeof req.params.title === 'string' ? 'agent_native' : undefined,
        status: 'active',
      })
      requestSessionIndexPublish(runtime.client)
      runtime.client.sendEvent({
        type: 'event',
        event: 'session.update',
        payload: { session: { id: sessionId, agentType, agentSessionId, workDir, status: 'active' } },
      })
      payload = { sessionId, agentSessionId, importedMessageCount: messages.length }
    } else if (req.method === 'agent.auth.start') {
      if (!adapter.authenticate) throw new Error('ACP authentication is unsupported')
      await adapter.authenticate(String(req.params.methodId ?? ''))
    } else if (req.method === 'agent.auth.logout') {
      if (!adapter.logout) throw new Error('ACP logout is unsupported')
      await adapter.logout()
    } else {
      const agentSessionId = String(req.params.agentSessionId ?? '')
      if (!agentSessionId) throw new Error('ACP session id is required')
      if (req.method === 'agent.external-sessions.close') {
        if (!adapter.closeExternalSession) throw new Error('ACP session close is unsupported')
        await adapter.closeExternalSession(agentSessionId)
      } else {
        if (!adapter.deleteExternalSession) throw new Error('ACP session delete is unsupported')
        await adapter.deleteExternalSession(agentSessionId)
      }
    }
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload })
  } catch (error) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: error instanceof Error ? error.message : 'acp_request_failed' })
  } finally {
    if (ownsAdapter) await adapter.stop().catch(() => {})
  }
}
