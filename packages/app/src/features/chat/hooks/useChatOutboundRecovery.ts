import type { StewardPageContext } from '../../steward/contextualSteward'
// @arch docs/architecture/app/chat-draft-storage.md
// @test src/__tests__/chat-outbound-storage.test.ts

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { Platform } from 'react-native'
import type { ChatMessage } from '@shennian/shared'
import type {
  AgentType, ExternalChannelSessionStatus, PersonalSyncIdentity, ReqFrame,
  SessionListProjection, SessionMode,
} from '@shennian/wire'
import type { UploadTask } from './useChatUploads'
import { getChatOutboundMessages, saveChatOutboundAck, saveChatOutboundMessage } from '../utils/outboundStorage'
import { requestDurableMessageStatus } from '../utils/durableSend'
import { mutateActiveChatSession } from '../utils/activeSessionMutation'

export type UploadTaskLike = UploadTask

export type PendingComposerDraft = {
  sessionId: string
  text: string
  attachments: UploadTaskLike[]
}

export type PendingSendState = {
  sessionId: string
  machineId: string | null
  userMsg: ChatMessage
  draft: PendingComposerDraft | null
  accepted: boolean
  persisted: boolean
}

export type QueuedMessageEditState = {
  sessionId: string
  queueMessageId: string
  clientMessageId: string
  previousDraft: PendingComposerDraft
}

export type HandleSendOptions = {
  textOverride?: string
  bypassVoicePhaseGuard?: boolean
}

export type ChatSendRequest = (frame: Omit<ReqFrame, 'id'>) => Promise<unknown>

export type Options = {
  messageContext?: StewardPageContext
  agentType: AgentType
  sessionMode?: SessionMode
  currentRunId: string | null
  input: string
  isTyping: boolean
  isUploading: boolean
  machineId: string | null
  messages: ChatMessage[]
  pendingAttachments: UploadTaskLike[]
  relayState: 'disconnected' | 'connecting' | 'connected'
  replacePendingAttachments: (tasks: UploadTaskLike[]) => void
  sessionAgentSessionId?: string | null
  sessionId: string | undefined
  setInput: Dispatch<SetStateAction<string>>
  startPendingRun: () => void
  clearPendingRun: () => void
  clearPendingAttachments: () => void
  onMessageSubmitted?: () => void
  onSendRejected?: (error: unknown) => void
  addMessage: (message: ChatMessage) => void
  updateMessageStatus: (
    id: string,
    status: 'sending' | 'sent' | 'delivered' | 'uncertain' | 'error',
  ) => void
  updateMessageError: (
    id: string,
    error: { type: 'network' | 'cli_unreachable' | 'agent_error'; message?: string },
  ) => void
  send: ChatSendRequest
  textInputRef: RefObject<{ clear?: () => void; focus?: () => void } | null>
  voicePhase: 'idle' | 'listening' | 'refining' | 'error'
  workDir: string
  modelId?: string
  systemPrompt?: string | null
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
  reasoningEffort?: string
  sessionListProjection?: SessionListProjection[]
  externalChannel?: ExternalChannelSessionStatus | null
}

/** Compatibility path for web/desktop; native recovery is owned by the App. */
export function useChatOutboundRecovery({
  accountId, isLocalDraft, personalSyncIdentity, relayState, send, sessionId,
}: Pick<Options, 'relayState' | 'send' | 'sessionId'> & {
  accountId: string
  isLocalDraft: boolean
  personalSyncIdentity: PersonalSyncIdentity | null
}): void {
  useEffect(() => {
    if (isLocalDraft || !sessionId || !personalSyncIdentity || relayState !== 'connected') return
    if (Platform.OS !== 'web') return
    let cancelled = false
    let reconciling = false
    const reconcile = async () => {
      if (reconciling) return
      reconciling = true
      const unresolved = getChatOutboundMessages(accountId, sessionId).filter(
        (message) =>
          message.deliveryState !== 'local_pending' &&
          message.deliveryState !== 'completed' &&
          message.deliveryState !== 'failed' &&
          message.deliveryState !== 'cancelled',
      )
      await Promise.allSettled(unresolved.map(async (message) => {
        const status = await requestDurableMessageStatus(send, {
          ...personalSyncIdentity,
          sessionId,
          clientMessageId: message.clientMessageId,
        })
        if (cancelled || !getChatOutboundMessages(accountId, sessionId).some(
          (current) => current.id === message.id,
        )) return
        if (status.state === 'not_found') {
          const uncertain = { ...message, status: 'uncertain' as const }
          mutateActiveChatSession(sessionId, (state) => state.upsertMessage(uncertain))
          saveChatOutboundMessage(accountId, sessionId, uncertain, { deliveryState: 'unconfirmed' })
          return
        }
        const failed = status.deliveryState === 'failed' || status.deliveryState === 'cancelled'
        const recovered = {
          ...message,
          status: failed
            ? 'error' as const
            : status.deliveryState === 'queued'
              ? 'sending' as const
              : 'sent' as const,
        }
        mutateActiveChatSession(sessionId, (state) => state.upsertMessage(recovered))
        saveChatOutboundAck(accountId, sessionId, recovered, status)
      }))
      reconciling = false
    }
    void reconcile()
    const timer = setInterval(() => void reconcile(), 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [accountId, isLocalDraft, personalSyncIdentity, relayState, send, sessionId])
}
