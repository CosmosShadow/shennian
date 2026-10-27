// @covers packages/app/src/features/steward/stewardMessagePreview.ts
import { describe, expect, it } from 'vitest'
import { stewardMessagePreview } from '../features/steward/stewardMessagePreview'

describe('steward message preview', () => {
  it('keeps short messages and the exact boundary intact', () => {
    for (const content of ['', '短消息\n第二行', '字'.repeat(500), Array(20).fill('行').join('\n')]) {
      expect(stewardMessagePreview(content)).toEqual({ text: content, collapsed: false })
    }
  })
  it('collapses long messages without breaking emoji or modifying the source', () => {
    const content = '😀'.repeat(501)
    expect(stewardMessagePreview(content)).toEqual({ text: '😀'.repeat(500) + '…', collapsed: true })
    expect(Array.from(content)).toHaveLength(501)
  })
  it('also bounds newline-heavy content, including Windows line endings', () => {
    const content = Array.from({ length: 21 }, (_, i) => `第${i + 1}行`).join('\r\n')
    const preview = stewardMessagePreview(content)
    expect(preview.collapsed).toBe(true)
    expect(preview.text).toContain('第20行')
    expect(preview.text).not.toContain('第21行')
  })
})
