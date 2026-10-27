// @covers packages/app/src/components/chat/attachmentImageActions.ts

import { describe, expect, it, vi } from 'vitest'
import { createAttachmentImageActionHandlers } from '../components/chat/attachmentImageActions'

describe('desktop chat image action discoverability', () => {
  it('routes the visible menu button and context menu to the same command', () => {
    const openActions = vi.fn()
    const preventDefault = vi.fn()
    const actions = createAttachmentImageActionHandlers('/workspace/result.png', {
      open: vi.fn(),
      openActions,
    })

    actions.contextMenu({ preventDefault })
    actions.openActions()

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openActions).toHaveBeenNthCalledWith(1, '/workspace/result.png')
    expect(openActions).toHaveBeenNthCalledWith(2, '/workspace/result.png')
  })

  it('keeps normal image activation bound to the preview command', () => {
    const open = vi.fn()
    const openActions = vi.fn()
    const actions = createAttachmentImageActionHandlers('/workspace/result.png', {
      open,
      openActions,
    })

    actions.open()

    expect(open).toHaveBeenCalledWith('/workspace/result.png')
    expect(openActions).not.toHaveBeenCalled()
  })
})
