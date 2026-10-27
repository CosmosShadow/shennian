/**
 * Native WebView HTML — composed at bundle time from the chat runtime sources:
 *
 *   chatCss.ts  — CSS styles (edit directly, Metro picks up changes automatically)
 *   chatJs.ts   — Generated runtime bundle (edit chat*.js, then run `pnpm build:webview`)
 *   markedJs.ts — Marked library (run `pnpm build:webview` after upgrading marked)
 *   katexJs.ts  — KaTeX parser used for local MathML rendering
 *
 * No manual rebuild needed for CSS changes.
 */

import { CHAT_CSS_NATIVE } from './chatCss'
import { CHAT_JS } from './chatJs'
import { KATEX_JS } from './katexJs'
import { MARKED_JS } from './markedJs'

type ChatHtmlTheme = {
  isDark: boolean
  colors: Partial<Record<ColorToken, string>>
}

type ColorToken =
  | 'bg'
  | 'surface'
  | 'surfaceHover'
  | 'border'
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'brand'
  | 'brandDark'
  | 'brandLight'
  | 'ownMessage'
  | 'error'
  | 'success'
  | 'warning'

const colorVars: Record<ColorToken, string> = {
  bg: '--bg',
  surface: '--surface',
  surfaceHover: '--surface-hover',
  border: '--border',
  text: '--text',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  brand: '--brand',
  brandDark: '--brand-dark',
  brandLight: '--brand-light',
  ownMessage: '--own-message',
  error: '--error',
  success: '--success',
  warning: '--warning',
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getThemeStyle(colors: ChatHtmlTheme['colors']): string {
  return (Object.keys(colorVars) as ColorToken[])
    .map((key) => {
      const value = colors[key]
      return value ? `${colorVars[key]}:${value};` : ''
    })
    .join('')
}

export function createChatHtml({
  i18nScript = '/* __I18N_PLACEHOLDER__ */',
  theme,
}: {
  i18nScript?: string
  theme?: ChatHtmlTheme
} = {}) {
  const htmlClass = theme?.isDark ? ' class="dark"' : ''
  const themeStyle = theme ? getThemeStyle(theme.colors) : ''
  const htmlStyle = themeStyle ? ` style="${escapeAttr(themeStyle)}"` : ''

  return `<!DOCTYPE html>
<html${htmlClass}${htmlStyle}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<style>
${CHAT_CSS_NATIVE}
</style>
</head>
<body>
<div id="scroll-root"><div id="messages"></div></div>
<script>${MARKED_JS}</script>
<script>${KATEX_JS}</script>
<script>${i18nScript}</script>
<script>${CHAT_JS}</script>
</body>
</html>`
}

export const chatHtml = createChatHtml()
