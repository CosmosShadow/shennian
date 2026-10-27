// @arch docs/architecture/app/chat-draft-storage.md
import { useMemo } from 'react'
import type { ChatMessage } from '@shennian/shared'
import type { ChatQueueSnapshot, PersonalSyncIdentity, QueuedChatMessage } from '@shennian/wire'
import type { Options } from './useChatOutboundRecovery'
import type { ChatOutboundMessage } from '../utils/outboundStorage'
import { toPersonalAttachmentReferences } from '../utils/sendDraft'
import { buildSessionPreview, getControllablePendingForPanel, mergePendingCards } from '../utils/screen'
type PendingCardsOptions = Pick<Options, 'agentType' | 'sessionMode' | 'workDir' | 'sessionAgentSessionId' | 'modelId' | 'systemPrompt' | 'managerDefaultWorkerAgentType' | 'managerDefaultWorkerModelId' | 'reasoningEffort' | 'externalChannel' | 'sessionId'> & {
  personalSyncIdentity: PersonalSyncIdentity | null
  localPendingOutbound: ChatOutboundMessage[]
  optimisticSends: Array<{ sessionId: string; message: ChatMessage }>
  queueSnapshot: ChatQueueSnapshot | null
  transientIdleDispatchIds: Set<string>
}
export function usePendingComposerCards({ agentType, sessionMode, workDir, sessionAgentSessionId, modelId, systemPrompt, managerDefaultWorkerAgentType, managerDefaultWorkerModelId, reasoningEffort, externalChannel, sessionId, personalSyncIdentity, localPendingOutbound, optimisticSends, queueSnapshot, transientIdleDispatchIds }: PendingCardsOptions) {
  const localPendingCards = useMemo<QueuedChatMessage[]>(() => {
    if (!sessionId || !personalSyncIdentity) return []
    return localPendingOutbound.map((message) => ({
      ...personalSyncIdentity,
      id: message.id,
      sessionId,
      text: buildSessionPreview(message) ?? '',
      agentType,
      sessionMode,
      workDir,
      agentSessionId: sessionAgentSessionId,
      modelId,
      systemPrompt,
      managerDefaultWorkerAgentType,
      managerDefaultWorkerModelId,
      reasoningEffort,
      clientMessageId: message.clientMessageId,
      attachments: toPersonalAttachmentReferences(message.attachments ?? []),
      externalChannel,
      createdAt: new Date(message.ts).toISOString(),
      updatedAt: message.lastAttemptAt,
    }))
  }, [
    agentType,
    externalChannel,
    localPendingOutbound,
    managerDefaultWorkerAgentType,
    managerDefaultWorkerModelId,
    modelId,
    personalSyncIdentity,
    reasoningEffort,
    sessionAgentSessionId,
    sessionId,
    sessionMode,
    systemPrompt,
    workDir,
  ])
  const daemonPendingCards = getControllablePendingForPanel(
    queueSnapshot,
    sessionId,
    transientIdleDispatchIds,
  )
  const optimisticPendingCards = useMemo<QueuedChatMessage[]>(() => {
    if (!sessionId || !personalSyncIdentity) return []
    return optimisticSends
      .filter((entry) => entry.sessionId === sessionId)
      .map(({ message }) => ({
        ...personalSyncIdentity,
        id: message.id,
        sessionId,
        text: buildSessionPreview(message) ?? '',
        agentType,
        sessionMode,
        workDir,
        agentSessionId: sessionAgentSessionId,
        modelId,
        clientMessageId: message.id,
        attachments: toPersonalAttachmentReferences(message.attachments ?? []),
        createdAt: new Date(message.ts).toISOString(),
        updatedAt: new Date(message.ts).toISOString(),
        // No queue ID yet: show the waiting clock until the ACK arrives.
        canDelete: false,
        canPromote: false,
      }))
  }, [agentType, modelId, optimisticSends, personalSyncIdentity, sessionAgentSessionId, sessionId, sessionMode, workDir])
  const localPendingIds = new Set(localPendingCards.map((message) => message.id))
  const controllablePending = mergePendingCards(localPendingCards, daemonPendingCards, optimisticPendingCards)

  return { controllablePending, localPendingIds }
}
