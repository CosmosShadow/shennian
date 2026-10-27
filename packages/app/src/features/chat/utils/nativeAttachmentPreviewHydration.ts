// @arch docs/architecture/app/chat-attachments-preview.md#Native-图片磁盘缓存
// @test src/__tests__/native-attachment-preview-hydration.test.ts

import type { ChatAttachment, ChatMessage } from '@shennian/shared'

type PreviewResolver = (
  machineId: string | null,
  attachment: Pick<ChatAttachment, 'path' | 'previewData'>,
) => string | undefined

function isNativePreviewUri(value: string | undefined): value is string {
  return typeof value === 'string' && /^(?:file|content|blob|https?):/i.test(value)
}

export function hydrateCachedNativeAttachmentPreviews(
  messages: ChatMessage[],
  machineId: string | null,
  resolvePreview: PreviewResolver,
): ChatMessage[] {
  return messages.map((message) => {
    if (!message.attachments?.length) return message

    let changed = false
    const attachments = message.attachments.map((attachment) => {
      if (attachment.kind !== 'image' || isNativePreviewUri(attachment.previewData)) {
        return attachment
      }
      const previewData = resolvePreview(machineId, attachment)
      if (!isNativePreviewUri(previewData)) return attachment
      changed = true
      return { ...attachment, previewData }
    })

    return changed ? { ...message, attachments } : message
  })
}
