// @covers packages/app/src/features/personal-workspace/diaryPresentation.ts
import { expect, it } from 'vitest'
import { diaryBody, diaryPresentation } from '../features/personal-workspace/diaryPresentation'
const base = { path: '2026/2026-10-23.md', revision: 'v1' }
it('separates legacy dates from headings and strips summary markers without repeating the headline', () => {
  expect(diaryPresentation({ ...base, title: '2026-10-23｜推进神念', summary: '> 概要：完成工作区整合。' })).toEqual({ date: '2026-10-23', heading: '推进神念', summary: '完成工作区整合。' })
  expect(diaryPresentation({ ...base, title: '2026-10-23', summary: '当天概要' })).toEqual({ date: '2026-10-23', heading: '', summary: '当天概要' })
  expect(diaryPresentation({ ...base, title: '2026-10-23 | 推进神念', summary: '推进神念' }).summary).toBe('')
})
it('preserves a heading containing a different date and supports entries without metadata', () => {
  expect(diaryPresentation({ ...base, title: '回顾 2026-10-22' }).heading).toBe('回顾 2026-10-22')
  expect(diaryPresentation(base)).toEqual({ date: '2026-10-23', heading: '', summary: '' })
})

it('moves a legacy date out of the displayed article title without modifying the source', () => {
  const entry = { ...base, content: '# 2026-10-23｜推进神念\n\n正文' }
  expect(diaryBody(entry)).toBe('# 推进神念\n\n正文')
  expect(entry.content).toContain('# 2026-10-23')
  expect(diaryBody({ ...base, content: '# 2026-10-23\n正文' })).toBe('正文')
})
