// @covers packages/app/src/components/chat/webAttachmentPreview.web.tsx
// @covers packages/app/src/features/chat/hooks/useChatAttachmentPreviews.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createWebAttachmentRequestGate,
  observeWebAttachmentNearViewport,
} from '../components/chat/webAttachmentPreview.web'

describe('desktop web attachment preview hydration', () => {
  it('does not request an image before its placeholder intersects the viewport', () => {
    const onVisible = vi.fn()
    let callback: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
    const disconnect = vi.fn()
    const observe = vi.fn()
    class Observer {
      constructor(next: typeof callback) {
        callback = next
      }
      observe = observe
      disconnect = disconnect
    }

    const stop = observeWebAttachmentNearViewport({} as Element, {} as Element, onVisible, Observer)
    expect(observe).toHaveBeenCalledOnce()
    expect(onVisible).not.toHaveBeenCalled()

    callback?.([{ isIntersecting: false }])
    expect(onVisible).not.toHaveBeenCalled()
    callback?.([{ isIntersecting: true }])
    callback?.([{ isIntersecting: true }])
    expect(onVisible).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalled()
    stop()
  })

  it('removes the former whole-history Promise.all hydration path', () => {
    const hook = readFileSync(
      resolve(__dirname, '../features/chat/hooks/useChatAttachmentPreviews.ts'),
      'utf8',
    )
    const attachmentRenderer = readFileSync(
      resolve(__dirname, '../components/chat/ChatWebMessageAttachments.web.tsx'),
      'utf8',
    )
    expect(hook).toContain("if (Platform.OS === 'web') return messages")
    expect(hook).not.toContain('Promise.all')
    expect(attachmentRenderer).toContain('useWebAttachmentPreview(attachment)')
  })

  it('coalesces a rerender while the same path request is still pending', async () => {
    const gate = createWebAttachmentRequestGate()
    let resolveRequest: ((value: string | null) => void) | undefined
    const load = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRequest = resolve
        }),
    )
    const first = gate.request('/images/large.png', load)
    const rerender = gate.request('/images/large.png', load)
    expect(rerender).toBe(first)
    expect(load).toHaveBeenCalledOnce()
    resolveRequest?.('preview')
    await expect(first).resolves.toBe('preview')
  })
})
