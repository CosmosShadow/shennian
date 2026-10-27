// @arch docs/architecture/app/chat-attachments-preview.md
// @covers packages/app/src/components/chat/filePreviewLanguage.ts

import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  buildCodePreviewLines,
  getPreviewFileType,
  getPreviewLanguage,
  highlightPreviewCode,
} from '../components/chat/filePreviewLanguage'

describe('file preview language detection', () => {
  it('classifies common code files for syntax previews', () => {
    expect(getPreviewFileType('agent.js')).toBe('code')
    expect(getPreviewLanguage('agent.js')).toBe('javascript')

    expect(getPreviewFileType('ChatScreen.tsx')).toBe('code')
    expect(getPreviewLanguage('ChatScreen.tsx')).toBe('tsx')

    expect(getPreviewFileType('Token.sol')).toBe('code')
    expect(getPreviewLanguage('Token.sol')).toBe('solidity')
  })

  it('keeps markdown on the markdown renderer path and detects PDF previews', () => {
    expect(getPreviewFileType('README.md')).toBe('markdown')
    expect(getPreviewFileType('report.pdf')).toBe('pdf')
    expect(getPreviewFileType('data.csv')).toBe('csv')
  })

  it('routes media files to native browser controls instead of text preview', () => {
    expect(getPreviewFileType('hangup.mp3')).toBe('audio')
    expect(getPreviewFileType('clip.m4a')).toBe('audio')
    expect(getPreviewFileType('demo.mp4')).toBe('video')
    expect(getPreviewFileType('screen.webm')).toBe('video')
  })

  it('highlights Solidity instead of falling back to plain text', () => {
    const html = highlightPreviewCode('contract Token { function mint() public {} }', 'solidity')

    expect(html).toContain('hljs-keyword')
    expect(html).toContain('contract')
  })

  it('builds one-based code preview lines with highlighted HTML', () => {
    const lines = buildCodePreviewLines('const ok = true\nconsole.log(ok)', 'typescript')

    expect(lines).toHaveLength(2)
    expect(lines[0]?.number).toBe(1)
    expect(lines[0]?.text).toBe('const ok = true')
    expect(lines[0]?.html).toContain('hljs-keyword')
    expect(lines[1]?.number).toBe(2)
    expect(lines[1]?.text).toBe('console.log(ok)')
  })

  it('keeps trailing blank lines visible for line numbers', () => {
    const lines = buildCodePreviewLines('a\n', 'plaintext')

    expect(lines.map((line) => line.number)).toEqual([1, 2])
    expect(lines.map((line) => line.text)).toEqual(['a', ''])
  })
})

// @arch docs/architecture/app/chat-attachments-preview.md
// @covers packages/app/src/components/chat/readFilePanelPreview.ts
const platform = vi.hoisted(() => ({ OS: 'web' }))
const pdf = vi.hoisted(() => vi.fn(async (_options: unknown) => 'file:///unit/preview.pdf'))
vi.mock('react-native', () => ({ Platform: platform }))
vi.mock('../components/chat/fileOperations', () => ({
  IMAGE_PREVIEW_MAX_SIZE: 20 * 1024 * 1024,
  guessMimeType: () => 'application/pdf',
}))
vi.mock('../features/chat/utils/nativeImagePreviewCache', () => ({ loadNativePdfPreview: pdf }))
import { readFilePanelBinaryPreview } from '../components/chat/readFilePanelPreview'
beforeEach(() => {
  platform.OS = 'web'
  vi.clearAllMocks()
})
it('assembles aligned chunks into a usable media data URL', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, payload: { data: 'YWJj', length: 3, totalSize: 5 } })
    .mockResolvedValueOnce({ ok: true, payload: { data: 'ZGU=', length: 2, totalSize: 5 } })
  expect(await readFilePanelBinaryPreview(send, '/unit/file.pdf', 'file.pdf')).toBe(
    'data:application/pdf;base64,YWJjZGU=',
  )
  expect(send.mock.calls[1][0].params.offset).toBe(3)
})
it.each([
  { data: 'YWJj', length: 3, totalSize: 21 * 1024 * 1024 },
  { data: 'YWJj', length: 0, totalSize: 3 },
  { data: 'YWJj', length: 4, totalSize: 4 },
])('rejects oversize or incomplete responses without issuing another read', async (payload) => {
  const send = vi.fn(async () => ({ type: 'res' as const, id: 'unit', ok: true, payload }))
  await expect(readFilePanelBinaryPreview(send, '/unit/file.pdf', 'file.pdf')).rejects.toThrow()
  expect(send).toHaveBeenCalledOnce()
})
it('keeps native PDF bytes on disk and returns only its local URI', async () => {
  platform.OS = 'ios'
  const send = vi.fn(async () => ({
    type: 'res' as const,
    id: 'unit',
    ok: true,
    payload: { data: 'YWJj', length: 3, totalSize: 3 },
  }))
  expect(await readFilePanelBinaryPreview(send, '/unit/file.pdf', 'file.pdf')).toBe(
    'file:///unit/preview.pdf',
  )
  expect(pdf.mock.calls[0][0]).toMatchObject({ maxSize: 20 * 1024 * 1024, refresh: true })
  expect(send).not.toHaveBeenCalled()
})
