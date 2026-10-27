// @covers packages/app/src/features/chat/utils/attachments.ts
// @covers packages/app/src/features/chat/hooks/useChatUploads.ts

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  autolinkLocalFileReferencesInMarkdown,
  buildAttachmentMarkdownRef,
  buildAttachmentMeta,
  buildAttachmentPreviewRouteTarget,
  composeAttachmentMessageContent,
  extractClipboardImageFiles,
  inferAttachmentKind,
  inferMimeTypeFromName,
  isLocalResourceHref,
  normalizeLocalResourceHref,
  parseLocalResourceLocation,
  resolvePreviewAttachmentCandidate,
  resolveResourcePath,
  resolveUploadPath,
  stripResourceFragment,
  stripAttachmentRefs,
  appendLocalResourceLineLabel,
  stripInlinePreviewAttachmentRefs,
} from '../features/chat/utils/attachments'

describe('chat attachment utils', () => {
  it('builds markdown image refs with absolute paths', () => {
    const attachment = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/shot.png',
      name: 'shot.png',
      mimeType: 'image/png',
    })

    expect(buildAttachmentMarkdownRef(attachment)).toBe(
      '![shot.png](</Users/test/project/.uploads/shot.png>)',
    )
  })

  it('strips generated attachment refs from display text', () => {
    const attachment = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/shot.png',
      name: 'shot.png',
      mimeType: 'image/png',
    })

    const content = [buildAttachmentMarkdownRef(attachment), '', '帮我看看这张图'].join('\n')

    expect(stripAttachmentRefs(content, [attachment])).toBe('帮我看看这张图')
  })

  it('composes uploaded attachment refs into the final message content at send time', () => {
    const imageAttachment = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/shot.png',
      name: 'shot.png',
      mimeType: 'image/png',
    })
    const fileAttachment = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/notes.md',
      name: 'notes.md',
      mimeType: 'text/markdown',
    })

    expect(composeAttachmentMessageContent('帮我看看', [imageAttachment, fileAttachment])).toBe(
      [
        '![shot.png](</Users/test/project/.uploads/shot.png>)',
        '[notes.md](</Users/test/project/.uploads/notes.md>)',
        '',
        '帮我看看',
      ].join('\n'),
    )
  })

  it('keeps uploaded videos as compatible file attachments with video mime types', () => {
    const videoAttachment = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/clip.mov',
      name: 'clip.mov',
      mimeType: inferMimeTypeFromName('clip.mov'),
    })

    expect(videoAttachment).toMatchObject({
      name: 'clip.mov',
      mimeType: 'video/quicktime',
      kind: 'file',
    })
    expect(buildAttachmentMarkdownRef(videoAttachment)).toBe(
      '[clip.mov](</Users/test/project/.uploads/clip.mov>)',
    )

    const content = [buildAttachmentMarkdownRef(videoAttachment), '', '帮我看看这个视频'].join('\n')
    expect(stripInlinePreviewAttachmentRefs(content, [videoAttachment])).toBe(content)
  })

  it('strips only inline-preview image refs from the rendered message body', () => {
    const imageAttachment = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/shot.png',
      name: 'shot.png',
      mimeType: 'image/png',
    })
    const fileAttachment = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/notes.md',
      name: 'notes.md',
      mimeType: 'text/markdown',
    })

    const content = [
      buildAttachmentMarkdownRef(imageAttachment),
      buildAttachmentMarkdownRef(fileAttachment),
      '',
      '帮我看看',
    ].join('\n')

    expect(stripInlinePreviewAttachmentRefs(content, [imageAttachment, fileAttachment])).toBe(
      ['[notes.md](</Users/test/project/.uploads/notes.md>)', '', '帮我看看'].join('\n'),
    )
  })

  it('resolves relative resource paths against the workdir', () => {
    expect(resolveResourcePath('./todo/a.md', '/Users/test/project')).toBe(
      '/Users/test/project/todo/a.md',
    )
    expect(resolveResourcePath('todo/a.md', '/Users/test/project')).toBe(
      '/Users/test/project/todo/a.md',
    )
    expect(resolveResourcePath('./todo/a.md#L21', '/Users/test/project')).toBe(
      '/Users/test/project/todo/a.md',
    )
    expect(
      resolveResourcePath('/Users/test/project/docs/readme.md#overview', '/Users/test/project'),
    ).toBe('/Users/test/project/docs/readme.md')
    expect(
      resolveResourcePath(
        '/Users/test/project/test_schema_projector_runtime.py:1',
        '/Users/test/project',
      ),
    ).toBe('/Users/test/project/test_schema_projector_runtime.py')
    expect(resolveResourcePath('./src/main.ts:12:4', '/Users/test/project')).toBe(
      '/Users/test/project/src/main.ts',
    )
  })

  it('normalizes Expo route-style Windows drive paths', () => {
    expect(
      resolveResourcePath('/C:/Users/test/project/index.html', 'C:\\Users\\test\\project'),
    ).toBe('C:/Users/test/project/index.html')
  })

  it('strips fragments and query strings from local resource paths', () => {
    expect(stripResourceFragment('/Users/test/project/docs/readme.md#L21')).toBe(
      '/Users/test/project/docs/readme.md',
    )
    expect(stripResourceFragment('./todo/a.md?raw=1#L3')).toBe('./todo/a.md')
    expect(stripResourceFragment('/Users/test/project/docs/readme.md:21')).toBe(
      '/Users/test/project/docs/readme.md',
    )
    expect(stripResourceFragment('/Users/test/project/docs/readme.md:21:3')).toBe(
      '/Users/test/project/docs/readme.md',
    )
    expect(stripResourceFragment('C:\\Users\\test\\project\\docs\\readme.md:21')).toBe(
      'C:\\Users\\test\\project\\docs\\readme.md',
    )
    expect(stripResourceFragment('/Users/test/project/docs/readme:21')).toBe(
      '/Users/test/project/docs/readme:21',
    )
  })

  it('parses local resource line and range locations without losing clean paths', () => {
    expect(parseLocalResourceLocation('/Users/test/project/src/app.ts:123')).toMatchObject({
      path: '/Users/test/project/src/app.ts',
      line: 123,
    })
    expect(parseLocalResourceLocation('./src/app.ts:12:4')).toMatchObject({
      path: './src/app.ts',
      line: 12,
      column: 4,
    })
    expect(parseLocalResourceLocation('C:\\Users\\test\\project\\src\\app.ts:9')).toMatchObject({
      path: 'C:\\Users\\test\\project\\src\\app.ts',
      line: 9,
    })
    expect(parseLocalResourceLocation('/Users/test/project/src/app.ts#L10-L12')).toMatchObject({
      path: '/Users/test/project/src/app.ts',
      line: 10,
      endLine: 12,
    })
    expect(parseLocalResourceLocation('/Users/test/project/src/app.ts:120-136')).toMatchObject({
      path: '/Users/test/project/src/app.ts',
      line: 120,
      endLine: 136,
    })
    const extensionless = parseLocalResourceLocation('/Users/test/project/docs/readme:21')
    expect(extensionless).toMatchObject({ path: '/Users/test/project/docs/readme:21' })
    expect(extensionless).not.toHaveProperty('line')
  })

  it('formats line labels while preserving existing click targets', () => {
    expect(appendLocalResourceLineLabel('src/app.ts', { line: 123 })).toBe('src/app.ts (line 123)')
    expect(appendLocalResourceLineLabel('src/app.ts:123', { line: 123 })).toBe('src/app.ts:123')
    expect(appendLocalResourceLineLabel('src/app.ts', { line: 10, endLine: 12 })).toBe(
      'src/app.ts (lines 10-12)',
    )
  })

  it('builds preview route params with line and column locations while opening the clean file path', () => {
    expect(
      buildAttachmentPreviewRouteTarget({
        rawPath: './src/app.ts:12:4',
        workDir: '/Users/test/project',
        sessionId: 'sess-1',
        hydratedMessages: [],
      }),
    ).toEqual({
      pathname: '/(main)/chat/[sessionId]/preview',
      params: {
        sessionId: 'sess-1',
        path: '/Users/test/project/src/app.ts',
        name: 'app.ts',
        mimeType: 'application/octet-stream',
        line: '12',
        column: '4',
      },
    })
  })

  it('builds preview route params with hash line ranges', () => {
    expect(
      buildAttachmentPreviewRouteTarget({
        rawPath: './src/app.ts#L10-L12',
        workDir: '/Users/test/project',
        sessionId: 'sess-1',
        hydratedMessages: [],
      }).params,
    ).toMatchObject({
      path: '/Users/test/project/src/app.ts',
      line: '10',
      endLine: '12',
    })
  })

  it('builds preview route params with colon line ranges while opening the clean file path', () => {
    expect(
      buildAttachmentPreviewRouteTarget({
        rawPath: './src/app.ts:120-136',
        workDir: '/Users/test/project',
        sessionId: 'sess-1',
        hydratedMessages: [],
      }).params,
    ).toMatchObject({
      path: '/Users/test/project/src/app.ts',
      line: '120',
      endLine: '136',
    })
  })

  it('preserves folder attachment kind when building preview route targets', () => {
    const folder = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/zb-工作包',
      name: 'zb-工作包',
      mimeType: 'inode/directory',
      kind: 'folder',
    })

    expect(
      buildAttachmentPreviewRouteTarget({
        rawPath: '/Users/test/project/.uploads/zb-工作包',
        workDir: '/Users/test/project',
        sessionId: 'sess-1',
        hydratedMessages: [{ attachments: [folder] }],
      }).params,
    ).toMatchObject({
      sessionId: 'sess-1',
      path: '/Users/test/project/.uploads/zb-工作包',
      name: 'zb-工作包',
      mimeType: 'inode/directory',
      kind: 'folder',
    })
  })

  it('keeps web resource presses in the side preview instead of navigating over chat', () => {
    const screenSource = [
      'packages/app/src/features/desktop-chat/DesktopChatScreen.tsx',
      'packages/app/src/features/desktop-chat/DesktopChatScreenView.tsx',
      'packages/app/src/features/desktop-chat/useDesktopChatFileActions.ts',
    ]
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    const actionSource = readFileSync(
      'packages/app/src/features/chat/hooks/useChatPreviewActions.ts',
      'utf8',
    )

    expect(screenSource).toContain('preferSidePreview: true')
    expect(screenSource).toContain('onOpenSidePreview: openSideFilePreview')
    expect(screenSource).toContain('previewRequest={sidePreviewRequest}')
    expect(actionSource).toContain('onOpenSidePreview(target.params)')
    expect(actionSource).toContain('router.navigate(target)')
  })

  it('resolves uploaded files into the hidden uploads directory', () => {
    expect(resolveUploadPath('/Users/test/project/', 'shot.png')).toBe(
      '/Users/test/project/.uploads/shot.png',
    )
  })

  it('opens the native media picker for both photos and videos', () => {
    const source = readFileSync('packages/app/src/features/chat/hooks/useChatUploads.ts', 'utf8')

    expect(source).toContain("mediaTypes: ['images', 'videos']")
    expect(source).toContain('buildNativeMediaFallbackName')
    expect(source).toContain("asset.type === 'video' ? 'mp4' : 'jpg'")
  })

  it('passes the newly-created upload task directly into the async upload', () => {
    const source = readFileSync('packages/app/src/features/chat/hooks/useChatUploads.ts', 'utf8')

    expect(source).toContain('void uploadOneFile(file, task)')
    expect(source).not.toContain('void uploadOneFile(file, taskId)')
    expect(source).toContain('Crypto.randomUUID()')
    expect(source).not.toContain('crypto.randomUUID()')
  })

  it('does not interrupt chat with an alert when an upload fails', () => {
    const source = readFileSync('packages/app/src/features/chat/hooks/useChatUploads.ts', 'utf8')

    expect(source).not.toContain('alert(')
    expect(source).toContain('setPendingAttachments((prev) => prev.filter((item) => item.id !== task.id))')
  })

  it('extracts pasted web images with direct byte access for a restricted renderer', async () => {
    const createObjectURL = vi.fn(() => 'blob:preview')
    const file = Object.assign(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
      name: 'image.png',
    })
    const clipboardData = {
      items: [
        {
          kind: 'string',
          type: 'text/plain',
          getAsFile: () => null,
        },
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => file,
        },
      ],
    } as unknown as DataTransfer

    const originalUrl = globalThis.URL
    Object.defineProperty(globalThis, 'URL', {
      value: { ...originalUrl, createObjectURL },
      configurable: true,
    })
    try {
      const files = extractClipboardImageFiles(clipboardData, 123, () => 'abc123xy')
      expect(files).toMatchObject([
        {
          uri: 'blob:preview',
          name: 'pasted_image_123_abc123xy_1.png',
          mimeType: 'image/png',
          size: 3,
        },
      ])
      expect([...await files[0].readBytes()]).toEqual([1, 2, 3])
    } finally {
      Object.defineProperty(globalThis, 'URL', {
        value: originalUrl,
        configurable: true,
      })
    }
  })

  it('treats HEIC/HEIF as an ordinary file and keeps its original pasted name', () => {
    expect(inferAttachmentKind('IMG_9718.HEIC', 'image/heic')).toBe('file')
    expect(inferAttachmentKind('photo.heif', 'application/octet-stream')).toBe('file')
    expect(inferAttachmentKind('photo.png', 'image/png')).toBe('image')
    expect(inferAttachmentKind('photo.png')).toBe('image')

    const file = Object.assign(new Blob([new Uint8Array(7)], { type: 'image/heic' }), {
      name: 'IMG_9718.HEIC',
    })
    const clipboardData = {
      items: [{ kind: 'file', type: 'image/heic', getAsFile: () => file }],
    } as unknown as DataTransfer
    const originalUrl = globalThis.URL
    Object.defineProperty(globalThis, 'URL', {
      value: { ...originalUrl, createObjectURL: () => 'blob:heic' },
      configurable: true,
    })
    try {
      expect(extractClipboardImageFiles(clipboardData, 123, () => 'abc123xy')).toMatchObject([
        { uri: 'blob:heic', name: 'IMG_9718.HEIC', mimeType: 'image/heic', size: 7 },
      ])
    } finally {
      Object.defineProperty(globalThis, 'URL', { value: originalUrl, configurable: true })
    }
  })

  it('reuses the session attachment metadata for preview routes when available', () => {
    const attachment = buildAttachmentMeta({
      path: '/Users/test/project/.uploads/shot.png',
      name: 'shot.png',
      mimeType: 'image/png',
    })
    const message = { attachments: [attachment] }

    expect(
      resolvePreviewAttachmentCandidate({
        sessionMatches: true,
        messages: [message],
        path: '/Users/test/project/.uploads/shot.png',
        name: 'fallback.png',
        mimeType: 'application/octet-stream',
      }),
    ).toBe(attachment)
  })

  it('can reconstruct folder preview candidates from route params', () => {
    expect(
      resolvePreviewAttachmentCandidate({
        sessionMatches: false,
        messages: [],
        path: '/home/zb-工作包',
        name: 'zb-工作包',
        mimeType: 'inode/directory',
        kind: 'folder',
      }),
    ).toMatchObject({
      path: '/home/zb-工作包',
      name: 'zb-工作包',
      mimeType: 'inode/directory',
      kind: 'folder',
    })
  })

  describe('isLocalResourceHref', () => {
    it('returns true for local paths', () => {
      expect(isLocalResourceHref('/Users/test/file.md')).toBe(true)
      expect(isLocalResourceHref('./todo/plan.md')).toBe(true)
      expect(isLocalResourceHref('../docs/readme.md')).toBe(true)
      expect(isLocalResourceHref('.uploads/shot.png')).toBe(true)
      expect(isLocalResourceHref('~/Documents/file.txt')).toBe(true)
      expect(isLocalResourceHref('C:\\Users\\test\\file.md')).toBe(true)
      expect(isLocalResourceHref('D:/projects/file.ts')).toBe(true)
      expect(isLocalResourceHref('todo/plan.md')).toBe(true)
      expect(isLocalResourceHref('file.txt')).toBe(true)
      expect(isLocalResourceHref('/Users/test/file.md#L21')).toBe(true)
      expect(isLocalResourceHref('file:///home/admin/slides.html')).toBe(true)
      expect(isLocalResourceHref('</home/admin/slides.html>')).toBe(true)
    })

    it('returns false for remote URLs', () => {
      expect(isLocalResourceHref('https://example.com')).toBe(false)
      expect(isLocalResourceHref('http://example.com')).toBe(false)
      expect(isLocalResourceHref('mailto:user@example.com')).toBe(false)
      expect(isLocalResourceHref('tel:+1234567890')).toBe(false)
      expect(isLocalResourceHref('data:text/plain;base64,abc')).toBe(false)
      expect(isLocalResourceHref('ftp://files.example.com/a.txt')).toBe(false)
    })

    it('returns false for dangerous URL schemes', () => {
      expect(isLocalResourceHref('javascript:alert(1)')).toBe(false)
      expect(isLocalResourceHref('JavaScript:void(0)')).toBe(false)
      expect(isLocalResourceHref('vbscript:MsgBox("xss")')).toBe(false)
      expect(isLocalResourceHref('blob:https://example.com/uuid')).toBe(false)
    })

    it('returns false for empty or whitespace input', () => {
      expect(isLocalResourceHref('')).toBe(false)
      expect(isLocalResourceHref('   ')).toBe(false)
    })
  })

  describe('normalizeLocalResourceHref', () => {
    it('normalizes file URLs and Markdown angle-bracket paths', () => {
      expect(normalizeLocalResourceHref('file:///home/admin/slides.html')).toBe(
        '/home/admin/slides.html',
      )
      expect(normalizeLocalResourceHref('</home/admin/slides.html>')).toBe(
        '/home/admin/slides.html',
      )
      expect(normalizeLocalResourceHref('file:///C:/Users/test/slides.html')).toBe(
        'C:/Users/test/slides.html',
      )
    })
  })

  describe('autolinkLocalFileReferencesInMarkdown', () => {
    it('links absolute, relative, home and Windows file paths with optional line locations', () => {
      const linked = autolinkLocalFileReferencesInMarkdown(
        'See /Users/me/app/src/main.ts:12:3, ./src/app.ts:120-136, ./docs/plan.md and C:\\Users\\me\\app\\README.md:8.',
      )

      expect(linked).toContain('[/Users/me/app/src/main.ts:12:3](</Users/me/app/src/main.ts:12:3>)')
      expect(linked).toContain('[./src/app.ts:120-136](<./src/app.ts:120-136>)')
      expect(linked).toContain('[./docs/plan.md](<./docs/plan.md>)')
      expect(linked).toContain('(<C:\\Users\\me\\app\\README.md:8>)')
      expect(linked).toContain('C:\\\\Users\\\\me\\\\app\\\\README.md:8')
      expect(linked).toContain(').')
    })

    it('does not link URLs, existing markdown links, inline code, fenced code or plain filenames', () => {
      const source = [
        'URL https://example.com/docs/readme.md',
        'Existing [plan](./docs/plan.md)',
        'Code `./src/main.ts`',
        'Plain README.md should stay text',
        '```',
        '/Users/me/app/src/main.ts',
        '```',
      ].join('\n')

      const linked = autolinkLocalFileReferencesInMarkdown(source)

      expect(linked).toContain('https://example.com/docs/readme.md')
      expect(linked).toContain('[plan](./docs/plan.md)')
      expect(linked).toContain('`./src/main.ts`')
      expect(linked).toContain('Plain README.md should stay text')
      expect(linked).toContain('```\n/Users/me/app/src/main.ts\n```')
      expect(linked).not.toContain('[README.md](<README.md>)')
      expect(linked).not.toContain('[/Users/me/app/src/main.ts](</Users/me/app/src/main.ts>)')
    })
  })
})
