// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-codex-current-input.test.ts

import path from 'node:path'
import {
  buildUserMessagePayload,
  isSystemControlPayload,
  type ChatAttachmentMeta,
} from '@shennian/wire'
import { inferMimeType, normalizeText } from './parser-common.js'
import type { ParsedNativeEvent } from './types.js'
import { parseCodexTextElements, stripCodexUserMessageWrapper } from './codex-user-input.js'

export function parseCodexLocalImageAttachment(value: unknown): ChatAttachmentMeta | null {
  if (typeof value === 'string') {
    const imagePath = value.trim()
    if (!imagePath) return null
    return {
      path: imagePath,
      name: path.basename(imagePath) || 'image.png',
      mimeType: inferMimeType(imagePath),
      kind: 'image',
    }
  }
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  const imagePath =
    typeof entry.path === 'string'
      ? entry.path
      : typeof entry.file_path === 'string'
        ? entry.file_path
        : typeof entry.saved_path === 'string'
          ? entry.saved_path
          : typeof entry.image_path === 'string'
            ? entry.image_path
            : ''
  if (!imagePath.trim()) return null
  const name =
    typeof entry.name === 'string' && entry.name.trim()
      ? entry.name
      : path.basename(imagePath) || 'image.png'
  const mimeType =
    typeof entry.mimeType === 'string' && entry.mimeType.trim()
      ? entry.mimeType
      : inferMimeType(imagePath)
  return {
    path: imagePath,
    name,
    mimeType,
    kind: 'image',
  }
}

export function isCodexInjectedContextText(text: string): boolean {
  const normalized = normalizeText(text)
  if (!normalized) return false
  if (isSystemControlPayload(normalized)) return true
  if (
    /^<environment_context>[\s\S]*<\/environment_context>$/i.test(normalized) &&
    normalized.includes('<current_date>') &&
    normalized.includes('<timezone>') &&
    normalized.includes('<workspace_roots>')
  ) {
    return true
  }
  const hasRecommendedPluginsPrefix =
    normalized.startsWith('<recommended_plugins>') && normalized.includes('</recommended_plugins>')
  const hasProjectInstructions =
    normalized.includes('# AGENTS.md instructions for ') &&
    normalized.includes('<INSTRUCTIONS>') &&
    normalized.includes('</INSTRUCTIONS>')
  const hasEnvironmentContext =
    normalized.includes('<environment_context>') && normalized.includes('</environment_context>')
  return (
    hasProjectInstructions &&
    hasEnvironmentContext &&
    (normalized.startsWith('# AGENTS.md instructions for ') || hasRecommendedPluginsPrefix)
  )
}

export function parseCodexUserMessage(payload: Record<string, unknown>): {
  payload: string
  titleText: string
  repairHint?: ParsedNativeEvent['repairHint']
} | null {
  const textFromElements = parseCodexTextElements(payload.text_elements)
  const textFromInput = Array.isArray(payload.input) ? parseCodexTextElements(payload.input) : ''
  const strippedMessage =
    typeof payload.message === 'string'
      ? stripCodexUserMessageWrapper(payload.message)
      : { text: '', strippedWrapper: false }
  const textFromMessage = strippedMessage.text
  const text = textFromElements || textFromInput || textFromMessage
  const repairHint = strippedMessage.strippedWrapper ? 'codex_app_context_wrapper' : undefined

  const attachments = Array.isArray(payload.local_images)
    ? payload.local_images
        .map(parseCodexLocalImageAttachment)
        .filter((item): item is ChatAttachmentMeta => item != null)
    : []

  if (!text && attachments.length === 0) return null
  if (isSystemControlPayload(text) && attachments.length === 0) return null
  if (isCodexInjectedContextText(text) && attachments.length === 0) return null
  if (attachments.length > 0) {
    return {
      payload: buildUserMessagePayload(text, attachments),
      titleText: text,
      repairHint,
    }
  }
  return { payload: text, titleText: text, repairHint }
}
