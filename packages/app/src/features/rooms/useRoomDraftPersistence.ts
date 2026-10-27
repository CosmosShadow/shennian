// @arch docs/features/network-rooms/local-first-persistence.md#本机草稿
// @test src/__tests__/room-draft-storage.test.ts

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { RoomPickedFile } from './roomAttachments'
import type { RoomMemberView } from './types'
import { createRoomClientMessageId } from './roomConversationUtils'
import { getRoomDraft, hydrateRoomDraftStorage, saveRoomDraft } from './roomDraftStorage'

export type PendingRoomAttachment = RoomPickedFile & {
  id: string
  attachmentId: string | null
  status: 'uploading' | 'ready' | 'failed'
}

type Options = {
  accountId: string | null
  roomId: string
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  pendingAttachments: PendingRoomAttachment[]
  setPendingAttachments: Dispatch<SetStateAction<PendingRoomAttachment[]>>
  members: RoomMemberView[]
  selectedMentions: RoomMemberView[]
  setSelectedMentions: Dispatch<SetStateAction<RoomMemberView[]>>
}

export function useRoomDraftPersistence(options: Options): void {
  const {
    accountId,
    roomId,
    draft,
    setDraft,
    pendingAttachments,
    setPendingAttachments,
    members,
    selectedMentions,
    setSelectedMentions,
  } = options
  const [readyRoomId, setReadyRoomId] = useState<string | null>(null)
  const restoredMentionIdsRef = useRef<string[]>([])

  useEffect(() => {
    let disposed = false
    setReadyRoomId(null)
    void hydrateRoomDraftStorage().then(() => {
      if (disposed) return
      const stored = accountId ? getRoomDraft(accountId, roomId) : null
      setDraft(stored?.text ?? '')
      restoredMentionIdsRef.current = stored?.mentionMembershipIds ?? []
      setSelectedMentions([])
      setPendingAttachments(
        (stored?.attachments ?? []).map((attachment) => ({
          id: createRoomClientMessageId(),
          attachmentId: attachment.attachmentId,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          uri: '',
          status: 'ready',
        })),
      )
      setReadyRoomId(roomId)
    })
    return () => {
      disposed = true
    }
  }, [accountId, roomId, setDraft, setPendingAttachments, setSelectedMentions])

  useEffect(() => {
    if (restoredMentionIdsRef.current.length === 0 || members.length === 0) return
    const ids = new Set(restoredMentionIdsRef.current)
    const restored = members.filter((member) => ids.has(member.id))
    restoredMentionIdsRef.current = restored.map((member) => member.id)
    setSelectedMentions(restored)
  }, [members, readyRoomId, setSelectedMentions])

  useEffect(() => {
    if (!accountId || readyRoomId !== roomId) return
    const restoredMentionIds = draft ? restoredMentionIdsRef.current : []
    const selectedMentionIds = selectedMentions.map((member) => member.id)
    const attachments = []
    for (const item of pendingAttachments) {
      if (item.status !== 'ready' || !item.attachmentId) continue
      attachments.push({
        attachmentId: item.attachmentId,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
      })
    }
    saveRoomDraft(accountId, roomId, {
      text: draft,
      attachments,
      mentionMembershipIds: [...new Set([...restoredMentionIds, ...selectedMentionIds])],
    })
    if (
      !draft ||
      restoredMentionIds.every((membershipId) => selectedMentionIds.includes(membershipId))
    ) {
      restoredMentionIdsRef.current = []
    }
  }, [accountId, draft, pendingAttachments, roomId, selectedMentions, readyRoomId])
}
