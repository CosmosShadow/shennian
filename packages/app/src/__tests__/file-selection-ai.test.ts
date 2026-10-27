// @arch docs/architecture/app/chat-attachments-preview.md
// @covers packages/app/src/components/chat/fileSelectionAi.ts

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  appendFileSelectionQuoteDraft,
  buildFileSelectionAiPrompt,
  buildFileSelectionQuoteDraft,
  FILE_SELECTION_AI_ACTIONS,
} from '../components/chat/fileSelectionAi'
import {
  TOP_LEVEL_VIEWPORT_ORIGIN,
  mapSelectionRectToOverlay,
} from '../components/chat/filePreviewSelectionPosition'

describe('file selection AI prompts', () => {
  it('builds an edit-in-place prompt for selected markdown text', () => {
    const prompt = buildFileSelectionAiPrompt({
      actionId: 'formal',
      filePath: '/tmp/README.md',
      filename: 'README.md',
      selectedText: 'this thing is kinda useful',
    })

    expect(prompt).toContain('请编辑文件：/tmp/README.md')
    expect(prompt).toContain('任务：把这段文字改得更正式')
    expect(prompt).toContain('直接修改原文件')
    expect(prompt).toContain('```text\nthis thing is kinda useful\n```')
  })

  it('uses a longer fence when selected text contains markdown fences', () => {
    const prompt = buildFileSelectionAiPrompt({
      actionId: 'shorter',
      filePath: '/tmp/notes.md',
      filename: 'notes.md',
      selectedText: 'before\n```ts\nconst x = 1\n```\nafter',
    })

    expect(prompt).toContain('````text\nbefore')
  })

  it('keeps Phase 1 actions stable', () => {
    expect(FILE_SELECTION_AI_ACTIONS.map((action) => action.id)).toEqual([
      'improve',
      'formal',
      'shorter',
      'longer',
      'translate_zh',
      'translate_en',
      'summarize',
    ])
  })

  it('adds a Quote action to the selection menu without changing AI edit actions', () => {
    const source = [
      readFileSync('packages/app/src/components/chat/FilePreview.web.tsx', 'utf8'),
      readFileSync('packages/app/src/components/chat/FileSelectionAiMenu.web.tsx', 'utf8'),
    ].join('\n')

    expect(source).toContain("t('file_selection_quote')")
    expect(source).toContain('onQuote ? (')
    expect(source).toContain('onSelectionQuoteAction(selection)')
    expect(FILE_SELECTION_AI_ACTIONS.map((action) => action.id)).not.toContain('quote')
  })

  it('keeps the Web selection menu clickable when iframe selection clears on mouse down', () => {
    const source = [
      readFileSync('packages/app/src/components/chat/FilePreview.web.tsx', 'utf8'),
      readFileSync('packages/app/src/components/chat/FileSelectionAiMenu.web.tsx', 'utf8'),
    ].join('\n')

    expect(source).toContain('runSelectionMenuAction')
    expect(source).toContain('runSelectionMenuPointerAction')
    expect(source).toContain('runSelectionMenuClickAction')
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain('event.stopPropagation()')
    expect(source).toContain(
      'onMouseDown={(event) => runSelectionMenuPointerAction(event, onQuote)}',
    )
    expect(source).toContain('onClick={(event) => runSelectionMenuClickAction(event, onQuote)}')
    expect(source).toContain('setMoreOpen((value) => !value)')
  })

  it('keeps the Web selection toolbar stable across repeated iframe selections', () => {
    const source = [
      readFileSync('packages/app/src/components/chat/FilePreview.web.tsx', 'utf8'),
      readFileSync('packages/app/src/components/chat/FileSelectionAiMenu.web.tsx', 'utf8'),
    ].join('\n')

    expect(source).toContain('clearSelectionTimerRef')
    expect(source).toContain('cancelPendingSelectionClear()')
    expect(source).toContain('}, 120)')
    expect(source).toContain('mapSelectionRectToOverlay(data.rect, iframeRect, containerRect)')
    expect(source).toContain('pointerActionHandledRef.current = false')
    expect(source).toContain('selection.rect.x')
    expect(source).toContain('selection.rect.y')
  })

  it('maps iframe selection rectangles into the parent preview overlay coordinates', () => {
    expect(
      mapSelectionRectToOverlay(
        { x: 24, y: 160, width: 80, height: 18 },
        { left: 720, top: 96 },
        { left: 700, top: 48 },
      ),
    ).toEqual({ x: 44, y: 208, width: 80, height: 18 })
  })

  it('maps same-document code selection rectangles relative to the preview container', () => {
    expect(
      mapSelectionRectToOverlay(
        { x: 760, y: 300, width: 120, height: 18 },
        TOP_LEVEL_VIEWPORT_ORIGIN,
        { left: 700, top: 80 },
      ),
    ).toEqual({ x: 60, y: 220, width: 120, height: 18 })
  })

  it('builds a composer quote draft with file path, line range, and selected text', () => {
    const draft = buildFileSelectionQuoteDraft({
      filePath: '/tmp/project/docs/README.md',
      filename: 'README.md',
      selectedText: 'first line\nsecond line',
      line: 12,
      endLine: 13,
    })

    expect(draft).toBe(
      [
        '引用文件：`/tmp/project/docs/README.md:12-13`',
        '',
        '> first line',
        '> second line',
        '',
        '用户补充：',
        '',
      ].join('\n'),
    )
    expect(draft).toContain('引用文件：`/tmp/project/docs/README.md:12-13`')
    expect(draft).toContain('> first line\n> second line')
    expect(draft.endsWith('用户补充：\n')).toBe(true)
  })

  it('appends quote drafts to composer text without auto-sending or dropping existing input', () => {
    const quote = buildFileSelectionQuoteDraft(
      {
        filePath: '/tmp/project/src/app.ts',
        filename: 'app.ts',
        selectedText: 'const ok = true',
        line: 7,
      },
      'en',
    )

    const next = appendFileSelectionQuoteDraft('Explain this:', quote)
    expect(next).toContain('Explain this:\n\nQuoted file: `/tmp/project/src/app.ts:7`')
    expect(next).toContain('> const ok = true')
    expect(next.endsWith('User note:\n')).toBe(true)
  })

  it('keeps the quote visible as plain composer markdown instead of hidden context', () => {
    const source = readFileSync(
      'packages/app/src/features/chat/components/ChatComposer.tsx',
      'utf8',
    )

    expect(source).not.toContain('quotePreviewCard')
    expect(source).not.toContain('FileSelectionQuotePreview')
  })
})
