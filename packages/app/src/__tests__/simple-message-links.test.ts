// @covers packages/app/src/components/chat/simpleMessageLinks.ts
// @covers packages/app/src/components/chat/SimpleMessageMarkdown.tsx
// @covers packages/app/src/features/steward/components/StewardMessageRow.tsx
// @covers packages/app/src/features/steward/components/StewardMessageList.tsx
// @covers packages/app/src/features/chat/screens/ChatScreen.tsx
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isLocalMessageLink, isOpenableMessageLink, openMessageLink } from '../components/chat/simpleMessageLinks'
import { getPreviewFileType } from '../components/chat/filePreviewLanguage'
import { buildAttachmentPreviewRouteTarget } from '../features/chat/utils/attachments'

const MarkdownIt = createRequire(import.meta.url)('markdown-it')

describe('personal conversation resource links', () => {
  it.each([
    ['/Users/test/介绍 页面.html', '/Users/test/介绍 页面.html'],
    ['/Users/test/%E4%BB%8B%E7%BB%8D%20%E9%A1%B5%E9%9D%A2.html', '/Users/test/介绍 页面.html'],
    ['file:///Users/test/%E4%BB%8B%E7%BB%8D%20%E9%A1%B5%E9%9D%A2.html', '/Users/test/介绍 页面.html'],
    ['file:///Users/test/100%2520.html', '/Users/test/100%20.html'],
    ['./output/page.htm', './output/page.htm'],
    ['C:/reports/page.html', 'C:/reports/page.html'],
  ])('previews %s through the current session instead of the phone URL opener', (href, path) => {
    const open = vi.fn()
    expect(openMessageLink(href, open)).toBe(false)
    expect(open).toHaveBeenCalledExactlyOnceWith(path)
    expect(openMessageLink(href)).toBe(false)
  })

  it.each(['https://example.com/report.html', 'mailto:test@example.com', 'tel:123'])('preserves external link %s', (url) => {
    const open = vi.fn()
    expect(openMessageLink(url, open)).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })

  it.each(['javascript:alert(1)', 'data:text/html,test', 'vbscript:msgbox(1)', 'custom:thing', '//example.com/a.html', '/tmp/\u0000.html'])('rejects unsafe/custom link %s', (url) => {
    const open = vi.fn()
    expect(isLocalMessageLink(url)).toBe(false)
    expect(openMessageLink(url, open)).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('renders file:// Markdown only for a personal resource handler', () => {
    const parser = new MarkdownIt({ linkify: true })
    parser.validateLink = (url: string) => isOpenableMessageLink(url) || isLocalMessageLink(url)
    const html = parser.render('[打开 HTML 页面](<file:///Users/test/介绍 页面.html>)')
    expect(html).toContain('<a href="file:///Users/test/')
    expect(html).toContain('打开 HTML 页面</a>')
    expect(parser.render('[bad](javascript:alert%281%29)')).not.toContain('<a ')
    parser.validateLink = isOpenableMessageLink
    expect(parser.render('[local](file:///tmp/page.html)')).not.toContain('<a ')
  })

  it('resolves relative HTML links in the current session workdir', () => {
    const open = vi.fn((rawPath: string) => buildAttachmentPreviewRouteTarget({
      rawPath, workDir: '/Users/test/steward', sessionId: 'test-session', hydratedMessages: [],
    }))
    openMessageLink('./report.html', open)
    expect(getPreviewFileType(open.mock.results[0].value.params.name)).toBe('html')
    expect(open.mock.results[0].value).toMatchObject({ params: {
      path: '/Users/test/steward/report.html', sessionId: 'test-session', name: 'report.html',
    } })
  })

  it('connects the steward list and bubble to the existing session preview action', () => {
    const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')
    expect(read('../features/chat/screens/ChatScreen.tsx')).toContain('onResourcePress: openAttachmentPreview')
    expect(read('../features/steward/components/StewardMessageList.tsx')).toContain('onResourcePress={onResourcePress}')
    expect(read('../features/steward/components/StewardMessageRow.tsx')).toContain('onResourcePress={onResourcePress}')
    expect(read('../components/chat/SimpleMessageMarkdown.tsx')).toContain('openMessageLink(url, onResourcePress)')
  })
})
