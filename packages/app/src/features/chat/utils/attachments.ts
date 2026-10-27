// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/chat-attachments.test.ts

import type { ChatAttachmentKind, ChatAttachmentMeta } from '@shennian/wire'
import { isHeicFile } from '../../uploads/heicFile'

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'svg',
])
const AUTOLINK_FILE_EXTS = [
  'aac',
  'avi',
  'bash',
  'bmp',
  'c',
  'cc',
  'cfg',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'cts',
  'doc',
  'docx',
  'env',
  'gif',
  'go',
  'h',
  'heic',
  'heif',
  'hpp',
  'htm',
  'html',
  'ico',
  'ini',
  'java',
  'jpeg',
  'jpg',
  'js',
  'json',
  'jsonc',
  'jsx',
  'kt',
  'lock',
  'log',
  'm4a',
  'md',
  'mdx',
  'mov',
  'mp3',
  'mp4',
  'mts',
  'pdf',
  'php',
  'plist',
  'png',
  'ppt',
  'pptx',
  'properties',
  'py',
  'rb',
  'rs',
  'sass',
  'scss',
  'sh',
  'sql',
  'svg',
  'swift',
  'toml',
  'ts',
  'tsx',
  'txt',
  'wav',
  'webm',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
  'zip',
] as const

const AUTOLINK_FILE_EXT_PATTERN = [...AUTOLINK_FILE_EXTS]
  .sort((a, b) => b.length - a.length)
  .join('|')
const AUTOLINK_PATH_PATTERN = new RegExp(
  String.raw`(^|[\s([{"'，。；：、])((?:[A-Za-z]:[\\/]|~[\\/]|/|(?:\.{1,2}|\.uploads)[\\/]|[A-Za-z0-9._-]+[\\/])(?:[^\s<>()\[\]{}"'，。；：、]+[\\/])*[^\s<>()\[\]{}"'，。；：、]+\.(?:${AUTOLINK_FILE_EXT_PATTERN})(?::\d+(?:(?::|-)\d+)?)?)(?=$|[\s<>()\[\]{}"'，。；：、.,!?;])`,
  'gi',
)
const PROTECTED_AUTOLINK_TOKEN_PREFIX = '\u0000SNREF'
const PROTECTED_AUTOLINK_TOKEN_SUFFIX = '\u0000'

function stripQuery(path: string): string {
  const hashIndex = path.indexOf('#')
  const queryIndex = path.indexOf('?')
  const cutAt = Math.min(
    hashIndex >= 0 ? hashIndex : path.length,
    queryIndex >= 0 ? queryIndex : path.length,
  )
  return path.slice(0, cutAt)
}

export type LocalResourceLocation = {
  rawPath: string
  path: string
  line?: number
  column?: number
  endLine?: number
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function parseLocalResourceLocation(pathValue: string): LocalResourceLocation {
  const rawPath = normalizeLocalResourceHref(pathValue).trim()
  const queryIndex = rawPath.indexOf('?')
  const withoutQueryOnly = queryIndex >= 0 ? rawPath.slice(0, queryIndex) : rawPath
  const withoutQuery = stripQuery(rawPath)

  const hashLineMatch = /^(.*)#L(\d+)(?:-L?(\d+))?$/i.exec(withoutQueryOnly)
  if (hashLineMatch) {
    const line = parsePositiveInt(hashLineMatch[2])
    const endLine = parsePositiveInt(hashLineMatch[3])
    return {
      rawPath,
      path: hashLineMatch[1] || withoutQuery,
      ...(line ? { line } : {}),
      ...(endLine && line && endLine > line ? { endLine } : {}),
    }
  }

  const colonRangeMatch = /^(.*):(\d+):(\d+)$/.exec(withoutQuery)
  if (colonRangeMatch) {
    const candidatePath = colonRangeMatch[1] || withoutQuery
    const basename = candidatePath.split(/[\\/]/).pop() ?? candidatePath
    if (basename.includes('.')) {
      const line = parsePositiveInt(colonRangeMatch[2])
      const column = parsePositiveInt(colonRangeMatch[3])
      return {
        rawPath,
        path: candidatePath,
        ...(line ? { line } : {}),
        ...(column ? { column } : {}),
      }
    }
  }

  const colonLineRangeMatch = /^(.*):(\d+)-(\d+)$/.exec(withoutQuery)
  if (colonLineRangeMatch) {
    const candidatePath = colonLineRangeMatch[1] || withoutQuery
    const basename = candidatePath.split(/[\\/]/).pop() ?? candidatePath
    if (basename.includes('.')) {
      const line = parsePositiveInt(colonLineRangeMatch[2])
      const endLine = parsePositiveInt(colonLineRangeMatch[3])
      return {
        rawPath,
        path: candidatePath,
        ...(line ? { line } : {}),
        ...(endLine && line && endLine > line ? { endLine } : {}),
      }
    }
  }

  const colonLineMatch = /^(.*):(\d+)$/.exec(withoutQuery)
  if (colonLineMatch) {
    const candidatePath = colonLineMatch[1] || withoutQuery
    const basename = candidatePath.split(/[\\/]/).pop() ?? candidatePath
    if (basename.includes('.')) {
      const line = parsePositiveInt(colonLineMatch[2])
      return {
        rawPath,
        path: candidatePath,
        ...(line ? { line } : {}),
      }
    }
  }

  return { rawPath, path: withoutQuery }
}

export function stripResourceFragment(pathValue: string): string {
  return parseLocalResourceLocation(pathValue).path
}

export function formatLocalResourceLineLabel(
  location: Pick<LocalResourceLocation, 'line' | 'endLine' | 'column'>,
): string {
  if (!location.line) return ''
  if (location.endLine && location.endLine > location.line)
    return `lines ${location.line}-${location.endLine}`
  if (location.column) return `line ${location.line}:${location.column}`
  return `line ${location.line}`
}

export function localResourceLabelIncludesLocation(label: string): boolean {
  return /(?:^|[\s(:#])(?:L?\d+|line(?:s)?\s+\d+)/i.test(label)
}

export function appendLocalResourceLineLabel(
  label: string,
  location: Pick<LocalResourceLocation, 'line' | 'endLine' | 'column'>,
): string {
  const suffix = formatLocalResourceLineLabel(location)
  if (!suffix || localResourceLabelIncludesLocation(label)) return label
  return `${label} (${suffix})`
}

export function isRemoteResourceHref(href: string): boolean {
  return /^https?:\/\//i.test(normalizeLocalResourceHref(href))
}

export function normalizeLocalResourceHref(href: string): string {
  let trimmed = String(href || '').trim()
  trimmed = trimmed.replace(/^&lt;/i, '<').replace(/&gt;$/i, '>')
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (url.protocol.toLowerCase() === 'file:') {
        return decodeURIComponent(url.pathname || '').replace(/^\/([A-Za-z]:[\\/])/, '$1')
      }
    } catch {
      return trimmed.replace(/^file:\/\//i, '')
    }
  }
  return trimmed
}

export function normalizeWindowsDrivePath(pathValue: string): string {
  return pathValue.replace(/^[/\\]([A-Za-z]:[\\/].*)$/, '$1')
}

export function getPathBasename(pathValue: string): string {
  const cleaned = stripQuery(pathValue).replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  return parts[parts.length - 1] || cleaned
}

export function getPathExt(pathValue: string): string {
  const name = getPathBasename(pathValue)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
}

export function inferMimeTypeFromName(name: string): string {
  const ext = getPathExt(name)
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'svg':
      return 'image/svg+xml'
    case 'heic':
      return 'image/heic'
    case 'heif':
      return 'image/heif'
    case 'md':
      return 'text/markdown'
    case 'json':
      return 'application/json'
    case 'pdf':
      return 'application/pdf'
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    case 'flac':
      return 'audio/flac'
    case 'opus':
      return 'audio/opus'
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    case 'avi':
      return 'video/x-msvideo'
    default:
      return 'application/octet-stream'
  }
}

export function inferAttachmentKind(name: string, mimeType?: string | null): ChatAttachmentKind {
  const normalizedMimeType = typeof mimeType === 'string' ? mimeType.toLowerCase() : ''
  if (
    normalizedMimeType === 'inode/directory' ||
    normalizedMimeType === 'application/x-directory'
  ) {
    return 'folder'
  }
  // HEIC / HEIF is an ordinary file: no image kind, thumbnail or preview.
  if (isHeicFile({ name, mimeType })) return 'file'
  if (normalizedMimeType.startsWith('image/')) {
    return 'image'
  }
  return IMAGE_EXTS.has(getPathExt(name)) ? 'image' : 'file'
}

function escapeMarkdownLabel(label: string): string {
  return label.replace(/[[\]\\]/g, '\\$&')
}

export function buildAttachmentMarkdownRef(attachment: ChatAttachmentMeta): string {
  const label = escapeMarkdownLabel(attachment.name)
  return attachment.kind === 'image'
    ? `![${label}](<${attachment.path}>)`
    : `[${label}](<${attachment.path}>)`
}

export function buildAttachmentMarkdownRefs(attachments: ChatAttachmentMeta[]): string {
  return attachments.map(buildAttachmentMarkdownRef).join('\n')
}

export function composeAttachmentMessageContent(
  content: string,
  attachments?: ChatAttachmentMeta[],
): string {
  const body = content.trim()
  if (!attachments?.length) return body

  const refs = buildAttachmentMarkdownRefs(attachments)
  if (!body) return refs
  return `${refs}\n\n${body}`
}

export function resolveUploadPath(workDir: string, fileName: string): string {
  const base = workDir.replace(/[\\/]+$/, '')
  return `${base}/.uploads/${fileName}`
}

export type ClipboardImageUploadFile = {
  uri: string
  name: string
  mimeType: string
  size: number
  readBytes: () => Promise<Uint8Array>
}

function imageExtensionFromMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/svg+xml':
      return 'svg'
    default: {
      const match = /^image\/([a-z0-9.+-]+)$/i.exec(mimeType)
      return match?.[1]?.replace(/\+xml$/, '') || 'png'
    }
  }
}

function randomNameSegment(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

function buildPastedImageName(
  file: Pick<File, 'name' | 'type'>,
  now: number,
  index: number,
  randomSegment = randomNameSegment(),
): string {
  const ext = getPathExt(file.name) || imageExtensionFromMimeType(file.type || 'image/png')
  return `pasted_image_${now}_${randomSegment}_${index + 1}.${ext}`
}

export function extractClipboardImageFiles(
  clipboardData: Pick<DataTransfer, 'items'> | null | undefined,
  now = Date.now(),
  createRandomSegment = randomNameSegment,
): ClipboardImageUploadFile[] {
  if (!clipboardData) return []

  const files: ClipboardImageUploadFile[] = []
  Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .forEach((item, index) => {
      const file = item.getAsFile()
      if (!file) return
      const name = isHeicFile(file) && file.name
        ? file.name
        : buildPastedImageName(file, now, index, createRandomSegment())
      files.push({
        uri: URL.createObjectURL(file),
        name,
        mimeType: file.type || inferMimeTypeFromName(name),
        size: file.size,
        readBytes: async () => new Uint8Array(await file.arrayBuffer()),
      })
    })
  return files
}

export function isLocalResourceHref(href: string): boolean {
  if (!href) return false
  const trimmed = normalizeLocalResourceHref(href)
  if (!trimmed) return false
  if (/^(https?|mailto|tel|data|javascript|vbscript|blob|ftp):/i.test(trimmed)) return false
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('.uploads/') ||
    trimmed.startsWith('~')
  )
    return true
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true
  if (!trimmed.includes('://')) return true
  return false
}

function protectRanges(
  text: string,
  ranges: Array<{ start: number; end: number }>,
): { text: string; restore: (value: string) => string } {
  if (ranges.length === 0) return { text, restore: (value) => value }

  const sorted = ranges
    .filter((range) => range.start >= 0 && range.end > range.start)
    .sort((a, b) => a.start - b.start)
  const protectedValues: string[] = []
  let output = ''
  let cursor = 0

  for (const range of sorted) {
    if (range.start < cursor) continue
    output += text.slice(cursor, range.start)
    const token = `${PROTECTED_AUTOLINK_TOKEN_PREFIX}${protectedValues.length}${PROTECTED_AUTOLINK_TOKEN_SUFFIX}`
    protectedValues.push(text.slice(range.start, range.end))
    output += token
    cursor = range.end
  }
  output += text.slice(cursor)

  return {
    text: output,
    restore(value: string) {
      return value.replace(
        new RegExp(
          `${PROTECTED_AUTOLINK_TOKEN_PREFIX}(\\d+)${PROTECTED_AUTOLINK_TOKEN_SUFFIX}`,
          'g',
        ),
        (_match, index: string) => protectedValues[Number(index)] ?? '',
      )
    },
  }
}

function collectMarkdownAutolinkProtectedRanges(
  text: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null

  const fencedCodeRe = /(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[ \t]*(?=\n|$)|$)/g
  while ((match = fencedCodeRe.exec(text))) {
    ranges.push({ start: match.index, end: fencedCodeRe.lastIndex })
  }

  const inlineCodeRe = /`[^`\n]+`/g
  while ((match = inlineCodeRe.exec(text))) {
    ranges.push({ start: match.index, end: inlineCodeRe.lastIndex })
  }

  const markdownLinkRe = /!?\[[^\]\n]*(?:\\.[^\]\n]*)*\]\((?:<[^>\n]+>|[^)\n]+)\)/g
  while ((match = markdownLinkRe.exec(text))) {
    ranges.push({ start: match.index, end: markdownLinkRe.lastIndex })
  }

  const htmlTagRe = /<[^>\n]+>/g
  while ((match = htmlTagRe.exec(text))) {
    ranges.push({ start: match.index, end: htmlTagRe.lastIndex })
  }

  const urlRe = /\b(?:https?|mailto|tel|data|javascript|vbscript|blob|ftp):[^\s<>()]+/gi
  while ((match = urlRe.exec(text))) {
    ranges.push({ start: match.index, end: urlRe.lastIndex })
  }

  return ranges
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/[[\]\\]/g, '\\$&')
}

function splitAutolinkPathTrailingPunctuation(pathValue: string): {
  path: string
  trailing: string
} {
  let path = pathValue
  let trailing = ''

  while (/[.,!?;，。！？；、]$/.test(path)) {
    trailing = path.slice(-1) + trailing
    path = path.slice(0, -1)
  }

  while (path.endsWith(':') && !/:\d+(?::\d+)?:$/.test(path)) {
    trailing = `:${trailing}`
    path = path.slice(0, -1)
  }

  return { path, trailing }
}

function isBareAutolinkPathAllowed(pathValue: string): boolean {
  const normalized = normalizeLocalResourceHref(pathValue)
  return (
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('.uploads/') ||
    normalized.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.includes('/') ||
    normalized.includes('\\')
  )
}

export function autolinkLocalFileReferencesInMarkdown(content: string): string {
  const raw = String(content || '')
  if (!raw) return raw

  const protectedContent = protectRanges(raw, collectMarkdownAutolinkProtectedRanges(raw))
  const linked = protectedContent.text.replace(
    AUTOLINK_PATH_PATTERN,
    (match: string, prefix: string, pathValue: string) => {
      if (!isBareAutolinkPathAllowed(pathValue) || !isLocalResourceHref(pathValue)) return match
      const split = splitAutolinkPathTrailingPunctuation(pathValue)
      if (!split.path || !isLocalResourceHref(split.path)) return match
      const location = parseLocalResourceLocation(split.path)
      const label = escapeMarkdownLinkLabel(appendLocalResourceLineLabel(split.path, location))
      return `${prefix}[${label}](<${split.path}>)${split.trailing}`
    },
  )

  return protectedContent.restore(linked)
}

export function resolveResourcePath(pathValue: string, workDir: string): string {
  const trimmed = normalizeWindowsDrivePath(
    stripResourceFragment(normalizeLocalResourceHref(pathValue)),
  )
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return normalizeLocalResourceHref(pathValue).trim()
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return trimmed
  }

  const base = workDir.replace(/[\\/]+$/, '')
  if (!base) return trimmed
  if (trimmed.startsWith('./')) return `${base}/${trimmed.slice(2)}`
  return `${base}/${trimmed}`
}

export function stripAttachmentRefs(
  content: string,
  attachments?: Array<Pick<ChatAttachmentMeta, 'path' | 'name' | 'mimeType' | 'kind'>>,
): string {
  if (!attachments?.length) return content.trim()

  const refSet = new Set(attachments.map((attachment) => buildAttachmentMarkdownRef(attachment)))
  const lines = content.split('\n').filter((line) => !refSet.has(line.trim()))

  const compacted: string[] = []
  for (const line of lines) {
    const prev = compacted[compacted.length - 1]
    if (!line.trim() && !prev?.trim()) continue
    compacted.push(line)
  }
  return compacted.join('\n').trim()
}

export function getInlinePreviewAttachments<T extends Pick<ChatAttachmentMeta, 'kind'>>(
  attachments?: T[],
): T[] {
  return attachments?.filter((attachment) => attachment.kind === 'image') ?? []
}

export function stripInlinePreviewAttachmentRefs(
  content: string,
  attachments?: Array<Pick<ChatAttachmentMeta, 'path' | 'name' | 'mimeType' | 'kind'>>,
): string {
  return stripAttachmentRefs(content, getInlinePreviewAttachments(attachments))
}

export function buildAttachmentMeta(input: {
  path: string
  name?: string
  mimeType?: string | null
  kind?: ChatAttachmentKind | null
}): ChatAttachmentMeta {
  const name = input.name?.trim() || getPathBasename(input.path)
  const mimeType = input.mimeType?.trim() || inferMimeTypeFromName(name)
  const kind = input.kind ?? inferAttachmentKind(name, mimeType)
  return {
    path: input.path,
    name,
    mimeType,
    kind,
  }
}

export type AttachmentPreviewRouteTarget = {
  pathname: '/(main)/chat/[sessionId]/preview'
  params: Record<string, string>
}

export function buildAttachmentPreviewRouteTarget(input: {
  rawPath: string
  workDir: string
  sessionId: string
  hydratedMessages: Array<{ attachments?: ChatAttachmentMeta[] }>
}): AttachmentPreviewRouteTarget {
  const location = parseLocalResourceLocation(input.rawPath)
  const resolvedPath = resolveResourcePath(input.rawPath, input.workDir)
  let attachment: ChatAttachmentMeta | undefined
  for (const message of input.hydratedMessages) {
    attachment = (message.attachments ?? []).find((item) => item.path === resolvedPath)
    if (attachment) break
  }
  const target = attachment ?? buildAttachmentMeta({ path: resolvedPath })

  return {
    pathname: '/(main)/chat/[sessionId]/preview',
    params: {
      sessionId: input.sessionId,
      path: target.path,
      name: target.name,
      mimeType: target.mimeType,
      ...(target.kind === 'folder' ? { kind: target.kind } : {}),
      ...(location.line ? { line: String(location.line) } : {}),
      ...(location.endLine ? { endLine: String(location.endLine) } : {}),
      ...(location.column ? { column: String(location.column) } : {}),
    },
  }
}

export function resolvePreviewAttachmentCandidate(input: {
  sessionMatches: boolean
  messages: Array<{
    attachments?: Array<ChatAttachmentMeta & { previewData?: string }>
  }>
  path?: string
  name?: string
  mimeType?: string | null
  kind?: ChatAttachmentKind | null
}): (ChatAttachmentMeta & { previewData?: string }) | null {
  if (!input.path) return null
  const path = normalizeWindowsDrivePath(input.path)

  if (input.sessionMatches) {
    for (const message of input.messages) {
      const current = message.attachments?.find((attachment) => attachment.path === path)
      if (current) return current
    }
  }

  return buildAttachmentMeta({
    path,
    name: input.name,
    mimeType: input.mimeType,
    kind: input.kind,
  })
}
