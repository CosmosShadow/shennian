// @arch docs/architecture/app/chat-draft-storage.md
// @test src/__tests__/chat-failed-send-draft.test.ts

import type { ChatMessage } from '@shennian/shared'
import type { UploadTaskLike } from '../hooks/useChatSendController'
import { stripAttachmentRefs } from './attachments'
import { mutateActiveChatSession } from './activeSessionMutation'
import { getChatDraft, saveChatDraft } from './draftStorage'
import { removeChatOutboundMessage } from './outboundStorage'
import { toDraftUploadTasks, toPersistedDraftAttachments } from './sendDraft'

export type ComposerDraft = { text: string; attachments: UploadTaskLike[] }

/** A rejected send belongs in the composer, never in both the composer and outbox. */
export function restoreFailedSendDraft(
  accountId: string,
  sessionId: string,
  message: ChatMessage,
  original?: ComposerDraft | null,
  current?: ComposerDraft,
): ComposerDraft {
  const failed = original ?? {
    text: stripAttachmentRefs(message.content, message.attachments).trim(),
    attachments: toDraftUploadTasks(message.attachments ?? []),
  }
  const stored = getChatDraft(accountId, sessionId)
  const next = current ?? {
    text: stored?.text ?? '',
    attachments: toDraftUploadTasks(stored?.attachments ?? []),
  }
  // A slow rejection must not overwrite the user's next message or new uploads.
  const draft: ComposerDraft = {
    text: !next.text ? failed.text
      : !failed.text || next.text.trim() === failed.text.trim()
        ? next.text : `${failed.text}\n\n${next.text}`,
    attachments: [
      ...failed.attachments.filter((attachment) => !next.attachments.some(
        (other) => other.path === attachment.path && other.sha256 === attachment.sha256,
      )),
      ...next.attachments,
    ].map((attachment) => ({ ...attachment })),
  }
  // Save even after navigation; removing the outbox must not lose the old session's draft.
  saveChatDraft(accountId, sessionId, {
    text: draft.text,
    attachments: toPersistedDraftAttachments(draft.attachments),
  })
  removeChatOutboundMessage(accountId, sessionId, message.id)
  mutateActiveChatSession(sessionId, (state) => {
    state.setMessages(state.messages.filter((item) => item.id !== message.id))
    state.clearPendingRun()
  })
  return draft
}
