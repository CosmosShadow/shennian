type PreviewColors = {
  bg: string
  surface: string
  text: string
  textSecondary: string
}

export function getMarkdownPreviewPalette(colors: PreviewColors, isDark: boolean) {
  return {
    blockSurface: isDark ? colors.surface : '#f6f6f7',
    blockBorder: isDark ? '#3a3a3a' : '#d1d1d6',
    inlineCodeSurface: isDark ? '#242426' : '#f1f1f3',
    mutedText: isDark ? colors.textSecondary : '#3a3a3c',
  }
}
