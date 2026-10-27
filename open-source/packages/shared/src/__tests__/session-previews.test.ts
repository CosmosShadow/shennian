// @covers open-source/packages/shared/src/hooks/useSessionPreviews.ts
// @covers open-source/packages/shared/src/lib/preview-display-text.ts
// @covers open-source/packages/shared/src/lib/session-preview.ts

import { describe, expect, it } from 'vitest'
import {
  extractLatestReadablePreview,
  extractPreviewText,
  isToolCallPayload,
  SESSION_PREVIEW_MAX_LEN,
  trimPreviewText,
} from '../hooks/useSessionPreviews'
import { formatSessionPreviewForDisplay } from '../lib/session-preview'

describe('session preview helpers', () => {
  const labels = { image: '图片', images: (n: number) => `${n} 张图片`, file: '文件', files: (n: number) => `${n} 个文件` }

  it.each([
    ['**0.4.39 整套发布已完成。** - 后端、前端已上线', '0.4.39 整套发布已完成。 - 后端、前端已上线'],
    ['已更新 [TARGET_STRUCTURE.md](/Users/test/Documents/TARGET_STRUCTURE.md)', '已更新 TARGET_STRUCTURE.md'],
    ['已更新 [TARGET_STRUCTURE.md](/Users/test/Doc…', '已更新 TARGET_STRUCTURE.md'],
    ['查看 [文档](<C:\\My Files\\guide.md>) 和 [规范](https://example.com/a_(b))', '查看 文档 和 规范'],
    ['## 结果\n> __通过__，`pnpm test` 保留 snake_case，2 * 3 = 6', '结果 通过，pnpm test 保留 snake_case，2 * 3 = 6'],
  ])('cleans display markup without losing content: %s', (input, expected) => {
    expect(formatSessionPreviewForDisplay(input, labels)).toBe(expected)
  })

  it('cleans long destinations before truncation and never rewrites stored previews', () => {
    const input = `查看 [文档](https://example.com/${'a'.repeat(150)})，测试通过。`
    expect(formatSessionPreviewForDisplay(input, labels)).toBe('查看 文档，测试通过。')
    expect(extractPreviewText('**原始正文**')).toBe('**原始正文**')
    expect(formatSessionPreviewForDisplay('<environment_context>private</environment_context>', labels)).toBe('')
    expect(formatSessionPreviewForDisplay(`data:image/png;base64,${'A'.repeat(120)}`, labels)).toBe('')
  })

  it('trims plain text previews to a single line', () => {
    expect(trimPreviewText('hello\nworld')).toBe('hello world')
  })

  it('extracts content from structured agent envelopes', () => {
    expect(
      extractPreviewText(
        JSON.stringify({
          v: 1,
          content: 'final answer',
          thinking: 'hidden',
        }),
      ),
    ).toBe('final answer')
  })

  it('uses text ahead of image attachments in structured user messages', () => {
    expect(
      extractPreviewText(
        JSON.stringify({
          v: 1,
          type: 'user',
          content: '![shot.png](</tmp/shot.png>)\n\n帮我看看这个问题',
          attachments: [
            { path: '/tmp/shot.png', name: 'shot.png', mimeType: 'image/png', kind: 'image' },
          ],
        }),
      ),
    ).toBe('帮我看看这个问题')
  })

  it('uses a count summary when a user message only contains images', () => {
    expect(
      extractPreviewText(
        JSON.stringify({
          v: 1,
          type: 'user',
          content: '![a.png](</tmp/a.png>)\n![b.png](</tmp/b.png>)',
          attachments: [
            { path: '/tmp/a.png', name: 'a.png', mimeType: 'image/png', kind: 'image' },
            { path: '/tmp/b.png', name: 'b.png', mimeType: 'image/png', kind: 'image' },
          ],
        }),
      ),
    ).toBe('[2 Images]')
  })

  it('formats file-only and mixed attachment summaries for display', () => {
    const labels = {
      image: '图片',
      images: (count: number) => `${count} 张图片`,
      file: '文件',
      files: (count: number) => `${count} 个文件`,
    }

    expect(formatSessionPreviewForDisplay('[File]', labels)).toBe('文件')
    expect(formatSessionPreviewForDisplay('[2 Files]', labels)).toBe('2 个文件')
    expect(formatSessionPreviewForDisplay('[Image · File]', labels)).toBe('图片 · 文件')
    expect(formatSessionPreviewForDisplay('[2 Images · 3 Files]', labels)).toBe(
      '2 张图片 · 3 个文件',
    )
  })

  it('cleans legacy standalone image Markdown from previews', () => {
    expect(extractPreviewText('![IMG_8552.png](</Users/test/.uploads/IMG_8552.png>)')).toBe(
      '[Image]',
    )
    expect(
      extractPreviewText(
        '![IMG_8552.png](</Users/test/.uploads/IMG_8552.png>)\n\n修改未读计数逻辑',
      ),
    ).toBe('修改未读计数逻辑')
  })

  it('skips tool payloads', () => {
    expect(
      extractPreviewText(
        JSON.stringify({
          v: 1,
          type: 'tool',
          name: 'shell_command',
          result: 'ok',
        }),
      ),
    ).toBe('')
  })

  it('does not render base64 or injected context from an index preview', () => {
    expect(extractPreviewText(`data:image/png;base64,${'A'.repeat(120)}`)).toBe('')
    expect(trimPreviewText('<environment_context>private</environment_context>')).toBe('')
  })

  it('skips standalone system control XML payloads', () => {
    expect(extractPreviewText('<turn_aborted> The user interrupted the previous turn on purpose. </turn_aborted>')).toBe('')
    expect(extractPreviewText('普通问题：为什么有 <turn_aborted>？')).toBe('普通问题：为什么有 <turn_aborted>？')
  })

  it('shows a concise preview for approval pending payloads', () => {
    expect(
      extractPreviewText(
        JSON.stringify({
          v: 1,
          type: 'approval_pending',
          title: '需要用户确认',
          content: 'Codex 请求执行命令：rm -rf dist',
        }),
      ),
    ).toBe('需要用户确认')
  })

  it('recognizes truncated tool JSON previews', () => {
    expect(isToolCallPayload('{"v":1,"type":"tool","name":"shell_command","args":')).toBe(true)
  })

  it('uses the latest readable text instead of the latest tool call', () => {
    expect(
      extractLatestReadablePreview([
        { id: 'a1', sessionId: 's1', role: 'agent', ts: 100, payload: 'readable answer' },
        {
          id: 't1',
          sessionId: 's1',
          role: 'agent',
          ts: 200,
          payload: JSON.stringify({ v: 1, type: 'tool', name: 'shell_command' }),
        },
      ]),
    ).toBe('readable answer')
  })

  it('uses the shared preview length cap', () => {
    const preview = extractPreviewText('a'.repeat(SESSION_PREVIEW_MAX_LEN + 20))
    expect(preview).toHaveLength(SESSION_PREVIEW_MAX_LEN + 1)
    expect(preview.endsWith('…')).toBe(true)
  })
})
