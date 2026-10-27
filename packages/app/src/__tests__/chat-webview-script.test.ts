// @covers packages/app/src/components/chat/webview/chat.js
// @covers packages/app/src/components/chat/webview/chatVirtualization.js
// @covers packages/app/src/components/chat/webview/chatHooks.js
// @covers packages/app/src/components/chat/webview/chatCopy.js

import { describe, expect, it } from 'vitest'
import { createHarness, createMessages, loadChatScript } from './chat-webview-harness'
import { CHAT_CSS_NATIVE, CHAT_CSS_WEB } from '../components/chat/webview/chatCss'
import {
  canOpenWorkerSession,
  parseWorkerSessionUrl,
} from '../features/chat/utils/workerSessionLink'

describe('chat outbound delivery states', () => {
  it('moves dispatched users and rebuilds turn groups when their timestamps change', () => {
    const { dispatch, getHtml, flushAnimationFrames } = createHarness()
    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        { id: 'ask-a', role: 'user', ts: 100, content: 'ask A' },
        { id: 'ask-b', role: 'user', ts: 110, content: 'ask B' },
        { id: 'ask-c', role: 'user', ts: 120, content: 'ask C' },
        { id: 'answer-a', role: 'agent', ts: 200, content: 'answer A' },
        { id: 'answer-b', role: 'agent', ts: 300, content: 'answer B' },
        { id: 'answer-c', role: 'agent', ts: 400, content: 'answer C' },
      ],
    })
    dispatch({ type: 'updateTimestamp', msgId: 'ask-b', ts: 210 })
    dispatch({ type: 'updateTimestamp', msgId: 'ask-c', ts: 310 })
    flushAnimationFrames()
    const html = getHtml()
    const positions = ['ask-a', 'answer-a', 'ask-b', 'answer-b', 'ask-c', 'answer-c'].map((id) =>
      html.indexOf(`data-id="${id}"`),
    )
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(html).not.toContain('class="process-collapse"')
  })

  it('acknowledges a snapshot revision only after the WebView render frames run', () => {
    const { dispatch, flushAnimationFrames, getPostedMessages } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [{ id: 'presented-1', role: 'agent', ts: 1, content: 'visible' }],
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })
    dispatch({ type: 'ackPresentation', presentationToken: 'session-1:42' })

    expect(getPostedMessages()).not.toContainEqual({
      type: 'messagesPresented',
      presentationToken: 'session-1:42',
    })
    flushAnimationFrames()
    expect(getPostedMessages()).toContainEqual({
      type: 'messagesPresented',
      presentationToken: 'session-1:42',
    })
  })

  it('places readable outbound status metadata below the user bubble', () => {
    expect(CHAT_CSS_NATIVE).toContain(
      '.msg-user { display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-end; gap:0; }',
    )
    expect(CHAT_CSS_WEB).toContain(
      '.cwv .msg-user { display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-end; gap:0; }',
    )
    expect(CHAT_CSS_NATIVE).toContain('font-size:12px; line-height:17px; padding:4px 4px 2px')
    expect(CHAT_CSS_WEB).toContain('font-size:12px; line-height:17px; padding:4px 4px 2px')
  })

  it('shares the semantic own-message color with the native and web chat renderers', () => {
    expect(CHAT_CSS_NATIVE).toContain('--own-message:rgba(59,130,246,0.08)')
    expect(CHAT_CSS_NATIVE).toContain('background:var(--own-message);')
    expect(CHAT_CSS_WEB).toContain('background:var(--own-message);')
  })

  it('keeps single and grouped tool summaries at the same readable level while nested details stay compact', () => {
    expect(CHAT_CSS_NATIVE).toMatch(
      /\.tool-disclosure > summary,[\s\S]*?\.tool-disclosure > summary \.tool-title \{ font-size:15px; line-height:22px; \}[\s\S]*?\.tool-group \.tool-item-label \{ font-size:13px; line-height:19px;[\s\S]*?\.process-collapse summary \{[\s\S]*?font-size:15px; line-height:22px;/,
    )
    expect(CHAT_CSS_WEB).toMatch(
      /\.cwv \.tool-disclosure > summary,[\s\S]*?\.cwv \.tool-disclosure > summary \.tool-title \{ font-size:15px; line-height:22px; \}[\s\S]*?\.cwv \.tool-group \.tool-item-label \{ font-size:13px; line-height:19px;[\s\S]*?\.cwv \.process-collapse summary \{[\s\S]*?font-size:15px; line-height:22px;/,
    )
  })

  it('renders sending and uncertain messages with the same delayed sending feedback', () => {
    const { dispatch, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        { id: 'sending-1', role: 'user', ts: 1, content: 'send now', status: 'sending' },
        { id: 'uncertain-1', role: 'user', ts: 2, content: 'check delivery', status: 'uncertain' },
      ],
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })

    expect(getHtml()).toContain('data-id="sending-1"')
    expect(getHtml()).toContain('sending-status')
    expect(getHtml()).toContain('data-id="uncertain-1"')
    expect(getHtml().match(/sending-status/g)).toHaveLength(2)
    expect(getHtml()).not.toContain('uncertain-status')
    expect(getHtml()).not.toContain('暂未确认送达')
    expect(getHtml()).not.toContain('重发')
    expect(CHAT_CSS_NATIVE).toContain('350ms')
    expect(CHAT_CSS_WEB).toContain('350ms')
    expect(CHAT_CSS_NATIVE).toContain('8s')
    expect(CHAT_CSS_WEB).toContain('8s')
  })

  it('keeps successful messages quiet and renders failures without retry controls', () => {
    const { dispatch, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        { id: 'sent-1', role: 'user', ts: 1, content: 'delivered', status: 'sent' },
        { id: 'failed-1', role: 'user', ts: 2, content: 'failed', status: 'error' },
      ],
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })

    expect(getHtml()).toContain('data-id="sent-1"')
    expect(getHtml()).not.toContain('<span class="sent">✓</span>')
    expect(getHtml()).toContain('data-id="failed-1"')
    expect(getHtml()).toContain('发送失败')
    expect(getHtml()).not.toContain('error-resend')
    expect(getHtml()).not.toContain('重发')
  })

  it('shows a stopped Desktop thread as a plain temporary send failure', () => {
    const { dispatch, getHtml } = createHarness()
    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        {
          id: 'desktop-stopped',
          role: 'user',
          ts: 1,
          content: 'try again',
          status: 'error',
          ephemeralFailure: true,
        },
      ],
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })

    expect(getHtml()).toContain('ephemeral-error')
    expect(getHtml()).toContain('发送失败')
    expect(getHtml()).not.toContain('error-resend')
  })

  it('keeps internal queue state out of the visible message UI', () => {
    const { dispatch, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        {
          id: 'client-q1',
          role: 'user',
          ts: 1,
          content: 'queued work',
          status: 'sending',
          queueMessageId: 'queue-q1',
        },
      ],
      runPhase: 'thinking',
      initialScroll: { kind: 'bottom' },
    })

    expect(getHtml()).toContain('queued work')
    expect(getHtml()).not.toContain('queued-label')
    expect(getHtml()).not.toContain('queued-edit')
    expect(getHtml()).not.toContain('queued-delete')
    expect(getHtml()).not.toContain('sending-status')
  })
})

describe('chat webview history prepend', () => {
  it('does not add a time separator when an agent reply crosses a minute boundary', () => {
    const { dispatch, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        { id: 'user-at-40', role: 'user', ts: 40 * 60_000 + 59_000, content: 'question' },
        { id: 'agent-at-41', role: 'agent', ts: 41 * 60_000, content: 'latest preview' },
      ],
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })

    // Only the turn's user message carries a time; the reply stays part of it.
    expect(getHtml().match(/time-separator/g)).toHaveLength(1)
  })

  it('keeps a bounded mobile DOM for long conversations while retaining the latest messages', () => {
    const { dispatch, flushAnimationFrames, getHtml, getParsedMarkdownInputs } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(500),
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html.match(/data-virtual-key=/g)?.length).toBeLessThanOrEqual(16)
    expect(html).toContain('data-id="m-1499"')
    expect(html).not.toContain('data-id="m-1000"')
    expect(getParsedMarkdownInputs().length).toBeLessThanOrEqual(16)
  })

  it('expands the smaller cold-open window when the user scrolls into older content', () => {
    const { dispatch, flushAnimationFrames, getHtml, getTopVirtualSpacerHeight, setScrollTop } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(80),
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })

    expect(getHtml().match(/data-virtual-key=/g)?.length).toBeLessThanOrEqual(16)
    expect(getHtml()).not.toContain('data-id="m-1048"')

    setScrollTop(getTopVirtualSpacerHeight() + 20)
    flushAnimationFrames()

    expect(getHtml()).toContain('data-id="m-1048"')
    expect(getHtml()).toContain('data-id="m-1079"')
    expect(getHtml().match(/data-virtual-key=/g)?.length).toBeLessThanOrEqual(48)
  })

  it('restores legacy numeric positions onto rendered content instead of a virtual spacer', () => {
    const { dispatch, getFirstVisibleVirtualKey, getHtml, scrollRoot } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(200),
      runPhase: 'idle',
      initialScroll: { kind: 'position', scrollTop: 50_000, distanceFromBottom: 8_000 },
    })

    expect(getHtml()).toContain('data-virtual-key=')
    expect(getFirstVisibleVirtualKey()).not.toBeNull()
    expect(scrollRoot.scrollTop).toBeLessThan(scrollRoot.scrollHeight - scrollRoot.clientHeight)
  })

  it('slides the virtual window upward and reuses cached markdown when returning', () => {
    const {
      dispatch,
      flushAnimationFrames,
      flushTimers,
      getHtml,
      getParsedMarkdownInputs,
      getTopVirtualSpacerHeight,
      scrollRoot,
      setScrollTop,
    } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(240),
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })
    flushAnimationFrames()

    const initialParseCount = getParsedMarkdownInputs().length
    const initialHtml = getHtml()
    const initialFirstId = /data-id="([^"]+)"/.exec(initialHtml)?.[1]
    expect(initialFirstId).toBeTruthy()

    setScrollTop(getTopVirtualSpacerHeight() + 20)
    flushAnimationFrames()
    flushTimers()

    const olderHtml = getHtml()
    expect(olderHtml).not.toBe(initialHtml)
    expect(olderHtml).toContain('data-id="m-1192"')
    expect(olderHtml.match(/data-virtual-key=/g)?.length).toBeLessThanOrEqual(48)
    expect(getParsedMarkdownInputs().length - initialParseCount).toBeLessThanOrEqual(48)

    setScrollTop(scrollRoot.scrollHeight - scrollRoot.clientHeight - 20)
    flushAnimationFrames()
    flushTimers()

    expect(getHtml()).toContain('data-id="m-1239"')
    expect(getParsedMarkdownInputs().length).toBeLessThan(140)
  })

  it('materializes messages when inertial scrolling lands inside a virtual spacer', () => {
    const {
      dispatch,
      flushAnimationFrames,
      getFirstVisibleVirtualKey,
      getHtml,
      getTopVirtualSpacerHeight,
      scrollRoot,
      setScrollTop,
    } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(500),
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })
    flushAnimationFrames()

    const jumpTarget = Math.floor(getTopVirtualSpacerHeight() / 2)
    expect(jumpTarget).toBeGreaterThan(scrollRoot.clientHeight)
    setScrollTop(jumpTarget)
    flushAnimationFrames()

    expect(scrollRoot.scrollTop).toBe(jumpTarget)
    expect(getFirstVisibleVirtualKey()).not.toBeNull()
    expect(getHtml().match(/data-virtual-key=/g)?.length).toBeLessThanOrEqual(48)
    expect(getHtml()).not.toContain('data-id="m-1499"')
  })

  it('keeps the viewport anchored when older pages are prepended to a virtual window', () => {
    const {
      dispatch,
      flushAnimationFrames,
      getFirstVisibleVirtualKey,
      getTopVirtualSpacerHeight,
      setScrollTop,
    } = createHarness()
    const initialMessages = createMessages(160, 10_000)

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: initialMessages,
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })
    flushAnimationFrames()
    setScrollTop(getTopVirtualSpacerHeight() + 20)
    flushAnimationFrames()

    const anchorBefore = getFirstVisibleVirtualKey()
    dispatch({
      type: 'prependMessages',
      messages: createMessages(80, 1_000),
    })
    flushAnimationFrames()

    expect(getFirstVisibleVirtualKey()).toBe(anchorBefore)
  })

  it('reaches the real loaded-history top so native pagination can continue', () => {
    const {
      dispatch,
      flushAnimationFrames,
      flushTimers,
      getPostedMessages,
      getTopVirtualSpacerHeight,
      setScrollTop,
    } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(180),
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })
    flushAnimationFrames()

    for (let index = 0; index < 20 && getTopVirtualSpacerHeight() > 0; index += 1) {
      setScrollTop(getTopVirtualSpacerHeight() + 10)
      flushAnimationFrames()
    }
    setScrollTop(10)
    flushTimers()

    expect(getTopVirtualSpacerHeight()).toBe(0)
    expect(getPostedMessages()).toContainEqual(
      expect.objectContaining({ type: 'scrollState', distanceFromTop: 10, scrollTop: 10 }),
    )
  })

  it('builds the full loaded transcript only when a long screenshot requests it', () => {
    const { dispatch, flushAnimationFrames, getFullCaptureHtml, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(200),
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })
    flushAnimationFrames()

    expect(getHtml()).not.toContain('data-id="m-1000"')
    const captureHtml = getFullCaptureHtml()
    expect(captureHtml).toContain('data-id="m-1000"')
    expect(captureHtml).toContain('data-id="m-1199"')
  })

  it('starts at the latest messages on mobile init', () => {
    const { dispatch, flushAnimationFrames, scrollRoot } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(8),
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })

    flushAnimationFrames()
    expect(scrollRoot.scrollTop).toBe(scrollRoot.scrollHeight)
  })

  it('restores a saved mobile reading position on init', () => {
    const { dispatch, flushAnimationFrames, scrollRoot } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(8),
      runPhase: 'idle',
      initialScroll: { kind: 'position', scrollTop: 180, distanceFromBottom: 320 },
    })

    flushAnimationFrames()
    expect(scrollRoot.scrollTop).toBe(180)
  })

  it('keeps the mobile viewport anchored after prepending older messages', () => {
    const { dispatch, flushAnimationFrames, scrollRoot, setScrollTop } = createHarness()
    const initialMessages = createMessages(6)
    const olderMessages = createMessages(2, 100)

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: initialMessages,
      runPhase: 'idle',
    })
    flushAnimationFrames()

    const oldHeight = scrollRoot.scrollHeight
    setScrollTop(80)

    dispatch({
      type: 'prependMessages',
      messages: olderMessages,
    })

    const expectedScrollTop = 80 + (scrollRoot.scrollHeight - oldHeight)
    expect(scrollRoot.scrollTop).toBe(expectedScrollTop)

    flushAnimationFrames()
    expect(scrollRoot.scrollTop).toBe(expectedScrollTop)
  })

  it('reports distance from top while scrolling', () => {
    const { dispatch, flushAnimationFrames, flushTimers, getPostedMessages, setScrollTop } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(8),
      runPhase: 'idle',
      initialScroll: { kind: 'bottom' },
    })
    flushAnimationFrames()

    setScrollTop(120)
    flushTimers()

    expect(getPostedMessages()).toContainEqual(
      expect.objectContaining({
        type: 'scrollState',
        distanceFromTop: 120,
        scrollTop: 120,
      }),
    )
  })

  it('does not auto-follow while the user is actively dragging away from the bottom', () => {
    const { dispatch, flushAnimationFrames, scrollRoot, setScrollTop, triggerRootEvent } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: createMessages(6),
      runPhase: 'idle',
    })
    flushAnimationFrames()

    triggerRootEvent('touchstart')
    const draggedScrollTop = 120
    setScrollTop(draggedScrollTop)

    dispatch({
      type: 'addMessage',
      message: {
        id: 'm-new',
        role: 'agent',
        ts: 9_999,
        content: 'streaming keeps going',
      },
    })
    flushAnimationFrames()

    expect(scrollRoot.scrollTop).toBe(draggedScrollTop)

    triggerRootEvent('touchend')
  })

  it('inserts a late user message before the answer it belongs to', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        { id: 'user-older', role: 'user', ts: 1_000, content: 'older question' },
        { id: 'agent-answer', role: 'agent', ts: 3_000, content: 'answer' },
      ],
      runPhase: 'idle',
    })
    flushAnimationFrames()

    dispatch({
      type: 'addMessage',
      message: { id: 'user-late', role: 'user', ts: 2_000, content: 'late question' },
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html.indexOf('data-id="user-older"')).toBeLessThan(html.indexOf('data-id="user-late"'))
    expect(html.indexOf('data-id="user-late"')).toBeLessThan(html.indexOf('data-id="agent-answer"'))
  })

  it('linearly merges an out-of-order message batch into the existing timeline', () => {
    const { dispatch, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        { id: 'm-1', role: 'user', ts: 1_000, content: 'one' },
        { id: 'm-4', role: 'user', ts: 4_000, content: 'four' },
      ],
      runPhase: 'idle',
    })
    dispatch({
      type: 'addMessages',
      messages: [
        { id: 'm-3', role: 'user', ts: 3_000, content: 'three' },
        { id: 'm-2', role: 'user', ts: 2_000, content: 'two' },
      ],
    })

    const html = getHtml()
    expect(html.indexOf('data-id="m-1"')).toBeLessThan(html.indexOf('data-id="m-2"'))
    expect(html.indexOf('data-id="m-2"')).toBeLessThan(html.indexOf('data-id="m-3"'))
    expect(html.indexOf('data-id="m-3"')).toBeLessThan(html.indexOf('data-id="m-4"'))
    const source = loadChatScript()
    expect(source).toContain('_messages = mergeMessagesByTimestamp(_messages, added)')
    expect(source).not.toContain('insertMessageByTimestamp(added[ai])')
  })

  it('renders structured user attachments without duplicating generated markdown refs', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-1',
          role: 'user',
          ts: 1_000,
          content: '![shot.png](</Users/test/project/.uploads/shot.png>)\n\n帮我看看',
          attachments: [
            {
              path: '/Users/test/project/.uploads/shot.png',
              name: 'shot.png',
              mimeType: 'image/png',
              kind: 'image',
              previewData: 'abc123',
            },
          ],
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('attachment-thumb-btn')
    expect(html).toContain('attachment-thumb-fallback')
    expect(html).toContain('onerror="this.style.display')
    expect(html).toContain('data-resource-path="/Users/test/project/.uploads/shot.png"')
    expect(html).toContain('帮我看看')
    expect(html).not.toContain('![shot.png]')
  })

  it('lazily requests visible image previews and installs a local file URL', () => {
    const { dispatch, flushAnimationFrames, getHtml, getPostedMessages } = createHarness()
    const path = '/Users/test/project/.uploads/large.png'

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-lazy-image',
          role: 'user',
          ts: 1_000,
          content: `![large.png](<${path}>)`,
        },
      ],
    })
    flushAnimationFrames()

    expect(getPostedMessages()).toContainEqual({
      type: 'attachmentPreviewRequest',
      messageId: 'm-lazy-image',
      path,
      name: 'large.png',
      mimeType: 'image/png',
    })

    dispatch({
      type: 'updateAttachmentPreview',
      msgId: 'm-lazy-image',
      path,
      name: 'large.png',
      mimeType: 'image/png',
      previewUrl: 'file:///cache/chat-image-previews/hash.jpg',
    })

    expect(getHtml()).toContain('src="file:///cache/chat-image-previews/hash.jpg"')
    expect(getHtml()).not.toContain('base64,file:///cache')
  })

  it('requests a cached image again when a send reconciliation rebuilds the document', () => {
    const { dispatch, flushAnimationFrames, getPostedMessages } = createHarness()
    const path = '/Users/test/project/.uploads/reconciled.png'
    const snapshot = {
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'thinking',
      messages: [
        {
          id: 'user-reconciled-image',
          role: 'user',
          ts: 1_000,
          content: `![reconciled.png](<${path}>)`,
        },
      ],
    }

    dispatch(snapshot)
    flushAnimationFrames()
    dispatch(snapshot)
    flushAnimationFrames()

    const requests = getPostedMessages().filter(
      (message) =>
        message.type === 'attachmentPreviewRequest' &&
        message.messageId === 'user-reconciled-image',
    )
    expect(requests).toHaveLength(2)
  })

  it('keeps per-message copy actions hidden until hover or long press', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness({
      i18n: { copy: 'Copy', copied: 'Copied' },
    })

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        { id: 'user-copy', role: 'user', ts: 1_000, content: 'please **keep** markdown' },
        { id: 'agent-copy', role: 'agent', ts: 2_000, content: 'answer with `code`' },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('class="msg-copy-btn"')
    expect(html).toContain('data-msg-id="user-copy"')
    expect(html).toContain('data-msg-id="agent-copy"')
    expect(CHAT_CSS_NATIVE).toContain('.msg-row.msg-actions-open .msg-copy-btn { display:block; }')
    expect(CHAT_CSS_WEB).not.toContain(
      '@media (max-width: 640px) {\n  .cwv .msg-copy-btn {\n    opacity:1;',
    )
  })

  it('keeps the copy action visible after the synthetic click that follows a long press', () => {
    const { triggerMessageLongPress } = createHarness()

    const action = triggerMessageLongPress(180, 300)

    expect(action.isOpen()).toBe(true)
    expect(action.clickPrevented()).toBe(true)
    expect(action.style).toMatchObject({
      left: '144px',
      right: 'auto',
      top: '244px',
    })
    expect(CHAT_CSS_NATIVE).toContain('position:fixed')
    expect(CHAT_CSS_NATIVE).toContain('min-height:44px')
  })

  it('copies the original markdown text instead of rendered html', () => {
    const { dispatch, flushAnimationFrames, getPostedMessages, triggerRenderedMessageCopy } =
      createHarness({
        i18n: { copy: 'Copy', copied: 'Copied' },
      })

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'agent-md',
          role: 'agent',
          ts: 1_000,
          content: 'answer with `code` and **bold**',
        },
      ],
    })
    flushAnimationFrames()

    const button = triggerRenderedMessageCopy('agent-md')

    expect(getPostedMessages().at(-1)).toEqual({
      type: 'copyMessage',
      text: 'answer with `code` and **bold**',
    })
    expect(button.textContent).toBe('✓ Copied')
  })

  it('replaces streaming content when a reconciled agent message is not a prefix append', () => {
    const { dispatch, flushAnimationFrames, getHtml, getParsedMarkdownInputs } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'streaming_text',
      messages: [{ id: 'agent-reconcile', role: 'agent', ts: 1_000, content: 'partial draft' }],
    })
    flushAnimationFrames()

    dispatch({
      type: 'updateContent',
      msgId: 'agent-reconcile',
      content: 'final answer\n\n- visible item',
    })

    expect(getParsedMarkdownInputs().at(-1)).toBe('final answer\n\n- visible item')
    expect(getHtml()).toContain('final answer')
    expect(getHtml()).toContain('visible item')
    expect(getHtml()).not.toContain('partial draft')
  })

  it('throttles long streaming markdown rerenders while preserving the latest token', () => {
    const { dispatch, flushTimers, getHtml, getParsedMarkdownInputs } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'streaming_text',
      messages: [{ id: 'agent-long-stream', role: 'agent', ts: 1_000, content: 'start' }],
    })
    const parsedAfterInit = getParsedMarkdownInputs().length

    for (let i = 0; i < 20; i += 1) {
      dispatch({
        type: 'streamToken',
        msgId: 'agent-long-stream',
        token: `\n- chunk-${i}`,
      })
    }

    expect(getParsedMarkdownInputs().length).toBeLessThanOrEqual(parsedAfterInit + 1)
    flushTimers()
    expect(getParsedMarkdownInputs().length).toBeLessThanOrEqual(parsedAfterInit + 2)
    expect(getParsedMarkdownInputs().at(-1)).toContain('chunk-19')
    expect(getHtml()).toContain('chunk-19')

    const parsedBeforeFinal = getParsedMarkdownInputs().length
    dispatch({ type: 'setRunPhase', runPhase: 'idle' })
    expect(getParsedMarkdownInputs().length).toBeLessThanOrEqual(parsedBeforeFinal + 1)
    expect(getParsedMarkdownInputs().at(-1)).toContain('chunk-19')
  })

  it('uses plain-text incremental streaming and reserves full Markdown for finalization', () => {
    const source = loadChatScript()

    expect(source).toContain("el.classList.add('md-streaming-plain')")
    expect(source).toContain('el.appendChild(document.createTextNode(')
    expect(source).toContain("el.textContent = String(content || '')")
    expect(source).toContain('el.innerHTML = renderMarkdown(content)')
    expect(source).toContain("postToRN({ type: 'perfSnapshot'")
  })

  it('collapses the running turn into a process summary once the run becomes idle', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'streaming_text',
      messages: [
        { id: 'user-1', role: 'user', ts: 1_000, content: 'continue' },
        {
          id: 'tool-1',
          role: 'agent',
          ts: 1_100,
          content: '',
          toolCalls: [{ name: 'read_file', status: 'completed' }],
        },
        {
          id: 'tool-2',
          role: 'agent',
          ts: 1_200,
          content: '',
          toolCalls: [{ name: 'shell_command', status: 'completed' }],
        },
        { id: 'agent-final', role: 'agent', ts: 1_300, content: 'finished' },
      ],
    })
    flushAnimationFrames()
    expect(getHtml()).not.toContain('process-collapse')
    expect(getHtml()).toContain('data-virtual-key="tool-group-tool-1"')
    expect(getHtml()).toContain('2 个工具')

    dispatch({ type: 'setRunPhase', runPhase: 'idle' })
    flushAnimationFrames()

    expect(getHtml()).toContain('process-collapse')
    expect(getHtml()).toContain('2 个工具')
    expect(getHtml()).toContain('data-virtual-key="collapsed-run-user-1"')
    expect(getHtml()).toContain('data-loaded="false"')
    expect(getHtml()).toContain('finished')
  })

  it('does not render message copy buttons for image-only or tool messages', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'image-only',
          role: 'user',
          ts: 1_000,
          content: '![shot.png](</Users/test/project/.uploads/shot.png>)',
        },
        {
          id: 'tool-only',
          role: 'agent',
          ts: 2_000,
          content: '',
          toolCalls: [{ id: 't1', name: 'read', args: {}, result: 'ok' }],
        },
      ],
    })
    flushAnimationFrames()

    expect(getHtml()).not.toContain('class="msg-copy-btn"')
  })

  it('reports image context menus to native for saving', () => {
    const { dispatch, flushAnimationFrames, getPostedMessages, triggerFirstHookedNode } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-1',
          role: 'user',
          ts: 1_000,
          content: '![shot.png](</Users/test/project/.uploads/shot.png>)',
          attachments: [
            {
              path: '/Users/test/project/.uploads/shot.png',
              name: 'shot.png',
              mimeType: 'image/png',
              kind: 'image',
              previewData: 'abc123',
            },
          ],
        },
      ],
    })
    flushAnimationFrames()

    triggerFirstHookedNode('contextmenu')

    expect(getPostedMessages()).toContainEqual({
      type: 'imageLongPress',
      path: '/Users/test/project/.uploads/shot.png',
    })
  })
})

describe('Worker Session internal links', () => {
  it('accepts only a single encoded Worker Session id', () => {
    expect(parseWorkerSessionUrl('shennian://session/sess_worker_123')).toBe('sess_worker_123')
    expect(parseWorkerSessionUrl('shennian://session/sess_worker_%E4%BB%BB%E5%8A%A1')).toBe(
      'sess_worker_任务',
    )
    expect(parseWorkerSessionUrl('shennian://session/ordinary')).toBeNull()
    expect(parseWorkerSessionUrl('shennian://session/sess_worker_1?manager=secret')).toBeNull()
    expect(parseWorkerSessionUrl('https://example.com/sess_worker_1')).toBeNull()
  })

  it('authorizes owned same-project Worker links from Manager and native Skill conversations', () => {
    const source = {
      id: 'native-claude-session',
      machineId: 'machine-1',
      userId: 'user-1',
      workDir: '/project',
      canManage: true,
    }
    const worker = {
      ...source,
      id: 'sess_worker_123',
    }
    expect(canOpenWorkerSession(source, worker, 'user-1')).toBe(true)
    expect(canOpenWorkerSession({ ...source, canManage: false }, worker, 'user-1')).toBe(false)
    expect(canOpenWorkerSession(source, { ...worker, machineId: 'machine-2' }, 'user-1')).toBe(
      false,
    )
    expect(canOpenWorkerSession(source, { ...worker, workDir: '/other' }, 'user-1')).toBe(false)
    expect(canOpenWorkerSession(source, { ...worker, id: 'ordinary-session' }, 'user-1')).toBe(
      false,
    )
  })
})
