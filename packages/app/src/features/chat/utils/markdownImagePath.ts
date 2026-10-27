// @arch docs/architecture/app/chat-attachments-preview.md#3-渲染与预览
// @test src/__tests__/markdown-image-path.test.ts

import { getParentDirectoryPath } from '../../../utils/directoryNavigation'
import { isLocalResourceHref, resolveResourcePath } from './attachments'

/** Resolve an embedded image against the Markdown file, not the session workDir or phone. */
export function resolveMarkdownImagePath(href: string, markdownPath: string): string | null {
  if (!isLocalResourceHref(href)) return null
  const raw = resolveResourcePath(href, getParentDirectoryPath(markdownPath))
  const windows = /^[A-Za-z]:[\\/]/.test(raw)
  if (!windows && !raw.startsWith('/')) return null

  const slashPath = raw.replace(/\\/g, '/')
  const drive = windows ? slashPath.slice(0, 2) : ''
  const parts = (windows ? slashPath.slice(2) : slashPath).split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return windows ? `${drive}\\${normalized.join('\\')}` : `/${normalized.join('/')}`
}
