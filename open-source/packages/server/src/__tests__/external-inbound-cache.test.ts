// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/services/external-inbound-cache.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    externalInboundMessage: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

describe('external inbound cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.externalInboundMessage.upsert.mockResolvedValue({})
  })

  it('formats cached messages and attachments into a mention-triggered context', async () => {
    const { buildExternalMentionContext, cacheExternalInboundMessage } = await import('../services/external-inbound-cache.js')
    const triggerAt = new Date('2026-06-03T01:21:00.000Z')
    await cacheExternalInboundMessage({
      userId: 'user-1',
      bindingId: 'binding-1',
      sessionId: 'session-1',
      provider: 'feishu',
      externalAccountId: 'account-1',
      externalConversationId: 'chat-1',
      externalMessageId: 'msg-mention',
      conversationName: '研发群',
      conversationType: 'group',
      senderId: 'user-b',
      senderName: '李四',
      text: '@bot 看一下',
      attachments: [],
      isMention: true,
      receivedAt: triggerAt,
    })
    expect(mockPrisma.externalInboundMessage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        provider_bindingId_externalMessageId: {
          provider: 'feishu',
          bindingId: 'binding-1',
          externalMessageId: 'msg-mention',
        },
      },
    }))

    mockPrisma.externalInboundMessage.findMany.mockResolvedValue([
      {
        externalMessageId: 'msg-mention',
        conversationName: '研发群',
        conversationType: 'group',
        senderId: 'user-b',
        senderName: '李四',
        text: '@bot 看一下',
        attachments: [],
        isMention: true,
        receivedAt: triggerAt,
      },
      {
        externalMessageId: 'msg-before',
        conversationName: '研发群',
        conversationType: 'group',
        senderId: 'user-a',
        senderName: '张三',
        text: '截图在这里',
        attachments: [{ type: 'image', name: 'shot.jpg', mimeType: 'image/jpeg', url: 'https://oss.example/shot.jpg' }],
        isMention: false,
        receivedAt: new Date('2026-06-03T01:20:00.000Z'),
      },
    ])

    const context = await buildExternalMentionContext({
      provider: 'feishu',
      bindingId: 'binding-1',
      triggerMessageId: 'msg-mention',
      fallback: {
        userId: 'user-1',
        bindingId: 'binding-1',
        sessionId: 'session-1',
        provider: 'feishu',
        externalAccountId: 'account-1',
        externalConversationId: 'chat-1',
        externalMessageId: 'msg-mention',
        conversationName: '研发群',
        conversationType: 'group',
        senderId: 'user-b',
        senderName: '李四',
        text: '@bot 看一下',
        attachments: [],
        isMention: true,
        receivedAt: triggerAt,
      },
    })

    expect(context.text).toContain('外部消息上下文（@触发）')
    expect(context.text).toContain('外部对话: 研发群')
    expect(context.text).toContain('张三: 截图在这里')
    expect(context.text).toContain('=>')
    expect(context.attachments).toEqual([
      { path: 'https://oss.example/shot.jpg', name: 'shot.jpg', mimeType: 'image/jpeg' },
    ])
  })

  it('keeps only messages after the previous mention trigger', async () => {
    const { buildExternalMentionContext } = await import('../services/external-inbound-cache.js')
    const triggerAt = new Date('2026-06-04T04:40:31.000Z')
    mockPrisma.externalInboundMessage.findMany.mockResolvedValue([
      {
        externalMessageId: 'msg-new-mention',
        conversationName: '农业识别交付',
        conversationType: 'group',
        senderId: 'user-a',
        senderName: '李辰',
        text: '@李辰 只排除.git、环境变量、dist/build，其他模型、底库和真实数据都需要有呢。',
        attachments: [],
        isMention: true,
        receivedAt: triggerAt,
      },
      {
        externalMessageId: 'msg-after-previous',
        conversationName: '农业识别交付',
        conversationType: 'group',
        senderId: 'user-b',
        senderName: 'shau',
        text: '这条是上次触发之后的新背景',
        attachments: [],
        isMention: false,
        receivedAt: new Date('2026-06-04T04:20:00.000Z'),
      },
      {
        externalMessageId: 'msg-previous-mention',
        conversationName: '农业识别交付',
        conversationType: 'group',
        senderId: 'user-a',
        senderName: '李辰',
        text: '@李辰 把这些全部的工作都搞定了，然后打一个ZIP包',
        attachments: [],
        isMention: true,
        receivedAt: new Date('2026-06-04T04:00:38.000Z'),
      },
      {
        externalMessageId: 'msg-old-context',
        conversationName: '农业识别交付',
        conversationType: 'group',
        senderId: 'user-c',
        senderName: 'pacekte',
        text: '能详细描述一下从识别到返回结果的过程吗',
        attachments: [],
        isMention: false,
        receivedAt: new Date('2026-06-04T03:28:30.000Z'),
      },
    ])

    const context = await buildExternalMentionContext({
      provider: 'wecom',
      bindingId: 'binding-1',
      triggerMessageId: 'msg-new-mention',
      fallback: {
        userId: 'user-1',
        bindingId: 'binding-1',
        sessionId: 'session-1',
        provider: 'wecom',
        externalAccountId: 'account-1',
        externalConversationId: 'chat-1',
        externalMessageId: 'msg-new-mention',
        conversationName: '农业识别交付',
        conversationType: 'group',
        senderId: 'user-a',
        senderName: '李辰',
        text: '@李辰 只排除.git、环境变量、dist/build，其他模型、底库和真实数据都需要有呢。',
        attachments: [],
        isMention: true,
        receivedAt: triggerAt,
      },
    })

    expect(context.text).toContain('外部对话: 农业识别交付')
    expect(context.text).toContain('shau: 这条是上次触发之后的新背景')
    expect(context.text).toContain('=> 06-04 12:40:31 李辰: @李辰 只排除.git')
    expect(context.text).not.toContain('把这些全部的工作都搞定了')
    expect(context.text).not.toContain('能详细描述一下从识别到返回结果')
    expect(context.messageCount).toBe(2)
  })

  it('labels personal WeChat RPA context and keeps only edge-local file references', async () => {
    const { buildSingleExternalMessage, cacheExternalInboundMessage } = await import('../services/external-inbound-cache.js')
    const receivedAt = new Date('2026-06-04T05:00:00.000Z')
    await cacheExternalInboundMessage({
      userId: 'user-1',
      bindingId: 'wechat-binding-1',
      sessionId: 'session-1',
      provider: 'wechat-rpa',
      externalAccountId: 'local-wechat',
      externalConversationId: 'ABC',
      externalMessageId: 'msg-image',
      conversationName: 'ABC',
      conversationType: 'group',
      senderId: 'sender-1',
      senderName: '同事',
      text: '',
      attachments: [{
        type: 'image',
        name: '图片',
        mimeType: 'image/png',
        localPath: '/Users/me/project/.uploads/wechat-rpa/inbound/shot.png',
        thumbnailPath: '/Users/me/project/.uploads/wechat-rpa/inbound/shot-preview.png',
        hash: 'sha256-shot',
        machineId: 'machine-mac-1',
        availability: 'edge-local',
      }, {
        type: 'video',
        name: 'large.mp4',
        mimeType: 'video/mp4',
        url: 'https://files.example/large.mp4',
        availability: 'unavailable-large',
      }, {
        type: 'file',
        name: 'uploaded.pdf',
        mimeType: 'application/pdf',
        url: 'https://files.example/uploaded.pdf',
        availability: 'server-url',
      }],
      isMention: false,
      receivedAt,
    })
    expect(mockPrisma.externalInboundMessage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        attachments: [
          {
            type: 'image',
            name: '图片',
            mimeType: 'image/png',
            hash: 'sha256-shot',
            availability: 'edge-local',
            machineId: 'machine-mac-1',
          },
          {
            type: 'video',
            name: 'large.mp4',
            mimeType: 'video/mp4',
            availability: 'unavailable-large',
          },
          {
            type: 'file',
            name: 'uploaded.pdf',
            mimeType: 'application/pdf',
            url: 'https://files.example/uploaded.pdf',
            availability: 'server-url',
          },
        ],
      }),
      update: expect.objectContaining({
        attachments: [
          {
            type: 'image',
            name: '图片',
            mimeType: 'image/png',
            hash: 'sha256-shot',
            availability: 'edge-local',
            machineId: 'machine-mac-1',
          },
          {
            type: 'video',
            name: 'large.mp4',
            mimeType: 'video/mp4',
            availability: 'unavailable-large',
          },
          {
            type: 'file',
            name: 'uploaded.pdf',
            mimeType: 'application/pdf',
            url: 'https://files.example/uploaded.pdf',
            availability: 'server-url',
          },
        ],
      }),
    }))
    const message = buildSingleExternalMessage({
      userId: 'user-1',
      bindingId: 'wechat-binding-1',
      sessionId: 'session-1',
      provider: 'wechat-rpa',
      externalAccountId: 'local-wechat',
      externalConversationId: 'ABC',
      externalMessageId: 'msg-image',
      conversationName: 'ABC',
      conversationType: 'group',
      senderId: 'sender-1',
      senderName: '同事',
      text: '',
      attachments: [{
        type: 'image',
        name: '图片',
        mimeType: 'image/png',
        localPath: '/Users/me/project/.uploads/wechat-rpa/inbound/shot.png',
        availability: 'edge-local',
      }, {
        type: 'video',
        name: 'large.mp4',
        mimeType: 'video/mp4',
        url: 'https://files.example/large.mp4',
        availability: 'unavailable-large',
      }, {
        type: 'file',
        name: 'uploaded.pdf',
        mimeType: 'application/pdf',
        url: 'https://files.example/uploaded.pdf',
        availability: 'server-url',
      }, {
        type: 'file',
        name: '报价.pdf',
        mimeType: 'application/pdf',
        availability: 'metadata-only',
      }],
      isMention: false,
      receivedAt,
    })

    expect(message.text).toContain('外部对话: ABC')
    expect(message.text).toContain('同事: 图片 (edge-local)')
    expect(message.text).toContain('同事: large.mp4 (unavailable-large)')
    expect(message.text).toContain('同事: [uploaded.pdf](<https://files.example/uploaded.pdf>)')
    expect(message.text).toContain('同事: 报价.pdf (metadata-only)')
    expect(message.attachments).toEqual([{
      path: 'https://files.example/uploaded.pdf',
      name: 'uploaded.pdf',
      mimeType: 'application/pdf',
    }])
  })

  it('keeps cached personal WeChat edge-local attachments out of server chat attachments', async () => {
    const { buildExternalMentionContext } = await import('../services/external-inbound-cache.js')
    const triggerAt = new Date('2026-06-04T05:10:00.000Z')
    mockPrisma.externalInboundMessage.findMany.mockResolvedValue([
      {
        externalMessageId: 'msg-trigger',
        conversationName: 'ABC',
        conversationType: 'group',
        senderId: 'sender-1',
        senderName: '同事',
        text: '@神念 看一下这个文件',
        attachments: [{
          type: 'file',
          name: '报价.pdf',
          mimeType: 'application/pdf',
          localPath: '/Users/me/project/.uploads/wechat-rpa/inbound/quote.pdf',
          availability: 'edge-local',
        }, {
          type: 'image',
          name: '截图',
          mimeType: 'image/png',
          availability: 'metadata-only',
        }],
        isMention: true,
        receivedAt: triggerAt,
      },
    ])

    const context = await buildExternalMentionContext({
      provider: 'wechat-rpa',
      bindingId: 'wechat-binding-1',
      triggerMessageId: 'msg-trigger',
      fallback: {
        userId: 'user-1',
        bindingId: 'wechat-binding-1',
        sessionId: 'session-1',
        provider: 'wechat-rpa',
        externalAccountId: 'local-wechat',
        externalConversationId: 'ABC',
        externalMessageId: 'msg-trigger',
        conversationName: 'ABC',
        conversationType: 'group',
        senderId: 'sender-1',
        senderName: '同事',
        text: '@神念 看一下这个文件',
        attachments: [],
        isMention: true,
        receivedAt: triggerAt,
      },
    })

    expect(context.text).toContain('外部消息上下文（@触发）')
    expect(context.text).toContain('外部对话: ABC')
    expect(context.text).toContain('同事: 报价.pdf (edge-local)')
    expect(context.text).toContain('同事: 截图 (metadata-only)')
    expect(context.attachments).toEqual([])
  })
})
