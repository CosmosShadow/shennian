// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-image.test.ts
import { resolveMarkdownImagePath } from '../chat/utils/markdownImagePath'
import { buildAttachmentMeta } from '../chat/utils/attachments'

/** Never treat a computer path as a phone URI or fetch external tracking images. */
export function diaryImageAttachment(src: string, directory: string | undefined, path: string) {
  const absolute = /^(?:\/|[A-Za-z]:[\\/])/.test(src) || src.startsWith('file:')
  if (!directory && !absolute) return null
  const resolved = resolveMarkdownImagePath(src, `${directory ?? ''}/${path}`)
  if (!resolved) return null
  const image = buildAttachmentMeta({ path: resolved })
  return image.kind === 'image' ? image : null
}
