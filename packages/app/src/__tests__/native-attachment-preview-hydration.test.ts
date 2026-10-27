// @covers packages/app/src/features/chat/utils/nativeAttachmentPreviewHydration.ts

import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shennian/shared'
import { hydrateCachedNativeAttachmentPreviews } from '../features/chat/utils/nativeAttachmentPreviewHydration'

const message: ChatMessage = {
  id: 'user-1',
  role: 'user',
  ts: 1,
  content: '![shot.png](</repo/.uploads/shot.png>)',
  attachments: [
    {
      path: '/repo/.uploads/shot.png',
      name: 'shot.png',
      mimeType: 'image/png',
      kind: 'image',
    },
  ],
}

describe('native attachment preview hydration', () => {
  it('reattaches a cached local URI after the persisted send echo removes previewData', () => {
    const resolvePreview = vi.fn(() => 'file:///cache/chat-image-previews/shot.jpg')

    const result = hydrateCachedNativeAttachmentPreviews(
      [message],
      'machine-1',
      resolvePreview,
    )

    expect(result[0]?.attachments?.[0]?.previewData).toBe(
      'file:///cache/chat-image-previews/shot.jpg',
    )
    expect(resolvePreview).toHaveBeenCalledOnce()
  })

  it('does not let legacy inline base64 back into the native message projection', () => {
    const result = hydrateCachedNativeAttachmentPreviews(
      [message],
      'machine-1',
      () => 'raw-base64-payload',
    )

    expect(result).toBeDefined()
    expect(result[0]).toBe(message)
    expect(result[0]?.attachments?.[0]?.previewData).toBeUndefined()
  })
})
