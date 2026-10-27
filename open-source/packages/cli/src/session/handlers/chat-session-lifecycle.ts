// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-core.test.ts

import type {
  AgentType,
  ChatAttachmentMeta,
  ExternalChannelSessionStatus,
  SessionMode,
} from '@shennian/wire'
import type { AgentAdapter, AgentSendContext, AgentSendResult } from '../../agents/adapter.js'
import { createAgent } from '../../agents/adapter.js'
import { ManagerModeAdapter } from '../../agents/manager.js'
import { registerInternalNativeSource } from '../../native-fusion/source-visibility.js'
import type { CompiledManagedAgentPolicy } from '../../security/managed-agent-policy.js'
import { recordSession } from '../store.js'
import type { ActiveSession, SessionManagerRuntime } from '../types.js'
import {
  configureAdapterForSession,
  externalChannelEnv,
  managedProviderEnv,
  revokeManagedRoomContextToken,
} from './chat-adapter-config.js'
import { bindAdapterEvents } from './chat-events.js'
import { isStewardSessionId } from '../../steward/session.js'

export function rememberProcessedReqId(runtime: SessionManagerRuntime, reqId: string): void {
  runtime.processedReqIds.add(reqId)
  if (runtime.processedReqIds.size > 1000) {
    const first = runtime.processedReqIds.values().next().value!
    runtime.processedReqIds.delete(first)
  }
}

export async function disposeSession(
  runtime: SessionManagerRuntime,
  session: ActiveSession,
): Promise<void> {
  revokeManagedRoomContextToken(runtime, session)
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer)
    session.heartbeatTimer = null
  }
  session.adapter.removeAllListeners()
  await session.adapter.stop().catch(() => {})
}

export function sendAdapterTurn(
  adapter: AgentAdapter,
  text: string,
  modelId?: string,
  reasoningEffort?: string,
  attachments?: ChatAttachmentMeta[],
  systemPrompt?: string | null,
  context?: AgentSendContext,
): Promise<void | AgentSendResult> {
  if (context) {
    return adapter.send(text, modelId, reasoningEffort, attachments, systemPrompt, context)
  }
  if (systemPrompt?.trim()) {
    return adapter.send(text, modelId, reasoningEffort, attachments, systemPrompt)
  }
  if (attachments?.length) return adapter.send(text, modelId, reasoningEffort, attachments)
  if (reasoningEffort) return adapter.send(text, modelId, reasoningEffort)
  return adapter.send(text, modelId)
}

export function prepareAdapterTurn(
  adapter: AgentAdapter,
  text: string,
  modelId?: string,
  reasoningEffort?: string,
  attachments?: ChatAttachmentMeta[],
  systemPrompt?: string | null,
  context?: AgentSendContext,
): Promise<void> {
  if (!adapter.prepareSend) return Promise.resolve()
  return adapter.prepareSend(text, modelId, reasoningEffort, attachments, systemPrompt, context)
}

export async function createActiveSession(
  runtime: SessionManagerRuntime,
  sessionId: string,
  agentType: AgentType,
  sessionMode: SessionMode,
  resolvedWorkDir: string,
  incomingAgentSid?: string | null,
  externalChannel?: ExternalChannelSessionStatus | null,
  externalReplyTarget?: string | null,
  managedAgentPolicy?: CompiledManagedAgentPolicy | null,
  nativeSessionVisibility: 'user' | 'internal' = 'user',
): Promise<ActiveSession> {
  runtime.evictIdleSessions()

  const baseAdapter = createAgent(agentType)
  if (!baseAdapter) throw new Error(`Unsupported agent: ${agentType}`)
  const adapter =
    sessionMode === 'manager' && agentType !== 'manager'
      ? new ManagerModeAdapter(
          baseAdapter,
          agentType as Exclude<AgentType, 'manager' | 'pi' | 'openclaw'>,
        )
      : baseAdapter
  configureAdapterForSession(
    adapter,
    sessionId,
    agentType,
    externalChannel,
    externalReplyTarget,
    null,
    managedAgentPolicy,
    runtime.managedRoomExecutor,
  )

  // Persist the visibility shell before the adapter can expose any provider ID.
  recordSession({ sessionId, agentType, sessionMode, workDir: resolvedWorkDir, agentSessionId: incomingAgentSid, nativeSessionVisibility })
  adapter.on('nativeSession', (sourceAgentType: AgentType, agentSessionId: string) => {
    if (nativeSessionVisibility === 'internal') {
      registerInternalNativeSource(sessionId, sourceAgentType, agentSessionId)
    }
    recordSession({ sessionId, agentType, workDir: resolvedWorkDir, agentSessionId, nativeSessionVisibility })
  })
  if (nativeSessionVisibility === 'internal' && (agentType === 'codex' || agentType === 'manager')) {
    await adapter.start(sessionId, resolvedWorkDir, incomingAgentSid, { nativeSessionVisibility })
  } else {
    await adapter.start(sessionId, resolvedWorkDir, incomingAgentSid)
  }

  const session: ActiveSession = {
    adapter,
    workDir: resolvedWorkDir,
    agentType,
    sessionMode,
    nativeSessionVisibility,
    ...(isStewardSessionId(sessionId) ? { sessionScope: 'steward' as const } : {}),
    agentSessionId: incomingAgentSid ?? null,
    lastActiveAt: Date.now(),
    currentRunId: null,
    currentRunPhase: null,
    nextEventSeq: 0,
    heartbeatSeq: 0,
    heartbeatTimer: null,
    pendingTextEvent: null,
    externalChannel: externalChannel ?? null,
    externalReplyTarget: externalReplyTarget ?? null,
    externalChannelEnv: {
      ...managedProviderEnv(agentType),
      ...externalChannelEnv(sessionId, externalChannel, externalReplyTarget),
    },
    managedRoomContextToken: null,
    journalRunId: null,
  }
  runtime.sessions.set(sessionId, session)
  bindAdapterEvents(runtime, sessionId, agentType, adapter)
  return session
}
