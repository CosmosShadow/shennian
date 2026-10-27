// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-screen-utils.test.ts

import type {
  AgentType,
  ExternalChannelSessionStatus,
  PersonalAttachmentReference,
  SessionListProjection,
  SessionMode,
  PersonalSyncIdentity,
} from '@shennian/wire'

type BuildChatSendParamsOptions = PersonalSyncIdentity & {
  sessionId: string
  text: string
  agentType: AgentType
  sessionMode?: SessionMode
  workDir: string
  agentSessionId?: string | null
  modelId?: string
  systemPrompt?: string | null
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
  reasoningEffort?: string
  clientMessageId?: string
  queueMessageId?: string
  sessionListProjection?: SessionListProjection[]
  attachments?: PersonalAttachmentReference[]
  externalChannel?: ExternalChannelSessionStatus | null
}

export function buildChatSendParams({
  protocolVersion,
  dataEpoch,
  daemonInstallationId,
  sessionId,
  text,
  agentType,
  sessionMode,
  workDir,
  agentSessionId,
  modelId,
  systemPrompt,
  managerDefaultWorkerAgentType,
  managerDefaultWorkerModelId,
  reasoningEffort,
  clientMessageId,
  queueMessageId,
  sessionListProjection,
  attachments,
  externalChannel,
}: BuildChatSendParamsOptions): Record<string, unknown> {
  return {
    protocolVersion,
    dataEpoch,
    daemonInstallationId,
    sessionId,
    text,
    agentType,
    sessionMode,
    workDir,
    agentSessionId,
    modelId,
    systemPrompt,
    managerDefaultWorkerAgentType,
    managerDefaultWorkerModelId,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(queueMessageId ? { queueMessageId } : {}),
    sessionListProjection,
    attachments,
    externalChannel,
  }
}
