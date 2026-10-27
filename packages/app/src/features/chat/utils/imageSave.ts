// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/chat-image-save.test.ts

import { Platform } from 'react-native'
import type { ChatAttachment } from '@shennian/shared'
import {
  guessMimeType,
  prepareWebDownload,
  readRemoteFileBytes,
  saveNativeImageToLibrary,
  type SendFn,
} from '../../../components/chat/fileOperations'
import { buildAttachmentMeta, resolveResourcePath } from './attachments'

export type SaveChatImageResult =
  | 'download'
  | 'library'
  | 'permission-denied'

export function findChatImageAttachment(input: {
  rawPath: string
  workDir: string
  messages: Array<{ attachments?: ChatAttachment[] }>
}): ChatAttachment {
  const resolvedPath = resolveResourcePath(input.rawPath, input.workDir)
  for (const message of input.messages) {
    const existing = (message.attachments ?? []).find((attachment) => attachment.path === resolvedPath)
    if (existing) return existing
  }

  return buildAttachmentMeta({ path: resolvedPath })
}

export async function saveChatImage(input: {
  attachment: Pick<ChatAttachment, 'path' | 'name' | 'mimeType' | 'previewData'>
  send: SendFn
  machineId: string | null
  workDir?: string
}): Promise<SaveChatImageResult> {
  const mimeType = input.attachment.mimeType || guessMimeType(input.attachment.name)

  if (Platform.OS === 'web') {
    const target = prepareWebDownload(input.attachment.name)
    if (!target) throw new Error('File download is not available')
    if (input.attachment.previewData) {
      const bytes = Uint8Array.from(atob(input.attachment.previewData), (character) => character.charCodeAt(0))
      await target.saveBlob(new Blob([bytes as unknown as BlobPart], { type: mimeType }))
      return 'download'
    }
    if (!input.machineId) throw new Error('No machine connected')
    const bytes = await readRemoteFileBytes(input.send, input.attachment.path, () => {}, input.workDir ?? input.attachment.path)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    await target.saveBlob(new Blob([copy.buffer], { type: mimeType }))
    return 'download'
  }

  if (!input.machineId) throw new Error('No machine connected')
  const bytes = await readRemoteFileBytes(input.send, input.attachment.path, () => {}, input.workDir ?? input.attachment.path)
  const result = await saveNativeImageToLibrary(input.attachment.name, bytes)
  if (result === 'library') return 'library'
  return 'permission-denied'
}
