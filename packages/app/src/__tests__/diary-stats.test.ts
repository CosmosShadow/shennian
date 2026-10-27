// @covers packages/app/src/features/personal-workspace/diaryStats.ts
import { createRequire } from 'node:module'
import { expect, it, vi } from 'vitest'
vi.mock('react-native-markdown-display', () => ({ MarkdownIt: createRequire(import.meta.url)('markdown-it') }))
import { diaryMarkdown, diaryStats } from '../features/personal-workspace/diaryStats'
it('counts each diary separately, including referenced photos but not image examples in code', () => {
  expect(diaryStats('正文 \n🙂')).toEqual({ characterCount: 3, photoCount: 0 })
  expect(diaryStats('![a](../photos/a.png)\n![b][photo]\n\n[photo]: ../photos/b.png\n\n`![code](x.png)`\n\n```\n![code](y.png)\n```').photoCount).toBe(2)
})

it('accepts computer file links for rendering without allowing executable schemes', () => {
  expect(diaryMarkdown.validateLink('file:///diary/a.png')).toBe(true)
  expect(diaryMarkdown.validateLink('javascript:alert(1)')).toBe(false)
  expect(diaryStats('![photo](file:///diary/a.png)').photoCount).toBe(1)
})
