// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-claude-parser.test.ts

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { buildUserMessagePayload, type ChatAttachmentMeta } from '@shennian/wire'
import { resolveShennianPath } from '../config/index.js'
import {
  buildToolPayload,
  makeCursor,
  makeEventKey,
  normalizeText,
} from './parser-common.js'
import type { ParsedNativeEvent } from './types.js'

export type ClaudeEntryContext = {
  filePath: string
  lineOffset: number
  sourceSessionKey: string
  ts: number
  workDir: string
}

/** Mutable per-file state: the first visible user text becomes the fallback title. */
export type ClaudeTitleState = { value: string }

type JsonObject = Record<string, unknown>

const MAX_TOOL_RESULT_CHARS = 64 * 1024
const INLINE_ATTACHMENT_EXTENSIONS: Record<string, { ext: string; kind: 'image' | 'file' }> = {
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
  'application/pdf': { ext: 'pdf', kind: 'file' },
}
/** Claude wraps machine-generated turns in these tags; the whole text is never a human message. */
const HIDDEN_USER_TEXT_TAGS = [
  'local-command-caveat',
  'local-command-stdout',
  'local-command-stderr',
  'bash-stdout',
  'bash-stderr',
  'task-notification',
  'system-reminder',
]

/**
 * Map one Claude transcript line to product-visible events: human user turns
 * (text and inline images, including mid-turn queued input), assistant text,
 * and tool call/result pairs. Reasoning and machine bookkeeping stay local.
 */
export function parseClaudeEntry(
  entry: JsonObject,
  ctx: ClaudeEntryContext,
  title: ClaudeTitleState,
): ParsedNativeEvent[] {
  // Sidechain entries are subagent work, never part of the user's conversation.
  if (entry.isSidechain === true) return []
  if (entry.type === 'user') return parseUserEntry(entry, ctx, title)
  if (entry.type === 'assistant') return parseAssistantEntry(entry, ctx, title)
  if (entry.type === 'attachment') return parseQueuedCommand(entry, ctx, title)
  return []
}

function parseUserEntry(
  entry: JsonObject,
  ctx: ClaudeEntryContext,
  title: ClaudeTitleState,
): ParsedNativeEvent[] {
  // Meta turns are harness-injected context (caveats, skill re-invocations,
  // "continue" nudges); compact summaries replace history the user already saw.
  if (entry.isMeta === true || entry.isCompactSummary === true) return []
  const content = record(entry.message)?.content
  const events: ParsedNativeEvent[] = []
  if (Array.isArray(content)) {
    for (const block of content) {
      const item = record(block)
      if (item?.type === 'tool_result') {
        const event = buildToolResultEvent(item, ctx, title)
        if (event) events.push(event)
      }
    }
  }
  const userEvent = buildUserEvent(content, ctx, title, 'user')
  if (userEvent) events.push(userEvent)
  return events
}

/**
 * A message typed while the agent is still running is not written as a `user`
 * line; Claude records it as a `queued_command` attachment with a human origin.
 * Task notifications and other machine-queued commands are skipped.
 */
function parseQueuedCommand(
  entry: JsonObject,
  ctx: ClaudeEntryContext,
  title: ClaudeTitleState,
): ParsedNativeEvent[] {
  const attachment = record(entry.attachment)
  if (attachment?.type !== 'queued_command') return []
  const origin = record(attachment.origin)
  const human = origin ? origin.kind === 'human' : attachment.commandMode === 'prompt'
  if (!human) return []
  const event = buildUserEvent(attachment.prompt, ctx, title, 'queued_user')
  return event ? [event] : []
}

function buildUserEvent(
  content: unknown,
  ctx: ClaudeEntryContext,
  title: ClaudeTitleState,
  kind: string,
): ParsedNativeEvent | null {
  const texts: string[] = []
  const attachments: ChatAttachmentMeta[] = []
  const blocks = Array.isArray(content) ? content : [content]
  for (const block of blocks) {
    if (typeof block === 'string') {
      texts.push(block)
      continue
    }
    const item = record(block)
    if (!item) continue
    if (item.type === 'text' && typeof item.text === 'string') {
      texts.push(item.text)
    } else if (item.type === 'image' || item.type === 'document') {
      const attachment = materializeInlineAttachment(item, ctx.sourceSessionKey)
      if (attachment) attachments.push(attachment)
    }
  }
  const text = normalizeText(
    texts.map(cleanUserText).filter(Boolean).join('\n\n'),
  )
  if (!text && attachments.length === 0) return null
  if (!title.value && text) title.value = text.slice(0, 80)
  return {
    ...baseEvent(ctx, kind, title, 'user'),
    payload: attachments.length ? buildUserMessagePayload(text, attachments) : text,
  }
}

function parseAssistantEntry(
  entry: JsonObject,
  ctx: ClaudeEntryContext,
  title: ClaudeTitleState,
): ParsedNativeEvent[] {
  const message = record(entry.message)
  const modelId = typeof message?.model === 'string' ? message.model : null
  const content = typeof message?.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : Array.isArray(message?.content) ? message.content : []
  const events: ParsedNativeEvent[] = []
  let pendingTexts: string[] = []
  let textCount = 0

  const flushText = () => {
    const text = normalizeText(pendingTexts.join('\n\n'))
    pendingTexts = []
    if (!text) return
    // The first text keeps the legacy `assistant` key so already-ledgered
    // events dedupe across a parser upgrade.
    const kind = textCount === 0 ? 'assistant' : `assistant:${textCount}`
    textCount += 1
    events.push({ ...baseEvent(ctx, kind, title, 'agent'), payload: text, modelId })
  }

  for (const block of content) {
    const item = record(block)
    if (!item) continue
    if ((item.type === 'text' || item.type === undefined) && typeof item.text === 'string') {
      pendingTexts.push(item.text)
    } else if (item.type === 'tool_use') {
      flushText()
      events.push(buildToolUseEvent(item, ctx, title, modelId))
    }
  }
  flushText()
  return events
}

function buildToolUseEvent(
  block: JsonObject,
  ctx: ClaudeEntryContext,
  title: ClaudeTitleState,
  modelId: string | null,
): ParsedNativeEvent {
  const toolUseId = typeof block.id === 'string' && block.id.trim() ? block.id.trim() : ''
  const name = typeof block.name === 'string' && block.name ? block.name : 'tool'
  const event = baseEvent(ctx, `tool_use:${toolUseId || 'anonymous'}`, title, 'agent')
  const identity = toolIdentity(ctx.sourceSessionKey, toolUseId, event.sourceEventKey)
  return {
    ...event,
    payload: buildToolPayload({
      name,
      toolCallId: identity.toolCallId,
      detailRevision: 1,
      status: 'running',
    }),
    modelId,
    ...(identity.canonicalMessageKey
      ? { canonicalMessageKey: identity.canonicalMessageKey, canonicalMutation: 'append' as const }
      : {}),
    localToolDetail: {
      toolCallId: identity.toolCallId,
      detailRevision: 1,
      name,
      ...(block.input !== undefined ? { args: block.input } : {}),
      status: 'running',
    },
  }
}

function buildToolResultEvent(
  block: JsonObject,
  ctx: ClaudeEntryContext,
  title: ClaudeTitleState,
): ParsedNativeEvent | null {
  const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id.trim() : ''
  // Without the call identity the result cannot be folded into its tool card.
  if (!toolUseId) return null
  const status = block.is_error === true ? 'failed' as const : 'completed' as const
  // A `*_result` name lets the repository keep the original tool name when it
  // merges this completion into the running card.
  const name = 'tool_result'
  const event = baseEvent(ctx, `tool_result:${toolUseId}`, title, 'agent')
  const identity = toolIdentity(ctx.sourceSessionKey, toolUseId, event.sourceEventKey)
  return {
    ...event,
    payload: buildToolPayload({
      name,
      toolCallId: identity.toolCallId,
      detailRevision: 2,
      status,
    }),
    canonicalMessageKey: identity.canonicalMessageKey,
    canonicalMutation: 'upsert',
    localToolDetail: {
      toolCallId: identity.toolCallId,
      detailRevision: 2,
      name,
      result: toolResultText(block.content),
      status,
    },
  }
}

function toolIdentity(
  sourceSessionKey: string,
  toolUseId: string,
  sourceEventKey: string,
): { toolCallId: string; canonicalMessageKey?: string } {
  if (!toolUseId) return { toolCallId: `native:${sourceEventKey}` }
  const digest = createHash('sha256')
    .update(`${sourceSessionKey}\0${toolUseId}`)
    .digest('hex')
    .slice(0, 32)
  return { toolCallId: `native:tool:${digest}`, canonicalMessageKey: `tool:${digest}` }
}

function toolResultText(content: unknown): string {
  let text: string
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => {
        if (typeof part === 'string') return part
        const item = record(part)
        if (!item) return ''
        if (typeof item.text === 'string') return item.text
        return item.type === 'image' ? '[image]' : ''
      })
      .filter(Boolean)
      .join('\n')
  } else {
    text = ''
  }
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`
    : text
}

function cleanUserText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('[Request interrupted by user')) return ''
  for (const tag of HIDDEN_USER_TEXT_TAGS) {
    if (trimmed.startsWith(`<${tag}>`) || trimmed.startsWith(`<${tag} `)) return ''
  }
  if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<command-message>')) {
    const name = trimmed.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]?.trim() ?? ''
    if (!name) return ''
    const args = trimmed.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? ''
    return args ? `${name} ${args}` : name
  }
  return text
}

/**
 * Claude keeps pasted images inline as base64, so there is no source file for
 * the phone to preview. Materialize each one as a machine-local file and
 * reference it like any other native attachment. The write is idempotent per
 * content hash; a failed write throws so the source cursor does not advance
 * past an image that was never stored.
 */
function materializeInlineAttachment(
  block: JsonObject,
  sourceSessionKey: string,
): ChatAttachmentMeta | null {
  const source = record(block.source)
  if (source?.type !== 'base64') return null
  const mimeType = typeof source.media_type === 'string' ? source.media_type.toLowerCase() : ''
  const data = typeof source.data === 'string' ? source.data : ''
  const format = INLINE_ATTACHMENT_EXTENSIONS[mimeType]
  if (!format || !data) return null
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0) return null
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const directory = resolveShennianPath(
    'native-attachments',
    'claude',
    sourceSessionKey.replace(/[^A-Za-z0-9._-]/g, '_'),
  )
  const filePath = path.join(directory, `${sha256}.${format.ext}`)
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temp = `${filePath}.tmp-${process.pid}`
    fs.writeFileSync(temp, bytes, { mode: 0o600 })
    renameSyncWithRetry(temp, filePath)
  }
  return {
    path: filePath,
    name: `${format.kind === 'image' ? 'image' : 'document'}-${sha256.slice(0, 8)}.${format.ext}`,
    mimeType,
    kind: format.kind,
    byteSize: bytes.length,
    sha256,
  }
}

function baseEvent(
  ctx: ClaudeEntryContext,
  kind: string,
  title: ClaudeTitleState,
  role: 'user' | 'agent',
): ParsedNativeEvent {
  return {
    agentType: 'claude',
    sourceMode: 'claude_transcript_import',
    sourceSessionKey: ctx.sourceSessionKey,
    sourceEventKey: makeEventKey(ctx.filePath, ctx.lineOffset, kind),
    cursor: makeCursor(ctx.filePath, ctx.lineOffset),
    role,
    ts: ctx.ts,
    payload: '',
    title: title.value,
    titleSource: 'first_user_fallback',
    workDir: ctx.workDir,
  }
}

function record(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null
}
