// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/chat-webview-script.test.ts

import { marked } from 'marked'
import {
  appendLocalResourceLineLabel,
  autolinkLocalFileReferencesInMarkdown,
  formatLocalResourceLineLabel,
  getPathExt,
  isLocalResourceHref,
  localResourceLabelIncludesLocation,
  normalizeLocalResourceHref,
  parseLocalResourceLocation,
} from '../../features/chat/utils/attachments'

const CODE_BLOCK_COPY_STORE_LIMIT = 256
const codeBlockCopyStore = new Map<string, string>()
let codeBlockCopySeq = 0

function registerCodeBlockCopyText(code: string): string {
  const id = `cb-${(++codeBlockCopySeq).toString(36)}`
  codeBlockCopyStore.set(id, code)
  while (codeBlockCopyStore.size > CODE_BLOCK_COPY_STORE_LIMIT) {
    const oldest = codeBlockCopyStore.keys().next().value
    if (!oldest) break
    codeBlockCopyStore.delete(oldest)
  }
  return id
}

export function getCodeBlockCopyText(id: string): string | null {
  return codeBlockCopyStore.get(id) ?? null
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function initMarked() {
  const renderer = new marked.Renderer()

  renderer.html = function (token: { text?: string; raw?: string } | string) {
    const text =
      typeof token === 'object' && token !== null
        ? token.text || token.raw || ''
        : String(token || '')
    return escapeHtml(text)
  }

  renderer.code = function (token: { text?: string; lang?: string } | string) {
    let code: string
    let lang: string
    if (typeof token === 'object' && token !== null) {
      code = token.text || ''
      lang = token.lang || ''
    } else {
      code = (token as string) || ''
      lang = ''
    }
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    const langLabel = lang ? `<span class="code-block-lang">${lang}</span>` : '<span></span>'
    const copyId = registerCodeBlockCopyText(code)
    return (
      '<div class="code-block-wrap">' +
      '<div class="code-block-header">' +
      langLabel +
      `<button class="code-block-copy" data-code-id="${copyId}">Copy</button>` +
      '</div>' +
      `<pre><code>${escaped}</code></pre>` +
      '</div>'
    )
  }

  renderer.codespan = function (token: { text?: string } | string) {
    const text =
      typeof token === 'object' && token !== null ? token.text || '' : String(token || '')
    const normalized = normalizeLocalResourceHref(text)
    const location = parseLocalResourceLocation(normalized)
    const canOpen =
      !/[\s<>]/.test(normalized) &&
      isLocalResourceHref(normalized) &&
      Boolean(getPathExt(location.path))

    if (canOpen) {
      return `<a class="inline-resource-code" href="${escapeHtml(normalized)}"><code>${escapeHtml(text)}</code></a>`
    }

    return `<code>${escapeHtml(text)}</code>`
  }

  renderer.heading = function (
    this: { parser?: { parseInline: (tokens: unknown[]) => string } },
    token: { text?: string; tokens?: unknown[]; depth?: number } | string,
    legacyDepth?: number,
  ) {
    const html =
      typeof token === 'object' && token !== null && Array.isArray(token.tokens) && this.parser
        ? this.parser.parseInline(token.tokens)
        : escapeHtml(
            typeof token === 'object' && token !== null ? token.text || '' : String(token || ''),
          )
    const rawDepth = typeof token === 'object' && token !== null ? token.depth : legacyDepth
    const depth = typeof rawDepth === 'number' && Number.isInteger(rawDepth) && rawDepth >= 1 && rawDepth <= 6 ? rawDepth : 5
    return `<h${depth}>${html}</h${depth}>`
  }

  renderer.image = function (token: { href?: string; text?: string } | string, ...rest: unknown[]) {
    const href =
      typeof token === 'object' && token !== null ? token.href || '' : String(token || '')
    const text =
      typeof token === 'object' && token !== null
        ? token.text || ''
        : typeof rest[0] === 'string'
          ? rest[0]
          : ''

    if (isLocalResourceHref(href)) {
      const resourcePath = normalizeLocalResourceHref(href)
      const location = parseLocalResourceLocation(resourcePath)
      const label = appendLocalResourceLineLabel(
        text || resourcePath.split(/[\\/]/).pop() || 'Open image',
        location,
      )
      return `<button class="resource-pill resource-pill-image" type="button" data-resource-path="${escapeHtml(resourcePath)}">${escapeHtml(label)}</button>`
    }

    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" />`
  }

  renderer.link = function (
    this: { parser?: { parseInline: (tokens: unknown[]) => string } },
    token: { href?: string; text?: string; tokens?: unknown[] } | string,
  ) {
    const href =
      typeof token === 'object' && token !== null ? token.href || '' : String(token || '')
    const html =
      typeof token === 'object' && token !== null && Array.isArray(token.tokens) && this.parser
        ? this.parser.parseInline(token.tokens)
        : escapeHtml(
            typeof token === 'object' && token !== null ? token.text || href : String(token || ''),
          )
    const attrs = isExternalOpenHref(href) ? ' target="_blank" rel="noopener noreferrer"' : ''
    if (isLocalResourceHref(href)) {
      const location = parseLocalResourceLocation(href)
      const suffix = formatLocalResourceLineLabel(location)
      if (suffix && !localResourceLabelIncludesLocation(html.replace(/<[^>]+>/g, ''))) {
        return `<a href="${escapeHtml(href)}"${attrs}>${html}<span class="resource-line-label">${escapeHtml(suffix)}</span></a>`
      }
    }
    return `<a href="${escapeHtml(href)}"${attrs}>${html}</a>`
  }

  marked.setOptions({
    renderer,
    gfm: true,
    breaks: true,
  })
}

initMarked()

const FENCE_LANGUAGES = [
  'shellscript',
  'typescript',
  'javascript',
  'plaintext',
  'dockerfile',
  'markdown',
  'console',
  'python',
  'kotlin',
  'swift',
  'bash',
  'fish',
  'shell',
  'text',
  'jsonc',
  'html',
  'scss',
  'rust',
  'java',
  'yaml',
  'toml',
  'diff',
  'zsh',
  'txt',
  'jsx',
  'tsx',
  'json',
  'css',
  'sql',
  'yml',
  'ini',
  'md',
  'sh',
  'js',
  'ts',
  'py',
  'go',
  'rs',
]

function splitJoinedFenceInfo(info: string): { lang: string; body: string } | null {
  const lower = info.toLowerCase()
  for (const lang of FENCE_LANGUAGES) {
    if (!lower.startsWith(lang) || info.length <= lang.length) continue
    const body = info.slice(lang.length).replace(/^\s+/, '')
    if (!body) return null
    return { lang: info.slice(0, lang.length), body }
  }
  return null
}

function repairJoinedCodeFences(content: string): string {
  return content
    .replace(/([^\n])(```|~~~)([A-Za-z][A-Za-z0-9_+#.-]*)(?=\n|[^\n`~]*\2)/g, '$1\n\n$2$3')
    .replace(
      /(```|~~~)([^\n`~]+)(?:\n([\s\S]*?))?(\1)/g,
      (match, fence: string, info: string, rest: string | undefined, closingFence: string) => {
        const split = splitJoinedFenceInfo(info)
        if (!split) return match
        const tail = rest ? `\n${rest}` : ''
        return `${fence}${split.lang}\n${split.body}${tail}\n${closingFence}`
      },
    )
}

function getFenceOpen(line: string): { fence: string; lang: string } | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const info = match[3].trim()
  if (info.includes(match[2])) return null
  return { fence: match[2], lang: info.split(/\s+/)[0].toLowerCase() }
}

function isFenceClose(line: string, fence: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < fence.length) return false
  return [...trimmed].every((char) => char === fence[0])
}

function isLikelyMarkdownBoundary(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  return (
    /^(#{1,6})\s+\S/.test(trimmed) ||
    /^([-*+])\s+\S/.test(trimmed) ||
    /^\d+[.)]\s+\S/.test(trimmed) ||
    /^>\s+\S/.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed) ||
    /^\*\*[^*]+/.test(trimmed) ||
    /^[\u4e00-\u9fff][^`]*[。；：，、]/.test(trimmed)
  )
}

function closeLeakingCodeFences(content: string): string {
  const lines = content.split('\n')
  const out: string[] = []
  let open: { fence: string; lang: string } | null = null
  let sawBlankInFence = false
  let codeLineCount = 0
  let pendingBlankLines: string[] = []
  const MAX_LEAKED_FENCE_BLANK_LINES = 2

  const flushPendingBlankLines = (limit?: number) => {
    const count =
      typeof limit === 'number'
        ? Math.min(pendingBlankLines.length, limit)
        : pendingBlankLines.length
    out.push(...pendingBlankLines.slice(0, count))
    pendingBlankLines = []
  }

  for (const line of lines) {
    if (open) {
      if (isFenceClose(line, open.fence)) {
        flushPendingBlankLines()
        out.push(line)
        open = null
        sawBlankInFence = false
        codeLineCount = 0
        continue
      }

      if (sawBlankInFence && codeLineCount > 0 && isLikelyMarkdownBoundary(line)) {
        flushPendingBlankLines(MAX_LEAKED_FENCE_BLANK_LINES)
        out.push(open.fence)
        open = null
        sawBlankInFence = false
        codeLineCount = 0
      } else {
        if (line.trim()) {
          flushPendingBlankLines()
          out.push(line)
          codeLineCount += 1
        } else {
          pendingBlankLines.push(line)
          sawBlankInFence = true
        }
        continue
      }
    }

    out.push(line)
    const fenceOpen = getFenceOpen(line)
    if (fenceOpen) {
      open = fenceOpen
      sawBlankInFence = false
      codeLineCount = 0
    }
  }

  if (open) {
    flushPendingBlankLines(MAX_LEAKED_FENCE_BLANK_LINES)
    out.push(open.fence)
  }
  return out.join('\n')
}

function normalizeMalformedCodeFences(content: string): string {
  return closeLeakingCodeFences(repairJoinedCodeFences(String(content || '')))
}

export function renderMarkdown(content: string): string {
  try {
    return marked.parse(
      normalizeMalformedCodeFences(autolinkLocalFileReferencesInMarkdown(content)),
    ) as string
  } catch {
    return `<p>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
  }
}

function getOpenableExternalUrl(rawHref: string, resolvedHref?: string): URL | null {
  const href = (resolvedHref || rawHref).trim()
  if (!href) return null
  try {
    const url = new URL(href, window.location.href)
    return /^(https?:|mailto:|tel:)$/i.test(url.protocol) ? url : null
  } catch {
    return null
  }
}

function isExternalOpenHref(href: string): boolean {
  return !isLocalResourceHref(href) && /^(https?:|mailto:|tel:)/i.test(href.trim())
}

export function openExternalHref(rawHref: string, resolvedHref?: string): boolean {
  const url = getOpenableExternalUrl(rawHref, resolvedHref)
  if (!url) return false
  const opened = window.open(url.href, '_blank', 'noopener,noreferrer')
  if (opened) opened.opener = null
  return true
}
