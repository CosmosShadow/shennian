// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/session-previews.test.ts

import {
  extractPayloadText,
  isApprovalPendingPayload,
  isSystemControlPayload,
  isToolPayload,
  parseUserMessagePayload,
  sanitizeSessionPreview,
} from '@shennian/wire'
import type { ChatAttachmentMeta, Envelope } from '@shennian/wire'
import { cleanPreviewDisplayText } from './preview-display-text'

export const SESSION_PREVIEW_MAX_LEN = 100
const CANONICAL_ATTACHMENT_PREVIEW_RE = /^\[(?:(\d+) Images?|Image)(?: · (?:(\d+) Files?|File))?\]$|^\[(?:(\d+) Files?|File)\]$/
const STANDALONE_IMAGE_REF_RE = /^\s*!\[[^\]]*\]\((?:<[^>]+>|[^)\s]+)\)\s*$/
const STANDALONE_LOCAL_FILE_REF_RE = /^\s*\[[^\]]+\]\(<(?:\/|~\/|[A-Za-z]:[\\/])[^>]+>\)\s*$/

type AttachmentCounts = { images: number; files: number }

function canonicalAttachmentPreview({ images, files }: AttachmentCounts): string {
  const imageText = images === 1 ? 'Image' : `${images} Images`
  const fileText = files === 1 ? 'File' : `${files} Files`
  if (images > 0 && files > 0) return `[${imageText} · ${fileText}]`
  if (images > 0) return `[${imageText}]`
  if (files > 0) return `[${fileText}]`
  return ''
}

function parseCanonicalAttachmentPreview(preview: string): AttachmentCounts | null {
  const match = preview.match(CANONICAL_ATTACHMENT_PREVIEW_RE)
  if (!match) return null
  if (match[3] != null || preview === '[File]') {
    return { images: 0, files: match[3] ? Number(match[3]) : 1 }
  }
  return {
    images: match[1] ? Number(match[1]) : 1,
    files: match[2] ? Number(match[2]) : preview.includes(' · File') ? 1 : 0,
  }
}

export function buildSessionMessagePreview(
  content: string,
  attachments?: Array<Pick<ChatAttachmentMeta, 'kind'>>,
  opts?: { maxLength?: number },
): string {
  const counts: AttachmentCounts = attachments?.length
    ? {
        images: attachments.filter((attachment) => attachment.kind === 'image').length,
        files: attachments.filter((attachment) => attachment.kind !== 'image').length,
      }
    : { images: 0, files: 0 }
  const textLines: string[] = []

  for (const line of content.split('\n')) {
    if (STANDALONE_IMAGE_REF_RE.test(line)) {
      if (!attachments?.length) counts.images += 1
      continue
    }
    if (STANDALONE_LOCAL_FILE_REF_RE.test(line)) {
      if (!attachments?.length) counts.files += 1
      continue
    }
    textLines.push(line)
  }

  const oneLine = textLines.join(' ').replace(/\s+/g, ' ').trim()
  if (oneLine) {
    const maxLength = opts?.maxLength ?? SESSION_PREVIEW_MAX_LEN
    return sanitizeSessionPreview(oneLine, maxLength) ?? ''
  }
  return canonicalAttachmentPreview(counts)
}

export function formatSessionPreviewForDisplay(
  preview: string,
  labels: {
    image: string
    images: (count: number) => string
    file: string
    files: (count: number) => string
  },
): string {
  // Strip standalone attachments first, then clean markup before the display cap.
  // Safety filtering still runs before any presentation transformations.
  if (!sanitizeSessionPreview(preview, Math.max(1, preview.length))) return ''
  const withoutBlockMarkers = preview.replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+)/gm, '')
  const normalized = buildSessionMessagePreview(withoutBlockMarkers, undefined, { maxLength: Math.max(1, preview.length) })
  const counts = parseCanonicalAttachmentPreview(normalized)
  if (!counts) return sanitizeSessionPreview(cleanPreviewDisplayText(normalized), SESSION_PREVIEW_MAX_LEN) ?? ''

  const imageText = counts.images === 1 ? labels.image : counts.images > 1 ? labels.images(counts.images) : ''
  const fileText = counts.files === 1 ? labels.file : counts.files > 1 ? labels.files(counts.files) : ''
  return [imageText, fileText].filter(Boolean).join(' · ')
}

export function trimPreviewText(text: string): string {
  return sanitizeSessionPreview(text, SESSION_PREVIEW_MAX_LEN) ?? ''
}

export function isToolCallPayload(payload: string): boolean {
  return isToolPayload(payload)
}

export function extractPreviewText(payload: string): string {
  if (!payload) return ''
  if (isApprovalPendingPayload(payload)) return '需要用户确认'
  if (isToolPayload(payload) || isSystemControlPayload(payload)) return ''
  const userPayload = parseUserMessagePayload(payload)
  if (userPayload) {
    return buildSessionMessagePreview(userPayload.content, userPayload.attachments)
  }
  return buildSessionMessagePreview(extractPayloadText(payload))
}

export function extractLatestReadablePreview(messages: Envelope[]): string {
  const sorted = [...messages].sort((left, right) => right.ts - left.ts)
  for (const message of sorted) {
    const preview = extractPreviewText(message.payload)
    if (preview) return preview
  }
  return ''
}
