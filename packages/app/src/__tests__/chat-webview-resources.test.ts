// @covers packages/app/src/components/chat/webview/chat.js
// @covers packages/app/src/components/chat/webview/chatVirtualization.js
// @covers packages/app/src/components/chat/webview/chatHooks.js
// @covers packages/app/src/components/chat/webview/chatCopy.js

import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shennian/shared'
import { createHarness, loadChatScript } from './chat-webview-harness'
import { CHAT_CSS_NATIVE, CHAT_CSS_WEB } from '../components/chat/webview/chatCss'
import { buildRenderItems as buildWebRenderItems } from '../components/chat/ChatWebMessageRenderer.web'

describe('chat webview resources and message states', () => {
  it('renders legacy markdown image refs as clickable image placeholders', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-legacy-image',
          role: 'user',
          ts: 1_000,
          content:
            '![desktop_screenshot.png](</Users/test/project/.uploads/desktop_screenshot.png>)\n\n你发图片给我干啥?',
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('attachment-image-placeholder')
    expect(html).toContain(
      'data-resource-path="/Users/test/project/.uploads/desktop_screenshot.png"',
    )
    expect(html).toContain('你发图片给我干啥?')
    expect(html).not.toContain('desktop_screenshot.png</button>')
  })

  it('keeps uploaded file refs in the message body instead of rendering duplicate file cards', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-file',
          role: 'user',
          ts: 1_000,
          content: '[notes.md](</Users/test/project/.uploads/notes.md>)\n\n帮我总结',
          attachments: [
            {
              path: '/Users/test/project/.uploads/notes.md',
              name: 'notes.md',
              mimeType: 'text/markdown',
              kind: 'file',
            },
          ],
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('href="&lt;/Users/test/project/.uploads/notes.md&gt;"')
    expect(html).toContain('notes.md')
    expect(html).not.toContain('attachment-file-card')
    expect(html).toContain('帮我总结')
  })

  it('reports http links as external link presses without treating them as resources', () => {
    const { dispatch, flushAnimationFrames, getHtml, getPostedMessages, triggerFirstHookedNode } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-link',
          role: 'agent',
          ts: 1_000,
          content: 'See [docs](https://example.com/path?q=1).',
        },
      ],
    })
    flushAnimationFrames()

    expect(getHtml()).toContain('target="_blank" rel="noopener noreferrer"')

    triggerFirstHookedNode('click')

    expect(getPostedMessages()).toContainEqual({
      type: 'linkPress',
      url: 'https://example.com/path?q=1',
    })
    expect(getPostedMessages()).not.toContainEqual({
      type: 'resourcePress',
      path: 'https://example.com/path?q=1',
    })
  })

  it.each(['agent', 'user'])(
    'keeps %s Worker Markdown as a card with its internal Session link',
    (role) => {
      const { dispatch, flushAnimationFrames, getHtml, getPostedMessages, triggerFirstHookedNode } =
        createHarness()

      const workerMarkdown =
        '[Agent 完成 · 上午简报](shennian://session/sess_worker_123)\n\n' +
        '第一行 **重点结果**。\n\n- 第二行 [详情](https://example.com)。\n' +
        '第三行结果。\n第四行仍属于完整正文。'

      dispatch({
        type: 'init',
        theme: { isDark: false, colors: {} },
        runPhase: 'idle',
        messages: [
          {
            id: 'm-worker-link',
            role,
            ts: 1_000,
            content: workerMarkdown,
          },
        ],
      })
      flushAnimationFrames()

      const html = getHtml()
      expect(html).toContain('class="worker-session-card"')
      expect(html).toContain('class="worker-session-title"')
      expect(html).toContain('class="worker-session-preview"')
      expect(html).toContain('class="worker-session-event">Agent 完成</span>')
      expect(html).toContain('class="worker-session-title">上午简报</span>')
      const preview = /<span class="worker-session-preview">([^<]*)<\/span>/.exec(html)?.[1]
      expect(preview).toBe('第一行 重点结果。 第二行 详情。 第三行结果。 第四行仍属于完整正文。')
      expect(preview).not.toContain('**重点结果**')
      expect(preview).not.toContain('[详情](https://example.com)')
      expect(html).toContain('第四行仍属于完整正文。')
      expect(CHAT_CSS_NATIVE).toContain('-webkit-line-clamp:1')
      expect(CHAT_CSS_WEB).toContain('-webkit-line-clamp:1')
      triggerFirstHookedNode('click')
      expect(getPostedMessages()).toContainEqual({
        type: 'linkPress',
        url: 'shennian://session/sess_worker_123',
      })
      const clickCount = getPostedMessages().filter(
        (message) => message.type === 'linkPress',
      ).length
      triggerFirstHookedNode('touchstart')
      triggerFirstHookedNode('touchend')
      triggerFirstHookedNode('click')
      expect(getPostedMessages().filter((message) => message.type === 'linkPress')).toHaveLength(
        clickCount + 1,
      )

      expect(html).not.toContain('message-copy')
      expect(getPostedMessages().some((message) => message.type === 'copyMessage')).toBe(false)
    },
  )

  it('keeps Worker activity visible instead of folding it into the process summary', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        { id: 'user-1', role: 'user', ts: 1_000, content: '安排任务' },
        {
          id: 'tool-1',
          role: 'agent',
          ts: 1_100,
          content: '',
          toolCalls: [{ name: 'start', status: 'completed' }],
        },
        {
          id: 'worker-created',
          role: 'agent',
          ts: 1_200,
          content: '[创建 Agent · 上午简报](shennian://session/sess_worker_123)\n\n完整任务正文。',
        },
        { id: 'agent-final', role: 'agent', ts: 1_300, content: '已安排。' },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect({
      collapsed: html.includes('data-virtual-key="collapsed-run-user-1"'),
      title: html.includes('class="worker-session-title">上午简报</span>'),
      body: html.includes('完整任务正文。'),
      final: html.includes('已安排。'),
    }).toEqual({ collapsed: false, title: true, body: true, final: true })
  })

  it('keeps every Worker lifecycle message independent across native and web timelines', () => {
    const lifecycleMessages = [
      ['created', '创建 Agent'],
      ['sent', '发送消息'],
      ['progress', 'Agent 执行中'],
      ['completed', 'Agent 完成'],
      ['failed', 'Agent 失败'],
      ['stopped', '停止 Agent'],
      ['localized', 'Worker lifecycle update'],
    ] as const

    for (const [kind, label] of lifecycleMessages) {
      const workerId = `worker-${kind}`
      const workerContent = `[${label} · 核对\\[时序\\]](shennian://session/sess_worker_${kind})\n\n${kind} 正文。`
      const messages: ChatMessage[] = [
        { id: `user-${kind}`, role: 'user', ts: 1_000, content: '继续执行' },
        { id: `before-${kind}`, role: 'agent', ts: 1_050, content: '先检查上下文。' },
        {
          id: `tool-before-${kind}`,
          role: 'agent',
          ts: 1_100,
          content: '',
          toolCalls: [{ name: 'command_execution', status: 'completed' }],
        },
        { id: workerId, role: 'agent', ts: 1_200, content: workerContent },
        { id: `after-${kind}`, role: 'agent', ts: 1_250, content: '整理最终结果。' },
        {
          id: `tool-after-${kind}`,
          role: 'agent',
          ts: 1_300,
          content: '',
          toolCalls: [{ name: 'command_execution', status: 'completed' }],
        },
        { id: `final-${kind}`, role: 'agent', ts: 1_400, content: `${kind} 最终回复。` },
      ]

      const { dispatch, flushAnimationFrames, getHtml } = createHarness()
      dispatch({
        type: 'init',
        theme: { isDark: false, colors: {} },
        runPhase: 'idle',
        messages,
      })
      flushAnimationFrames()
      const nativeHtml = getHtml()
      const beforeCollapsePosition = nativeHtml.indexOf(`data-detail-key="process:before-${kind}"`)
      const workerPosition = nativeHtml.indexOf(`data-id="${workerId}"`)
      const afterCollapsePosition = nativeHtml.indexOf(`data-detail-key="process:after-${kind}"`)
      const finalPosition = nativeHtml.indexOf(`data-id="final-${kind}"`)
      const collapsedMessageIds = Array.from(
        nativeHtml.matchAll(/data-process-ids="([^"]+)"/g),
        (match) => match[1].split(','),
      ).flat()

      expect({
        kind,
        processCollapseCount: nativeHtml.match(/class="process-collapse"/g)?.length,
        nativeItemIds: Array.from(nativeHtml.matchAll(/data-id="([^"]+)"/g), (match) => match[1]),
        workerExcludedFromCollapse: !collapsedMessageIds.includes(workerId),
        hasBody: nativeHtml.includes(`${kind} 正文。`),
        hidesIntermediateText:
          !nativeHtml.includes('先检查上下文。') && !nativeHtml.includes('整理最终结果。'),
        preservesTimelineOrder:
          beforeCollapsePosition >= 0 &&
          beforeCollapsePosition < workerPosition &&
          workerPosition < afterCollapsePosition &&
          afterCollapsePosition < finalPosition,
        webItems: buildWebRenderItems(messages, 'idle').map((item) => item.key),
      }).toEqual({
        kind,
        processCollapseCount: 2,
        nativeItemIds: [`user-${kind}`, workerId, `final-${kind}`],
        workerExcludedFromCollapse: true,
        hasBody: true,
        hidesIntermediateText: true,
        preservesTimelineOrder: true,
        webItems: [
          `user-${kind}`,
          `collapsed-process-before-${kind}`,
          workerId,
          `collapsed-process-after-${kind}`,
          `final-${kind}`,
        ],
      })
    }
  })

  it('expands only the latest turn in the web renderer while it runs and collapses it when idle', () => {
    const tool = (id: string, ts: number): ChatMessage => ({
      id,
      role: 'agent',
      ts,
      content: '',
      toolCalls: [{ name: 'command_execution', status: 'completed' }],
    })
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', ts: 1_000, content: '第一轮' },
      { id: 'old-progress', role: 'agent', ts: 1_100, content: '旧过程。' },
      tool('old-tool', 1_200),
      { id: 'old-final', role: 'agent', ts: 1_300, content: '旧结论。' },
      { id: 'user-2', role: 'user', ts: 2_000, content: '第二轮' },
      { id: 'new-progress', role: 'agent', ts: 2_100, content: '新过程。' },
      tool('new-tool-1', 2_200),
      tool('new-tool-2', 2_250),
      { id: 'new-final', role: 'agent', ts: 2_300, content: '新结论。' },
    ]

    expect(buildWebRenderItems(messages, 'streaming_text').map((item) => item.key)).toEqual([
      'user-1',
      'collapsed-run-user-1',
      'user-2',
      'new-progress',
      'tool-group-new-tool-1',
      'new-final',
    ])
    expect(buildWebRenderItems(messages, 'idle').map((item) => item.key)).toEqual([
      'user-1',
      'collapsed-run-user-1',
      'user-2',
      'collapsed-run-user-2',
    ])
    // Agent-turn items never carry a time separator; user messages still can.
    for (const phase of ['streaming_text', 'idle'] as const) {
      expect(
        buildWebRenderItems(messages, phase).map((item) => [item.key, !!item.continuesTurn]),
      ).toEqual(
        buildWebRenderItems(messages, phase).map((item) => [
          item.key,
          item.type !== 'message' || item.message.role !== 'user',
        ]),
      )
    }
  })

  it('keeps local markdown links on the resource preview path', () => {
    const { dispatch, flushAnimationFrames, getHtml, getPostedMessages, triggerFirstHookedNode } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-resource-link',
          role: 'agent',
          ts: 1_000,
          content: 'Open [plan](./docs/plan.md).',
        },
      ],
    })
    flushAnimationFrames()

    expect(getHtml()).not.toContain('target="_blank"')

    triggerFirstHookedNode('click')

    expect(getPostedMessages()).toContainEqual({
      type: 'resourcePress',
      path: './docs/plan.md',
    })
  })

  it('autolinks bare local file references to the resource preview path', () => {
    const { dispatch, flushAnimationFrames, getHtml, getPostedMessages, triggerFirstHookedNode } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-bare-resource',
          role: 'agent',
          ts: 1_000,
          content:
            'Changed /Users/me/project/src/App.tsx:42 and ignored https://example.com/readme.md plus `./src/inline.ts`.',
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('href="&lt;/Users/me/project/src/App.tsx:42&gt;"')
    expect(html).toContain('https://example.com/readme.md')
    expect(html).toContain('<code>./src/inline.ts</code>')

    triggerFirstHookedNode('click')

    expect(getPostedMessages()).toContainEqual({
      type: 'resourcePress',
      path: '/Users/me/project/src/App.tsx:42',
    })
  })

  it('opens inline code file references with line ranges from chat messages', () => {
    const { dispatch, flushAnimationFrames, getPostedMessages, triggerFirstHookedNode } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-inline-code-resource',
          role: 'agent',
          ts: 1_000,
          content: '引用文件：`packages/app/src/features/chat/FilePreviewPanel.tsx:120-136`',
        },
      ],
    })
    flushAnimationFrames()

    triggerFirstHookedNode('click')

    expect(getPostedMessages()).toContainEqual({
      type: 'resourcePress',
      path: 'packages/app/src/features/chat/FilePreviewPanel.tsx:120-136',
    })
  })

  it('normalizes file URL markdown links before sending resource presses', () => {
    const { dispatch, flushAnimationFrames, getPostedMessages, triggerFirstHookedNode } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-file-url',
          role: 'agent',
          ts: 1_000,
          content: 'Open [slides](file:///home/admin/phuse_us_2026_slides.html).',
        },
      ],
    })
    flushAnimationFrames()

    triggerFirstHookedNode('click')

    expect(getPostedMessages()).toContainEqual({
      type: 'resourcePress',
      path: '/home/admin/phuse_us_2026_slides.html',
    })
  })

  it('does not report dangerous markdown link schemes as external link presses', () => {
    const { dispatch, flushAnimationFrames, getPostedMessages, triggerFirstHookedNode } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-danger-link',
          role: 'agent',
          ts: 1_000,
          content: 'Ignore [bad](javascript:alert(1)).',
        },
      ],
    })
    flushAnimationFrames()

    triggerFirstHookedNode('click')

    expect(getPostedMessages().filter((message) => message.type === 'linkPress')).toHaveLength(0)
  })

  it('renders a visible sending label for optimistic user messages', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-sending',
          role: 'user',
          ts: 1_000,
          content: '还在发',
          status: 'sending',
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('sending-label')
    expect(html).toContain('发送中')
  })

  it.each([
    'Codex 请求执行命令：rm -rf dist',
    '[Agent 完成 · 不应遮蔽审批](shennian://session/sess_worker_approval)',
  ])('keeps approval higher priority than content %s', (content) => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-approval',
          role: 'agent',
          ts: 1_000,
          content,
          approval: {
            v: 1,
            type: 'approval_pending',
            title: '需要用户确认',
            content: 'Codex 请求执行命令：rm -rf dist',
            source: 'codex',
            actionHint: '当前神念暂不支持远程确认，请回到运行 Codex 的电脑/终端完成确认。',
          },
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('approval-card')
    expect(html).not.toContain('worker-session-card')
    expect(html).toContain('等待确认')
    expect(html).toContain('需要用户确认')
    expect(html).toContain('回到运行 Codex 的电脑/终端')
    expect(html).not.toContain('bubble-agent')
  })

  it('reports an empty long screenshot instead of hanging the native request', () => {
    const { dispatch, flushAnimationFrames, getPostedMessages } = createHarness()

    dispatch({
      type: 'captureLongScreenshot',
      requestId: 'shot-1',
    })
    flushAnimationFrames()

    expect(getPostedMessages()).toContainEqual({
      type: 'longScreenshotError',
      requestId: 'shot-1',
      error: 'empty',
    })
  })

  it('includes the Shennian brand footer in long screenshots', () => {
    const script = loadChatScript()

    expect(script).toContain('capture-brand-footer')
    expect(script).toContain('capture-brand-qr')
    expect(script).toContain('capture-brand-icon')
    expect(script).not.toContain('一个入口，掌控你的全部 AI Agent')
    expect(script).toContain(
      'captureLongScreenshot(data.requestId, data.brandUrl, data.brandLogoDataUrl, data.brandQrSvg)',
    )
  })

  it('clears an optimistic sending label when status is updated to null', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-sending',
          role: 'user',
          ts: 1_000,
          content: '还在发',
          status: 'sending',
        },
      ],
    })
    flushAnimationFrames()

    dispatch({
      type: 'updateStatus',
      msgId: 'm-sending',
      status: null,
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).not.toContain('sending-label')
    expect(html).not.toContain('发送中')
  })

  it('keeps a typing indicator visible during streaming_text until the first agent message appears', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'streaming_text',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          ts: 1_000,
          content: '继续',
        },
      ],
    })
    flushAnimationFrames()
    expect(getHtml()).toContain('typing-indicator')

    dispatch({
      type: 'addMessage',
      message: {
        id: 'm-agent',
        role: 'agent',
        ts: 1_001,
        content: '好的',
      },
    })
    flushAnimationFrames()
    expect(getHtml()).not.toContain('typing-indicator')
  })

  it('does not render quote actions for user and agent messages', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          ts: 1_000,
          content: '把麦克风做成常驻按钮',
        },
        {
          id: 'm-agent',
          role: 'agent',
          ts: 2_000,
          content: '我会先把录音入口接进输入栏。',
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).not.toContain('msg-action-btn')
    expect(html).not.toContain('data-quote-content=')
  })
})
