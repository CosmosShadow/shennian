// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-adapter.test.ts

import type { ChatAttachmentMeta } from '@shennian/wire'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

export function isCodexActiveWriterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /already has an active writer|thread-store conflict/i.test(message)
}

export function isCodexPaginatedHistoryUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /paginated(?:_threads|\s+(?:thread\s+)?history)?.*(?:not supported|unsupported|unavailable)/i.test(
      message,
    ) ||
    /(?:not supported|unsupported|unavailable).*paginated(?:_threads|\s+(?:thread\s+)?history)?/i.test(
      message,
    )
  )
}

export function isCodexExcludeTurnsUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /unknown field [`'"]?excludeTurns/i.test(message) ||
    /excludeTurns.*(?:not supported|unsupported|unavailable)/i.test(message)
  )
}

export function isCodexProjectApiUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /(?:method not found|unknown method).*(?:project\/list|project\/create)/i.test(message) ||
    /(?:project\/list|project\/create).*(?:not supported|unsupported|unavailable)/i.test(message)
  )
}

export type CodexUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
}

export type CodexItem = {
  id?: string
  type?: string
  text?: string
  command?: string
  aggregated_output?: string
  exit_code?: number | null
  status?: string
  server?: string
  tool?: string
  arguments?: Record<string, unknown> | null
  result?: unknown
  error?: { message?: string } | null
  message?: string
  query?: string
  changes?: Array<{ path: string; kind: string }>
  items?: Array<{ text: string; completed: boolean }>
  approval_id?: string
  approvalId?: string
  reason?: string
  title?: string
  prompt?: string
}

export type ManagedTurnReplay = {
  text: string
  modelId?: string
  reasoningEffort?: string
  attachments?: ChatAttachmentMeta[]
  recoveryCount: number
}

export type CodexStreamEvent = {
  type?: string
  event?: string
  item?: CodexItem
  content?: string
  text?: string
  name?: string
  arguments?: Record<string, unknown>
  input?: Record<string, unknown>
  output?: string
  result?: string
  error?: string | { message?: string }
  message?: string
  reason?: string
  title?: string
  prompt?: string
  usage?: CodexUsage
}

export type JsonRpcMessage = {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message?: string; code?: number }
}

export type CodexThreadStatus = {
  type?: string
  activeFlags?: string[]
}

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export type CodexProject = {
  id?: string
  roots?: Array<{ path?: string }>
}

export type CodexProjectListResponse = {
  data?: CodexProject[]
  nextCursor?: string | null
}

export function selectCodexProjectIdForWorkDir(
  projects: CodexProject[],
  workDir: string,
): string | undefined {
  const normalizedWorkDir = path.resolve(workDir)
  let bestMatch: { id: string; rootLength: number } | undefined

  for (const project of projects) {
    if (!project.id) continue
    for (const root of project.roots ?? []) {
      if (!root.path) continue
      const normalizedRoot = path.resolve(root.path)
      const relative = path.relative(normalizedRoot, normalizedWorkDir)
      const containsWorkDir =
        relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
      if (!containsWorkDir || normalizedRoot.length <= (bestMatch?.rootLength ?? -1)) continue
      bestMatch = { id: project.id, rootLength: normalizedRoot.length }
    }
  }

  return bestMatch?.id
}

export function buildCodexTextInput(
  text: string,
  attachments?: ChatAttachmentMeta[],
): Record<string, unknown> {
  const images = attachments
    ?.flatMap((attachment) => codexLocalImageInputs(attachment))
    .filter((attachment) => !/^https?:\/\//i.test(attachment.path))
    .filter((attachment) => attachment.path)
  const textWithFileAttachments = appendFileAttachmentHints(text, attachments)
  return {
    type: 'text',
    text: textWithFileAttachments,
    text_elements: [],
    ...(images?.length ? { local_images: images } : {}),
  }
}

function codexLocalImageInputs(
  attachment: ChatAttachmentMeta,
): Array<{ path: string; data?: string; mimeType?: string }> {
  if (attachment.kind === 'image') {
    if (attachment.previewData) {
      return [
        { path: attachment.path, data: attachment.previewData, mimeType: attachment.mimeType },
      ]
    }
    return [{ path: attachment.path }]
  }
  if (attachment.mimeType.startsWith('video/')) {
    const previewPath = extractVideoPreviewFrame(attachment.path)
    return previewPath ? [{ path: previewPath }] : []
  }
  return []
}

function extractVideoPreviewFrame(videoPath: string): string | null {
  if (!videoPath || /^https?:\/\//i.test(videoPath)) return null
  const ext = path.extname(videoPath)
  const stem = ext ? videoPath.slice(0, -ext.length) : videoPath
  const previewPath = `${stem}.preview.png`
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-ss', '0', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=320:-1', previewPath],
    { stdio: 'ignore', timeout: 15_000 },
  )
  return result.status === 0 ? previewPath : null
}

function appendFileAttachmentHints(text: string, attachments?: ChatAttachmentMeta[]): string {
  const files = attachments
    ?.filter((attachment) => attachment.kind !== 'image')
    .filter((attachment) => attachment.path && !/^https?:\/\//i.test(attachment.path))
  if (!files?.length) return text
  const alreadyVisible = files.every((attachment) => text.includes(attachment.path))
  if (alreadyVisible) return text
  const lines = files.map((attachment, index) => {
    const label = attachment.name || `attachment-${index + 1}`
    const mime = attachment.mimeType ? ` (${attachment.mimeType})` : ''
    return `[${escapeMarkdownLinkLabel(label)}${mime}](<${attachment.path}>)`
  })
  return [text, '', ...lines].join('\n')
}

export function buildCodexQueuedText(text: string, attachments?: ChatAttachmentMeta[]): string {
  const missing = attachments?.filter(
    (attachment) =>
      attachment.path && !/^https?:\/\//i.test(attachment.path) && !text.includes(attachment.path),
  )
  if (!missing?.length) return text
  const lines = missing.map((attachment, index) => {
    const label = escapeMarkdownLinkLabel(attachment.name || `attachment-${index + 1}`)
    return attachment.kind === 'image'
      ? `![${label}](<${attachment.path}>)`
      : `[${label}](<${attachment.path}>)`
  })
  return [text, '', ...lines].join('\n')
}

export function buildCodexQueueArgs(
  threadId: string,
  text: string,
  attachments?: ChatAttachmentMeta[],
): string[] {
  return ['queue', '--thread', threadId, '--message', buildCodexQueuedText(text, attachments)]
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/[[\]\\]/g, '\\$&')
}
