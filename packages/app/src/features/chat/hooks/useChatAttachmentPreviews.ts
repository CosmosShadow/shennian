// @arch docs/architecture/app/chat-attachments-preview.md

import { useMemo } from 'react'
import type { ChatMessage } from '@shennian/shared'
import { Platform } from 'react-native'
import { getCachedAttachmentPreview } from '../utils/attachmentPreview'
import { hydrateCachedNativeAttachmentPreviews } from '../utils/nativeAttachmentPreviewHydration'

export function useChatAttachmentPreviews(
  messages: ChatMessage[],
  machineId: string | null,
): ChatMessage[] {
  return useMemo(() => {
    // Web/Desktop image rows request a single preview only when their
    // placeholder intersects the virtual viewport. Never hydrate the whole
    // loaded history here.
    if (Platform.OS === 'web') return messages
    // A successful send is echoed back from persistence without previewData.
    // Reattach the already-cached local URI synchronously so that the
    // optimistic thumbnail does not flash back to a placeholder.
    return hydrateCachedNativeAttachmentPreviews(messages, machineId, getCachedAttachmentPreview)
  }, [machineId, messages])
}
