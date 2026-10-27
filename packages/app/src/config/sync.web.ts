// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../__tests__/desktop-account-runtime.test.ts

import {
  useChatStore,
  useMachinesStore,
  useProjectsStore,
  useSessionsStore,
} from '@shennian/shared'
import { scheduleNativeBadgeSync } from '../lib/push-badge'
import {
  desktopAccountActions,
} from '../features/desktop-control/useDesktopAccountSync'
import { isDesktopControlSurfaceEnabled } from '../utils/controlSurfaceLayout'
import {
  clearAllChatOutboundMessages,
  clearChatOutboundAccount,
} from '../features/chat/utils/outboundStorage'
import {
  clearAllChatDrafts,
  clearChatDraftAccount,
} from '../features/chat/utils/draftStorage'
import { clearAllChatScrollPositions } from '../features/chat/utils/scrollPositionStorage'
import { clearAllReasoningEffortPreferences } from '../features/chat/utils/reasoningEffortStorage'
import { clearAllAttachmentPreviewCaches } from '../features/chat/utils/attachmentPreview'
import { clearAllRoomDrafts, clearRoomDraftAccount } from '../features/rooms/roomDraftStorage'
import { clearCoordinationAccountCache } from '../features/projects/coordination/localState'

const desktopSurface = isDesktopControlSurfaceEnabled()

export function applySessionActivity(
  sessionId: string,
  lastActivityAt: string,
  preview?: string,
  options?: { markRead?: boolean; userMessage?: boolean },
): void {
  const sessions = useSessionsStore.getState()
  const previous = sessions.sessions.find((session) => session.id === sessionId)
  if (!previous) return
  sessions.applyActivity(
    sessionId,
    lastActivityAt,
    preview,
    {
      ...(options?.markRead ? { lastReadAt: lastActivityAt } : {}),
      ...(options?.userMessage ? { userMessageAt: lastActivityAt } : {}),
    },
  )
  const next = useSessionsStore.getState().sessions.find((session) => session.id === sessionId)
  if (!next || !desktopSurface) return
  void desktopAccountActions.persistSession(next).then(() => {
    if (options?.markRead) scheduleNativeBadgeSync()
  }).catch(() => {})
}

export async function clearAccountLocalData(
  accountId: string | null | undefined,
): Promise<void> {
  if (desktopSurface) await desktopAccountActions.clearLocalData()
  if (accountId) {
    clearChatDraftAccount(accountId)
    clearChatOutboundAccount(accountId)
    clearRoomDraftAccount(accountId)
    await clearCoordinationAccountCache(accountId).catch(() => {})
  }
  await Promise.all([
    clearAllChatDrafts(),
    clearAllRoomDrafts(),
    clearAllChatOutboundMessages(),
    clearAllChatScrollPositions(),
    clearAllReasoningEffortPreferences(),
    clearAllAttachmentPreviewCaches(),
  ])
  useChatStore.getState().clear()
  useSessionsStore.getState().setSessions([])
  useMachinesStore.getState().setMachines([])
  useProjectsStore.getState().setProjects([])
}
