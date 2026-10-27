// @covers packages/app/src/components/chat/FilePreview.native.tsx
// @covers packages/app/src/components/chat/FilePreview.web.tsx

import { describe, expect, it } from 'vitest'
import { getMarkdownPreviewPalette } from '../components/chat/filePreviewTheme'

const lightColors = {
  bg: '#ffffff',
  surface: '#fafafa',
  text: '#111111',
  textSecondary: '#666666',
}

const darkColors = {
  bg: '#0a0a0a',
  surface: '#171717',
  text: '#fafafa',
  textSecondary: '#a3a3a3',
}

describe('file preview markdown theme', () => {
  it('uses readable blockquote colors in dark mode', () => {
    const palette = getMarkdownPreviewPalette(darkColors, true)

    expect(palette.blockSurface).toBe(darkColors.surface)
    expect(palette.mutedText).toBe(darkColors.textSecondary)
    expect(palette.blockBorder).toBe('#3a3a3a')
    expect(palette.inlineCodeSurface).toBe('#242426')
  })

  it('keeps light mode markdown blocks on light surfaces', () => {
    const palette = getMarkdownPreviewPalette(lightColors, false)

    expect(palette.blockSurface).toBe('#f6f6f7')
    expect(palette.blockBorder).toBe('#d1d1d6')
    expect(palette.mutedText).toBe('#3a3a3c')
    expect(palette.inlineCodeSurface).toBe('#f1f1f3')
  })
})
