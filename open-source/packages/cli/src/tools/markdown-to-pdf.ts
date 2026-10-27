// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/markdown-to-pdf.test.ts

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { resolveShennianPath } from '../config/index.js'

const execFileAsync = promisify(execFile)

export const MARKDOWN_PDF_SKILL_ID = 'markdown-to-pdf'
export const MARKDOWN_PDF_BROWSER_DOCTOR_ID = 'markdownPdf.browser'
export const MARKDOWN_PDF_MANAGED_CHROMIUM_ACTION_ID = 'markdownPdf.installManagedChromium'
export const MARKDOWN_PDF_SETUP_REQUIRED_CODE = 'SKILL_SETUP_REQUIRED'
export const PLAYWRIGHT_VERSION_FOR_MANAGED_CHROMIUM = '1.59.1'

export type MarkdownPdfSetupRequiredPayload = {
  code: typeof MARKDOWN_PDF_SETUP_REQUIRED_CODE
  skillId: typeof MARKDOWN_PDF_SKILL_ID
  doctorId: typeof MARKDOWN_PDF_BROWSER_DOCTOR_ID
  recommendedRepairActionId: typeof MARKDOWN_PDF_MANAGED_CHROMIUM_ACTION_ID
}

export function markdownPdfSetupRequiredPayload(): MarkdownPdfSetupRequiredPayload {
  return {
    code: MARKDOWN_PDF_SETUP_REQUIRED_CODE,
    skillId: MARKDOWN_PDF_SKILL_ID,
    doctorId: MARKDOWN_PDF_BROWSER_DOCTOR_ID,
    recommendedRepairActionId: MARKDOWN_PDF_MANAGED_CHROMIUM_ACTION_ID,
  }
}

export class MarkdownPdfBrowserMissingError extends Error {
  readonly code = MARKDOWN_PDF_SETUP_REQUIRED_CODE
  readonly setup = markdownPdfSetupRequiredPayload()

  constructor(
    message = 'PDF export needs a local headless browser. Install the PDF export component, then retry.',
  ) {
    super(message)
    this.name = 'MarkdownPdfBrowserMissingError'
  }
}

export type MarkdownToPdfOptions = {
  outputPath?: string
  title?: string
  keepHtml?: boolean
  chromePath?: string
}

export type MarkdownToPdfResult = {
  inputPath: string
  outputPath: string
  htmlPath: string | null
  browserPath: string
}

const FENCED_CODE_RE = /^```(\S*)\s*$/

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
}

function pathApiForPath(value: string): typeof path.win32 | typeof path.posix {
  return isWindowsAbsolutePath(value) ? path.win32 : path
}

export function defaultPdfOutputPath(inputPath: string): string {
  const api = pathApiForPath(inputPath)
  const parsed = api.parse(inputPath)
  return api.join(parsed.dir, `${parsed.name}.pdf`)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function renderInline(markdown: string, sourceDir: string): string {
  let text = escapeHtml(markdown)
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  text = text.replace(/_([^_]+)_/g, '<em>$1</em>')
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, rawUrl: string) => {
    const url = rawUrl.trim().replace(/^&lt;|&gt;$/g, '')
    const src = toSafeAssetUrl(url, sourceDir)
    return `<img src="${escapeHtml(src)}" alt="${alt}" />`
  })
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawUrl: string) => {
    const url = rawUrl.trim().replace(/^&lt;|&gt;$/g, '')
    return `<a href="${escapeHtml(url)}">${label}</a>`
  })
  return text
}

function toSafeAssetUrl(rawUrl: string, sourceDir: string): string {
  if (/^(https?:|data:|file:)/i.test(rawUrl)) return rawUrl
  const withoutAnchor = rawUrl.split('#')[0].split('?')[0]
  const resolved = path.resolve(sourceDir, decodeURIComponent(withoutAnchor))
  const relative = path.relative(sourceDir, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return ''
  return pathToFileURL(resolved).href
}

function renderTable(lines: string[], sourceDir: string): string | null {
  if (lines.length < 2) return null
  const separator = lines[1].trim()
  if (!/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) return null
  const parseRow = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
  const header = parseRow(lines[0])
  const rows = lines.slice(2).map(parseRow)
  return [
    '<table>',
    '<thead><tr>',
    ...header.map((cell) => `<th>${renderInline(cell, sourceDir)}</th>`),
    '</tr></thead>',
    '<tbody>',
    ...rows.map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${renderInline(cell, sourceDir)}</td>`).join('')}</tr>`,
    ),
    '</tbody></table>',
  ].join('')
}

export function renderMarkdownBody(markdown: string, sourceDir = process.cwd()): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let code: { lang: string; lines: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    out.push(`<p>${renderInline(paragraph.join(' '), sourceDir)}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const tag = list.ordered ? 'ol' : 'ul'
    out.push(
      `<${tag}>${list.items.map((item) => `<li>${renderInline(item, sourceDir)}</li>`).join('')}</${tag}>`,
    )
    list = null
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fence = line.match(FENCED_CODE_RE)
    if (code) {
      if (fence) {
        out.push(
          `<pre><code${code.lang ? ` class="language-${escapeHtml(code.lang)}"` : ''}>${escapeHtml(code.lines.join('\n'))}</code></pre>`,
        )
        code = null
      } else {
        code.lines.push(line)
      }
      continue
    }
    if (fence) {
      flushParagraph()
      flushList()
      code = { lang: fence[1] || '', lines: [] }
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const tableCandidate = lines.slice(i, i + 2)
    const maybeTable = renderTable(tableCandidate, sourceDir)
    if (maybeTable) {
      const tableLines = [line, lines[i + 1]]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        tableLines.push(lines[i])
        i += 1
      }
      i -= 1
      flushParagraph()
      flushList()
      out.push(renderTable(tableLines, sourceDir)!)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const content = renderInline(heading[2].trim(), sourceDir)
      const id = slugify(content)
      out.push(`<h${level}${id ? ` id="${id}"` : ''}>${content}</h${level}>`)
      continue
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      const isOrdered = Boolean(ordered)
      if (!list || list.ordered !== isOrdered) flushList()
      if (!list) list = { ordered: isOrdered, items: [] }
      list.items.push((unordered?.[1] ?? ordered?.[1] ?? '').trim())
      continue
    }

    const quote = line.match(/^>\s?(.+)$/)
    if (quote) {
      flushParagraph()
      flushList()
      out.push(`<blockquote>${renderInline(quote[1], sourceDir)}</blockquote>`)
      continue
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph()
      flushList()
      out.push('<hr />')
      continue
    }

    paragraph.push(line.trim())
  }

  if (code) {
    out.push(
      `<pre><code${code.lang ? ` class="language-${escapeHtml(code.lang)}"` : ''}>${escapeHtml(code.lines.join('\n'))}</code></pre>`,
    )
  }
  flushParagraph()
  flushList()
  return out.join('\n')
}

export function renderMarkdownHtml(
  markdown: string,
  options: { title?: string; sourceDir?: string } = {},
): string {
  const title = options.title || 'Markdown Export'
  const body = renderMarkdownBody(markdown, options.sourceDir)
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body {
  color: #111827;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.68;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 .55em; page-break-after: avoid; }
h1 { font-size: 28px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; }
h2 { font-size: 22px; border-bottom: 1px solid #eef2f7; padding-bottom: 6px; }
h3 { font-size: 18px; }
p { margin: .65em 0; }
a { color: #2563eb; text-decoration: none; }
img { display: block; max-width: 100%; max-height: 240mm; margin: 12px auto; object-fit: contain; }
pre { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; overflow: hidden; white-space: pre-wrap; word-break: break-word; }
code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: .92em; }
p code, li code, td code { background: #f3f4f6; border-radius: 4px; padding: 1px 4px; }
blockquote { margin: 1em 0; padding: .6em 1em; border-left: 4px solid #d1d5db; color: #4b5563; background: #f9fafb; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px; }
th, td { border: 1px solid #d1d5db; padding: 7px 9px; vertical-align: top; }
th { background: #f3f4f6; font-weight: 700; }
tr { page-break-inside: avoid; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.6em 0; }
</style>
</head>
<body>
${body}
</body>
</html>`
}

function executableCandidates(): string[] {
  const envPath = process.env.SHENNIAN_CHROME_PATH
  const candidates = envPath ? [envPath] : []
  candidates.push(...managedChromiumExecutableCandidates())
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    )
  } else if (process.platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value))
    for (const root of roots) {
      candidates.push(
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      )
    }
  } else {
    candidates.push(
      'google-chrome-stable',
      'google-chrome',
      'chromium-browser',
      'chromium',
      'microsoft-edge',
      'brave-browser',
    )
  }
  return candidates
}

export function managedChromiumBrowsersPath(): string {
  return resolveShennianPath('browsers', 'ms-playwright')
}

function managedChromiumExecutableCandidates(): string[] {
  const root = managedChromiumBrowsersPath()
  if (!fs.existsSync(root)) return []
  const candidates: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('chromium-')) continue
    const dir = path.join(root, entry.name)
    if (process.platform === 'darwin') {
      candidates.push(path.join(dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
    } else if (process.platform === 'win32') {
      candidates.push(path.join(dir, 'chrome-win', 'chrome.exe'))
    } else {
      candidates.push(path.join(dir, 'chrome-linux', 'chrome'))
    }
  }
  return candidates
}

export async function findChromiumExecutable(explicitPath?: string): Promise<string> {
  const candidates = explicitPath ? [explicitPath] : executableCandidates()
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) || path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate
      continue
    }
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 5000 })
      return candidate
    } catch {
      // continue
    }
  }
  throw new MarkdownPdfBrowserMissingError()
}

export async function installManagedChromium(): Promise<{ browsersPath: string; output: string }> {
  const browsersPath = managedChromiumBrowsersPath()
  fs.mkdirSync(browsersPath, { recursive: true })
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const { stdout, stderr } = await execFileAsync(
    npx,
    ['-y', `playwright@${PLAYWRIGHT_VERSION_FOR_MANAGED_CHROMIUM}`, 'install', 'chromium'],
    {
      timeout: 10 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browsersPath,
      },
    },
  )
  return {
    browsersPath,
    output: [stdout, stderr].filter(Boolean).join('\n').slice(0, 20_000),
  }
}

export async function convertMarkdownToPdf(
  inputPath: string,
  options: MarkdownToPdfOptions = {},
): Promise<MarkdownToPdfResult> {
  const resolvedInput = path.resolve(inputPath)
  const stat = fs.statSync(resolvedInput)
  if (!stat.isFile()) throw new Error(`Not a file: ${inputPath}`)
  if (!/\.mdx?$/i.test(resolvedInput))
    throw new Error('Input must be a Markdown file (.md or .mdx)')

  const outputPath = path.resolve(options.outputPath || defaultPdfOutputPath(resolvedInput))
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const markdown = fs.readFileSync(resolvedInput, 'utf8')
  const html = renderMarkdownHtml(markdown, {
    title: options.title || path.basename(resolvedInput),
    sourceDir: path.dirname(resolvedInput),
  })
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-mdpdf-'))
  const htmlPath = options.keepHtml
    ? outputPath.replace(/\.pdf$/i, '.html')
    : path.join(tempDir, 'document.html')
  fs.writeFileSync(htmlPath, html, 'utf8')

  const browserPath = await findChromiumExecutable(options.chromePath)
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    `--print-to-pdf=${outputPath}`,
    pathToFileURL(htmlPath).href,
  ]
  try {
    await execFileAsync(browserPath, args, { timeout: 120_000, maxBuffer: 1024 * 1024 })
  } finally {
    if (!options.keepHtml) fs.rmSync(tempDir, { recursive: true, force: true })
  }

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error('PDF export failed: output file was not created')
  }
  return {
    inputPath: resolvedInput,
    outputPath,
    htmlPath: options.keepHtml ? htmlPath : null,
    browserPath,
  }
}
