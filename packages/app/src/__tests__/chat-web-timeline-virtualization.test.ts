// @covers packages/app/src/components/chat/webTimelineVirtualization.web.tsx
// @covers packages/app/src/components/chat/ChatWebView.web.tsx
// @covers packages/app/src/components/chat/LazyChatDisclosure.web.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseWorkerCard, workerCardInnerHtml } from '../components/chat/webview/workerCard'
import { LazyChatDisclosure } from '../components/chat/LazyChatDisclosure.web'
import { RenderChatItem } from '../components/chat/ChatWebMessageRenderer.web'
import {
  WEB_TIMELINE_MAX_ITEMS,
  WEB_TIMELINE_ACTIVE_ITEMS,
  WEB_TIMELINE_SCROLL_ROOT_STYLE,
  buildEstimatedOffsets,
  captureWebTimelineAnchor,
  calculateWebTimelineRange,
  compensateWebTimelineScrollTop,
  estimateWebTimelineItemHeight,
  findIndexAtOffset,
  relocateWebTimelineRange,
  restoreWebTimelineAfterMeasurement,
  restoreWebTimelineAnchor,
  settleWebTimelineFollowedViewport,
} from '../components/chat/webTimelineVirtualization.web'

describe('desktop web chat timeline virtualization', () => {
  it('disables native scroll anchoring while the virtual timeline owns compensation', () => {
    expect(WEB_TIMELINE_SCROLL_ROOT_STYLE).toEqual({ overflowAnchor: 'none' })
  })

  it('settles a followed live viewport immediately without moving an earlier reading position', () => {
    const followed = { scrollHeight: 5_000, clientHeight: 800, scrollTop: 4_100 }
    expect(settleWebTimelineFollowedViewport(followed, false)).toBe(true)
    expect(followed.scrollTop).toBe(5_000)

    const reading = { scrollHeight: 5_000, clientHeight: 800, scrollTop: 2_000 }
    expect(settleWebTimelineFollowedViewport(reading, false)).toBe(false)
    expect(reading.scrollTop).toBe(2_000)
  })

  it('preserves identifiers and rejects unknown events without inventing a card', () => {
    const parsed = parseWorkerCard('[创建 Agent · 标题 · 子标题](shennian://session/sess_worker_example)\n\n**重要** `STOP_OK_0467` /a_b/file.ts\n\n- 正文')!
    expect(parsed.title).toBe('标题 · 子标题')
    expect(parsed.preview).toBe('重要 STOP_OK_0467 /a_b/file.ts 正文')
    expect(parseWorkerCard('[普通回复 · 标题](shennian://session/sess_worker_example)')).toBeNull()
    expect(parseWorkerCard('[Agent 完成 · 标题](https://example.com)')).toBeNull()
    expect(workerCardInnerHtml({ ...parsed, title: '<img src=x onerror=alert(1)>' })).not.toContain('<img')
  })
  it.each([
    ['创建 Agent', 'created'], ['Agent 完成', 'completed'], ['Agent 执行中', 'progress'],
    ['发送消息', 'message'], ['Agent 失败', 'failed'], ['停止 Agent', 'stopped'],
  ])('renders the historical %s event independently of live Worker state', (label, kind) => {
    const parsed = parseWorkerCard(`[${label} · 标题](shennian://session/sess_worker_example)`)!
    expect(parsed.kind).toBe(kind)
    expect(workerCardInnerHtml(parsed)).toContain(`worker-event-${kind}`)
    expect(workerCardInnerHtml(parsed)).not.toContain('worker-session-preview')
  })

  it('renders a Worker message as one linked card with the complete preview source', () => {
    const content =
      '[Agent 完成 · 桌面验收](shennian://session/sess_worker_desktop)\n\n' +
      '第一行 **重点**。\n\n- 第二行 [详情](https://example.com)。\n' +
      '第三行。\n第四行只在预览中被视觉截断。'
    const html = renderToStaticMarkup(createElement(RenderChatItem, {
      item: {
        type: 'message',
        key: 'worker-message',
        ts: 1_000,
        lastTs: 1_000,
        message: { id: 'worker-message', role: 'user', ts: 1_000, content },
      },
    }))

    expect(html).toContain('class="worker-session-card"')
    expect(html).toContain('href="shennian://session/sess_worker_desktop"')
    expect(html).toContain('class="worker-session-title">桌面验收</span>')
    expect(html).toContain('class="worker-session-event">Agent 完成</span>')
    expect(html).toContain('worker-event-completed')
    expect(html).toContain('worker-card-chevron')
    expect(html).toContain('class="worker-session-preview">第一行 重点。 第二行 详情。 第三行。 第四行只在预览中被视觉截断。</span>')
    expect(html).not.toContain('**重点**')
    expect(html).not.toContain('[详情](https://example.com)')
    expect(html).not.toContain('class="msg-copy-btn"')
  })

  it('does not construct hidden process bodies on first render', () => {
    const body = vi.fn(() => createElement('pre', null, 'large tool result'))
    const html = renderToStaticMarkup(createElement(LazyChatDisclosure, {
      className: 'process-collapse', summary: createElement('summary', null, 'Tools'), children: body,
    }))
    expect(html).toContain('<summary>Tools</summary>')
    expect(html).not.toContain('large tool result')
    expect(body).not.toHaveBeenCalled()
  })
  it('keeps a 500-item cold open on the latest bounded window', () => {
    const offsets = buildEstimatedOffsets(500, () => 100)
    expect(
      calculateWebTimelineRange({
        count: 500,
        scrollTop: 0,
        viewportHeight: 800,
        offsets,
        initialBottom: true,
      }),
    ).toEqual({ start: 484, end: 500 })
  })

  it('materializes the viewport reached through a large spacer jump', () => {
    const offsets = buildEstimatedOffsets(500, (index) => (index === 250 ? 400 : 100))
    const range = calculateWebTimelineRange({
      count: 500,
      scrollTop: 25_200,
      viewportHeight: 800,
      offsets,
    })
    expect(range.end - range.start).toBeLessThanOrEqual(WEB_TIMELINE_MAX_ITEMS)
    expect(range.end - range.start).toBeGreaterThanOrEqual(WEB_TIMELINE_ACTIVE_ITEMS)
    expect(range.start).toBeLessThanOrEqual(findIndexAtOffset(offsets, 25_200))
    expect(range.end).toBeGreaterThan(findIndexAtOffset(offsets, 26_000))
  })

  it('reserves more space for long markdown and attachment-heavy rows', () => {
    const short = estimateWebTimelineItemHeight({ message: { content: 'ok' } })
    const long = estimateWebTimelineItemHeight({
      message: { content: 'x'.repeat(1_000), attachments: [{}, {}] },
    })
    expect(long).toBeGreaterThan(short)
    expect(long).toBeLessThanOrEqual(1_800)
  })

  it('retains the same first rendered item when older messages are prepended', () => {
    const previous = Array.from({ length: 80 }, (_, index) => `m-${index + 20}`)
    const next = Array.from({ length: 100 }, (_, index) => `m-${index}`)
    expect(relocateWebTimelineRange(previous, next, { start: 16, end: 64 })).toEqual({
      start: 36,
      end: 84,
    })

    const oldScrollTop = 1_620
    const oldAnchorContentTop = 1_600
    const newAnchorContentTop = 3_600
    const compensated = compensateWebTimelineScrollTop(
      oldScrollTop,
      oldAnchorContentTop,
      newAnchorContentTop,
    )
    expect(compensated).toBe(3_620)
    expect(oldAnchorContentTop - oldScrollTop).toBe(newAnchorContentTop - compensated)
  })

  it('keeps the anchor stable when measured heights above it change', () => {
    const compensated = compensateWebTimelineScrollTop(5_000, 5_120, 5_360)
    expect(compensated).toBe(5_240)
    expect(5_120 - 5_000).toBe(5_360 - compensated)
  })

  it('keeps measured live growth at the bottom without moving an earlier reader', () => {
    const keys = ['a', 'b', 'c']
    const offsets = [0, 100, 240, 420]
    const anchor = { key: 'b', offsetWithinItem: 30 }

    expect(restoreWebTimelineAfterMeasurement({
      followsBottom: true,
      scrollHeight: 5_420,
      keys,
      offsets,
      snapshot: anchor,
      fallbackScrollTop: 4_800,
    })).toBe(5_420)

    expect(restoreWebTimelineAfterMeasurement({
      followsBottom: false,
      scrollHeight: 5_420,
      keys,
      offsets,
      snapshot: anchor,
      fallbackScrollTop: 90,
    })).toBe(130)
  })

  it('restores a stable keyed anchor from offsets without synchronous DOM measurement', () => {
    const previousKeys = ['a', 'b', 'c', 'd']
    const previousOffsets = [0, 100, 200, 300, 400]
    const anchor = captureWebTimelineAnchor(previousKeys, previousOffsets, 235)
    expect(anchor).toEqual({ key: 'c', offsetWithinItem: 35 })

    const nextKeys = ['older-1', 'older-2', ...previousKeys]
    const nextOffsets = [0, 80, 170, 270, 390, 490, 590]
    expect(restoreWebTimelineAnchor(nextKeys, nextOffsets, anchor, 235)).toBe(425)

    const source = readFileSync(
      resolve(__dirname, '../components/chat/webTimelineVirtualization.web.tsx'),
      'utf8',
    )
    expect(source).not.toContain('getBoundingClientRect')
  })

  it('integrates the virtual timeline and materializes all items only for capture', () => {
    const source = readFileSync(
      resolve(__dirname, '../components/chat/ChatWebView.web.tsx'),
      'utf8',
    )
    expect(source).toContain('<VirtualizedWebTimeline')
    expect(source).toContain('timelineRef.current.withAllItems')
    expect(source).not.toContain('renderItems.map((item, i)')
  })
})
