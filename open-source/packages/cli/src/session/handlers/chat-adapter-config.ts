// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-error-handling-1.test.ts

import type { AgentAdapter } from '../../agents/adapter.js'
import type { AgentType, ExternalChannelSessionStatus } from '@shennian/wire'
import type { ActiveSession, SessionManagerRuntime } from '../types.js'
import { buildManagedAgentEnv } from '../../agents/config-status.js'
import { lookupClaudeTranscriptCwd } from '../../native-fusion/parsers.js'
import type { CompiledManagedAgentPolicy } from '../../security/managed-agent-policy.js'
import { getManagedRoomIpcRoot, MANAGED_ROOM_IPC_ROOT_ENV } from '../../daemon-ipc/paths.js'
import type { ManagedRoomExecutor } from '../../room/managed-room-ipc.js'
import { listSessionRecords } from '../store.js'
import { stewardSessionEnv } from '../../steward/session.js'

export function managedProviderEnv(agentType: AgentType): NodeJS.ProcessEnv {
  return buildManagedAgentEnv(agentType)
}

export function externalChannelEnv(
  _sessionId: string,
  _channel?: ExternalChannelSessionStatus | null,
  _replyTarget?: string | null,
): NodeJS.ProcessEnv {
  return {}
}

export function configureAdapterForSession(
  adapter: AgentAdapter,
  sessionId: string,
  agentType: AgentType,
  channel?: ExternalChannelSessionStatus | null,
  replyTarget?: string | null,
  managedRoomContextToken?: string | null,
  managedAgentPolicy?: CompiledManagedAgentPolicy | null,
  managedRoomExecutor?: ManagedRoomExecutor | null,
): void {
  const useCodexDynamicTools = agentType === 'codex'
  const codexSettings = agentType === 'codex' && !managedAgentPolicy
    ? listSessionRecords().find((record) => record.sessionId === sessionId)?.codexSettings
    : undefined
  adapter.configure?.({
    codexSettings,
    sessionId,
    externalChannel: channel ?? null,
    env: {
      ...managedProviderEnv(agentType),
      ...externalChannelEnv(sessionId, channel, replyTarget),
      ...stewardSessionEnv(sessionId),
      ...(managedRoomContextToken && !useCodexDynamicTools
        ? {
            SHENNIAN_MANAGED_ROOM_CONTEXT: managedRoomContextToken,
            [MANAGED_ROOM_IPC_ROOT_ENV]: getManagedRoomIpcRoot(),
          }
        : {}),
    },
    ...(managedAgentPolicy ? { managedAgentPolicy } : {}),
    ...(useCodexDynamicTools
      ? {
          managedRoomContextToken: managedRoomContextToken ?? null,
          // The daemon owns an executor globally, but authority comes from the
          // paired short-lived token. Private Manager turns use a restricted
          // token; Worker sessions themselves receive neither half.
          managedRoomExecutor: managedRoomContextToken ? managedRoomExecutor ?? null : null,
        }
      : {}),
  })
}

export function replaceManagedRoomContextToken(
  runtime: SessionManagerRuntime,
  session: ActiveSession,
  token: string,
): void {
  const previous = session.managedRoomContextToken
  if (previous && previous !== token) runtime.revokeManagedRoomContextToken?.(previous)
  session.managedRoomContextToken = token
  session.roomSendOutcome = { successes: 0, failureCodes: [] }
}

export function revokeManagedRoomContextToken(
  runtime: SessionManagerRuntime,
  session: ActiveSession | undefined,
): void {
  const token = session?.managedRoomContextToken
  if (!session || !token) return
  session.managedRoomContextToken = null
  runtime.revokeManagedRoomContextToken?.(token)
}

export function maybeResolveClaudeImportedWorkDir(
  agentType: AgentType,
  workDir: string,
  agentSessionId?: string | null,
): string {
  if (agentType !== 'claude') return workDir
  if (!agentSessionId) return workDir
  const trimmed = workDir.trim()
  const looksLikeTranscriptSlug = !!trimmed && trimmed.startsWith('-') && !trimmed.includes('/')
  if (!looksLikeTranscriptSlug) return workDir
  return lookupClaudeTranscriptCwd(agentSessionId) ?? workDir
}
