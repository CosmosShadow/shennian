// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/simple-message-links.test.ts
import { diaryLinkDate } from '../../features/personal-workspace/diaryLink'
import { isLocalResourceHref, normalizeLocalResourceHref } from '../../features/chat/utils/attachments'

export function isOpenableMessageLink(url: string): boolean {
  return /^(?:https?:|mailto:|tel:)/i.test(url.trim())
}

export function isLocalMessageLink(url: string): boolean {
  const value = url.trim()
  if (!value || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith('//')) return false
  // Do not mistake unknown/custom URI schemes for relative file paths.
  if (/^[a-z][a-z\d+.-]*:/i.test(value)
    && !/^file:\/\//i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return false
  return isLocalResourceHref(value)
}

/** Return true only when the Markdown renderer should use the OS URL opener. */
export function openMessageLink(url: string, onResourcePress?: (path: string) => void): boolean {
  if (isOpenableMessageLink(url)) return true
  if (onResourcePress && diaryLinkDate(url)) { onResourcePress(url); return false }
  if (onResourcePress && isLocalMessageLink(url)) {
    // MarkdownIt percent-encodes spaces/Unicode. file:// normalization already
    // decodes its pathname, so never decode that form twice.
    let path = normalizeLocalResourceHref(url)
    if (!/^file:\/\//i.test(url.trim())) {
      try { path = decodeURIComponent(path) } catch { /* Keep literal malformed escapes. */ }
    }
    if (isLocalMessageLink(path)) onResourcePress(path)
  }
  return false
}
