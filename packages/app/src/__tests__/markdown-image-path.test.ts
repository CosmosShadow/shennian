// @covers packages/app/src/features/chat/utils/markdownImagePath.ts

import { describe, expect, it } from 'vitest'
import { resolveMarkdownImagePath } from '../features/chat/utils/markdownImagePath'

describe('Markdown local images', () => {
  it('resolves sibling and parent-relative images against the Markdown file', () => {
    const markdown = '/Users/test/diary/2026/09/28.md'
    expect(resolveMarkdownImagePath('./images/a.png', markdown)).toBe('/Users/test/diary/2026/09/images/a.png')
    expect(resolveMarkdownImagePath('../images/b.jpg', markdown)).toBe('/Users/test/diary/2026/images/b.jpg')
  })

  it('keeps absolute machine paths and normalizes dot segments', () => {
    expect(resolveMarkdownImagePath('/Users/test/diary/../photos/a.png', '/Users/test/diary/note.md'))
      .toBe('/Users/test/photos/a.png')
    expect(resolveMarkdownImagePath('..\\images\\a.png', 'C:\\Users\\test\\diary\\note.md'))
      .toBe('C:\\Users\\test\\images\\a.png')
  })

  it('does not treat a remote URL as a machine file', () => {
    expect(resolveMarkdownImagePath('https://example.com/a.png', '/Users/test/note.md')).toBeNull()
  })
})
