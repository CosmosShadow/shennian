// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/image-gallery.test.ts

import type { ChatAttachmentMeta } from '@shennian/wire'
import { buildAttachmentMeta, isLocalResourceHref, resolveResourcePath } from './attachments'

/** Only the clicked message supplies this snapshot; never search other messages by path. */
export function buildImageGalleryPaths(rawPaths: string[] | undefined, workDir: string): string[] {
  if (!Array.isArray(rawPaths)) return []
  return [
    ...new Set(
      (rawPaths ?? [])
        .filter((path) => typeof path === 'string' && isLocalResourceHref(path))
        .map((path) => resolveResourcePath(path, workDir)),
    ),
  ]
}

export function parseImageGallery(
  value: string | undefined,
  selectedPath?: string,
): ChatAttachmentMeta[] {
  if (!value || !selectedPath) return []
  try {
    const paths: unknown = JSON.parse(value)
    if (
      !Array.isArray(paths) ||
      !paths.every((path) => typeof path === 'string' && isLocalResourceHref(path))
    )
      return []
    const unique = [...new Set(paths as string[])]
    if (unique.length < 2 || !unique.includes(selectedPath)) return []
    return unique.map((path) => buildAttachmentMeta({ path, kind: 'image' }))
  } catch {
    return []
  }
}

export function imagePageIndex(offset: number, width: number, count: number): number {
  if (width <= 0 || count <= 0 || !Number.isFinite(offset)) return 0
  return Math.max(0, Math.min(count - 1, Math.round(offset / width)))
}

export function collectMessageImagePaths(node: Element): string[] | undefined {
  const row = node.closest('[data-id]')
  if (
    !row ||
    !node.matches(
      '.resource-pill-image, .attachment-thumb-btn, .attachment-image-placeholder, [data-resource-kind="image"]',
    )
  )
    return undefined
  return [
    ...new Set(
      Array.from(
        row.querySelectorAll(
          '.resource-pill-image[data-resource-path], .attachment-thumb-btn[data-resource-path], .attachment-image-placeholder[data-resource-path], [data-resource-kind="image"][data-resource-path]',
        ),
      )
        .map((image) => image.getAttribute('data-resource-path')!)
        .filter(Boolean),
    ),
  ]
}
