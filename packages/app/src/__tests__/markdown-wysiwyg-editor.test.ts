// @arch docs/architecture/app/chat-attachments-preview.md
// @covers packages/app/src/components/chat/MarkdownWysiwygEditor.web.tsx

import { existsSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  getMarkdownWysiwygThemeCss,
  MARKDOWN_WYSIWYG_CDN,
  syncMarkdownWysiwygValue,
} from '../components/chat/MarkdownWysiwygEditor.web'

const colors = {
  bg: '#ffffff',
  avatarGroupBg: '#E2E4E5',
  surface: '#f8f8f8',
  surfaceHover: '#f2f2f2',
  border: '#dddddd',
  text: '#111111',
  textSecondary: '#555555',
  textTertiary: '#777777',
  textMuted: '#707070',
  textMutedOnSurface: '#626262',
  brand: '#0066cc',
  brandDark: '#0055aa',
  brandLight: '#e6f0ff',
  navigationSelected: '#4776A1',
  ownMessage: 'rgba(59,130,246,0.08)',
  error: '#cc0000',
  errorText: '#b91c1c',
  success: '#008855',
  successText: '#15803d',
  warning: '#aa7700',
  warningText: '#92400e',
}

describe('markdown wysiwyg editor theme', () => {
  it('hides Vditor chrome and keeps the editor on app colors', () => {
    const css = getMarkdownWysiwygThemeCss(colors, false)

    expect(css).toContain('.shennian-vditor-wrap .vditor-toolbar')
    expect(css).toContain('display: none !important')
    expect(css).toContain(`background: ${colors.bg}`)
    expect(css).toContain(`color: ${colors.text}`)
  })
})

describe('markdown wysiwyg editor value sync', () => {
  it('loads Vditor runtime assets from the app instead of a public CDN', () => {
    expect(MARKDOWN_WYSIWYG_CDN).toBe('/vditor')
    const publicRoot = resolve(__dirname, '../../public/vditor/dist/js')
    expect(existsSync(resolve(publicRoot, 'lute/lute.min.js'))).toBe(true)
    expect(existsSync(resolve(publicRoot, 'i18n/zh_CN.js'))).toBe(true)
    expect(existsSync(resolve(publicRoot, 'icons/ant.js'))).toBe(true)
    expect(existsSync(resolve(publicRoot, 'highlight.js/highlight.min.js'))).toBe(true)
    expect(existsSync(resolve(publicRoot, 'highlight.js/third-languages.js'))).toBe(true)
    expect(existsSync(resolve(publicRoot, 'highlight.js/styles/github.min.css'))).toBe(true)
    expect(
      existsSync(resolve(__dirname, '../../public/vditor/dist/css/content-theme/light.css')),
    ).toBe(true)
  })

  it('sets the current markdown after Vditor becomes ready', () => {
    const calls: Array<[string, boolean | undefined]> = []
    const editor = {
      getValue: () => '',
      setValue: (markdown: string, clearStack?: boolean) => calls.push([markdown, clearStack]),
    }

    syncMarkdownWysiwygValue(editor, '# AGENTS.md\n\nUse concise replies.')

    expect(calls).toEqual([['# AGENTS.md\n\nUse concise replies.', true]])
  })

  it('does not reset the editor when the value is already current', () => {
    const calls: Array<[string, boolean | undefined]> = []
    const editor = {
      getValue: () => '# AGENTS.md',
      setValue: (markdown: string, clearStack?: boolean) => calls.push([markdown, clearStack]),
    }

    syncMarkdownWysiwygValue(editor, '# AGENTS.md')

    expect(calls).toEqual([])
  })
})
