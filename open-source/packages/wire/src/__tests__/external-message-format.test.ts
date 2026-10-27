// @covers open-source/packages/wire/src/external-message-format.ts

import { describe, expect, it } from 'vitest'
import {
  formatExternalAttachmentReference,
  formatExternalConversationText,
} from '../external-message-format'

describe('external message format', () => {
  it('renders provider-neutral external conversation text with attachment links', () => {
    expect(formatExternalConversationText({
      conversationName: '客户群',
      includeContextLabel: true,
      messages: [{
        senderName: '张三',
        text: '前面截图里有错误',
        attachments: [{ type: 'image', name: 'error.png', path: '/tmp/error.png', mimeType: 'image/png' }],
      }, {
        senderName: '李四',
        text: '@神念 帮忙看一下',
        isTrigger: true,
        timestampLabel: '06-03 09:21:00',
      }],
    })).toBe([
      '外部消息上下文（@触发）',
      '外部对话: 客户群',
      '张三: 前面截图里有错误',
      '张三: [error.png](</tmp/error.png>)',
      '=> 06-03 09:21:00 李四: @神念 帮忙看一下',
    ].join('\n'))
  })

  it('renders unavailable media with compact status instead of provider names', () => {
    expect(formatExternalAttachmentReference({
      type: 'video',
      name: 'clip.mp4',
      availability: 'pending-download',
    })).toBe('clip.mp4 (pending-download)')
  })
})
