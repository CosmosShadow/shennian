// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/attachment-preview.test.ts

import { downloadFeedback, showDownloadFeedback } from '../../../components/DownloadFeedback'
import { downloadChatAttachment, type DownloadChatAttachmentResult } from './attachmentDownload'

type DownloadInput = Omit<Parameters<typeof downloadChatAttachment>[0], 'onProgress'>
type Translate = Parameters<typeof downloadFeedback>[0]
type Task = { progress: number; promise: Promise<DownloadChatAttachmentResult | null> }

// Only active tasks are retained. Neither route unmount nor a new subscriber owns their lifetime.
const tasks = new Map<string, Task>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export function attachmentDownloadKey(input: Pick<DownloadInput, 'machineId' | 'attachment'>): string {
  return JSON.stringify([input.machineId, input.attachment.path, input.attachment.kind === 'folder'])
}

export function subscribeAttachmentDownloads(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getAttachmentDownloadProgress(key: string): number | null {
  return tasks.get(key)?.progress ?? null
}

/** Start in the user gesture (important for native/browser save pickers), or join an active task. */
export function startAttachmentDownload(input: DownloadInput, t: Translate): Promise<DownloadChatAttachmentResult | null> {
  const key = attachmentDownloadKey(input)
  const existing = tasks.get(key)
  if (existing) return existing.promise

  let complete!: (result: DownloadChatAttachmentResult | null) => void
  const task: Task = { progress: 0, promise: new Promise((resolve) => { complete = resolve }) }
  tasks.set(key, task)
  void downloadChatAttachment({
    ...input,
    onProgress: (progress) => { task.progress = progress; emit() },
  }).then((result) => {
    showDownloadFeedback(downloadFeedback(t, result, input.attachment.name))
    return result
  }).catch(() => {
    showDownloadFeedback({ message: t('download_failed', { name: input.attachment.name }), type: 'error' })
    return null
  }).then((result) => {
    tasks.delete(key)
    emit()
    complete(result)
  })
  emit()
  return task.promise
}
