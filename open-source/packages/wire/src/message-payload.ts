// @arch open-source/docs/wire.md
// @test open-source/packages/wire/src/__tests__/message-payload.test.ts

export type ChatAttachmentKind = 'image' | 'file' | 'folder'

export type ChatAttachmentMeta = {
  path: string
  name: string
  mimeType: string
  kind: ChatAttachmentKind
  byteSize?: number
  sha256?: string
  previewData?: string
}

export type StructuredUserMessagePayload = {
  v: 1
  type: 'user'
  content: string
  attachments?: ChatAttachmentMeta[]
}

type StructuredPayload =
  | StructuredUserMessagePayload
  | ApprovalPendingPayload
  | ChannelDeliveryStatusPayload
  | {
      v: 1
      type?: string
      content?: string
      text?: string
      thinking?: string
    }

const GIT_DIRECTIVE_LINE_RE = /^\s*::git-[a-z-]+\{[^\n]*\}\s*$/gm
const TOOL_PAYLOAD_PREFIX_RE = /^\s*\{\s*"v"\s*:\s*1\s*,\s*"type"\s*:\s*"(tool|tool_use|tool_result)"/
const ENVIRONMENT_CONTEXT_RE = /^\s*<environment_context>\s*[^]*?<\/environment_context>\s*$/i
const ENVIRONMENT_CONTEXT_REQUIRED_TAG_RE = /<(cwd|shell|current_date|timezone)>[^<]*<\/\1>/gi
const CODEX_RECOMMENDED_PLUGINS_PREFIX_RE = /^\s*<recommended_plugins>[^]*?<\/recommended_plugins>\s*/i
const CODEX_TURN_ABORTED_RE = /^\s*<turn_aborted>[^]*?<\/turn_aborted>\s*$/i
const CODEX_INTERNAL_CONTEXT_RE = /^\s*<codex_internal_context\b[^>]*>[^]*?<\/codex_internal_context>\s*$/i
const CODEX_APPS_OPEN_PAGE_CONTEXT_RE = /^\s*<external_codex_apps_open_page>[^]*?<\/external_codex_apps_open_page>\s*$/i
const CODEX_PROJECT_INSTRUCTIONS_RE = /^\s*# AGENTS\.md instructions for [^\n]+\n+\s*<INSTRUCTIONS>\s*[^]*?<\/INSTRUCTIONS>\s*(?:<environment_context>[^]*?<\/environment_context>)?\s*$/i
const APPROVAL_PENDING_PAYLOAD_PREFIX_RE = /^\s*\{\s*"v"\s*:\s*1\s*,\s*"type"\s*:\s*"approval_pending"/
const PREVIEW_PRIVATE_CONTEXT_RE = /(?:<\/?(?:environment_context|instructions|system|developer|codex_internal_context|recommended_plugins|external_codex_apps_open_page)\b|#\s*AGENTS\.md instructions\b)/i
const PREVIEW_DATA_URL_RE = /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/i
const PREVIEW_BASE64_BLOB_RE = /(?:^|\s)(?=[A-Za-z0-9+/]{80,}={0,2}(?=\s|$))(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{80,}={0,2}(?=\s|$)/
const PREVIEW_HIDDEN_TYPES = new Set([
  'tool',
  'tool_use',
  'tool_result',
  'thinking',
  'system',
  'developer',
  'context',
  'environment_context',
  'channel_delivery_status',
])

export type ApprovalPendingPayload = {
  v: 1
  type: 'approval_pending'
  title: string
  content: string
  source?: string
  actionHint?: string
  permission?: import('./events.ts').AcpPermissionPrompt
}

/**
 * A message the Shennian steward deliberately addressed to the user. Only these
 * (and the user's own messages) are shown in the steward conversation; the
 * agent's free text and tool activity stay in the local transcript.
 * `fallback` marks the last output shown because the run never called `say`.
 */
export type StewardSayPayload = {
  v: 1
  type: 'steward_say'
  content: string
  source: 'say' | 'fallback'
  worker?: { id: string; title: string; scheduleId?: string; state: string }
}

/**
 * Id prefix of the one opening line the daemon writes into the terminal-origin steward
 * conversation so the server accepts it. It is a bookkeeping artifact, not something the
 * user said, so clients filter any message whose id starts with this out of the timeline.
 */
export const STEWARD_TERMINAL_OPEN_MESSAGE_ID_PREFIX = 'steward-terminal-open-'

/**
 * Id prefix of the user message the daemon re-queues into the new conversation when it moves the
 * steward to another AI tool. The user already sent it once (in the conversation being left), so
 * clients hide this copy instead of showing the same bubble twice.
 */
export const STEWARD_FAILOVER_USER_MESSAGE_ID_PREFIX = 'steward-failover-user-'

export type ChannelDeliveryStatusPayload = {
  v: 1
  type: 'channel_delivery_status'
  content: string
  channel: 'wechat'
  status: string
  agentVisible: false
  replyId?: string
  idempotencyKey?: string
  bindingId?: string
  reasonCode?: string
  copyText?: string
  copyableContentRef?: string
  errorSummary?: string
}

function escapeMarkdownLabel(label: string): string {
  return label.replace(/[[\]\\]/g, '\\$&')
}

function buildAttachmentRef(attachment: ChatAttachmentMeta): string {
  const label = escapeMarkdownLabel(attachment.name)
  return attachment.kind === 'image'
    ? `![${label}](<${attachment.path}>)`
    : `[${label}](<${attachment.path}>)`
}

function stripAttachmentRefs(content: string, attachments?: ChatAttachmentMeta[]): string {
  if (!attachments?.length) return content
  const refs = new Set(attachments.map(buildAttachmentRef))
  const lines = content
    .split('\n')
    .filter((line) => !refs.has(line.trim()))
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function parseObjectPayload(payload: string): Record<string, unknown> | null {
  if (!payload || payload[0] !== '{') return null
  try {
    const parsed = JSON.parse(payload) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return null
}

function parseAttachmentMeta(value: unknown): ChatAttachmentMeta | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  const path = typeof entry.path === 'string' ? entry.path : ''
  const name = typeof entry.name === 'string' ? entry.name : ''
  const mimeType = typeof entry.mimeType === 'string' ? entry.mimeType : ''
  const kind =
    entry.kind === 'image' || entry.kind === 'file' || entry.kind === 'folder'
      ? entry.kind
      : null
  if (!path || !name || !mimeType || !kind) return null
  const previewData = typeof entry.previewData === 'string' && entry.previewData.trim() ? entry.previewData.trim() : undefined
  const byteSize = typeof entry.byteSize === 'number' && Number.isSafeInteger(entry.byteSize) && entry.byteSize >= 0
    ? entry.byteSize
    : undefined
  const sha256 = typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(entry.sha256)
    ? entry.sha256.toLowerCase()
    : undefined
  return {
    path,
    name,
    mimeType,
    kind,
    ...(byteSize !== undefined ? { byteSize } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(previewData ? { previewData } : {}),
  }
}

export function parseStructuredMessagePayload(payload: string): StructuredPayload | null {
  const parsed = parseObjectPayload(payload)
  if (!parsed) return null
  if (parsed.v !== 1) return null

  if (parsed.type === 'user' && typeof parsed.content === 'string') {
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments
          .map(parseAttachmentMeta)
          .filter((item): item is ChatAttachmentMeta => item != null)
      : undefined
    return {
      v: 1,
      type: 'user',
      content: parsed.content,
      ...(attachments?.length ? { attachments } : {}),
    }
  }

  return parsed as StructuredPayload
}

export function parseUserMessagePayload(payload: string): StructuredUserMessagePayload | null {
  const parsed = parseStructuredMessagePayload(payload)
  return parsed?.type === 'user' ? (parsed as StructuredUserMessagePayload) : null
}

export function buildUserMessagePayload(
  content: string,
  attachments?: ChatAttachmentMeta[],
): string {
  if (!attachments?.length) return content
  return JSON.stringify({
    v: 1,
    type: 'user',
    content,
    attachments,
  } satisfies StructuredUserMessagePayload)
}

export function isToolPayload(payload: string): boolean {
  if (TOOL_PAYLOAD_PREFIX_RE.test(payload)) return true
  const parsed = parseStructuredMessagePayload(payload)
  if (!parsed || typeof parsed !== 'object') return false
  return (
    parsed.type === 'tool' ||
    parsed.type === 'tool_use' ||
    parsed.type === 'tool_result'
  )
}

export function isApprovalPendingPayload(payload: string): boolean {
  if (APPROVAL_PENDING_PAYLOAD_PREFIX_RE.test(payload)) return true
  const parsed = parseStructuredMessagePayload(payload)
  return parsed?.type === 'approval_pending'
}

export function buildStewardSayPayload(
  content: string,
  source: StewardSayPayload['source'] = 'say',
  worker?: StewardSayPayload['worker'],
): string {
  return JSON.stringify({ v: 1, type: 'steward_say', content, source, ...(worker ? { worker } : {}) } satisfies StewardSayPayload)
}

export function parseStewardSayPayload(payload: string): StewardSayPayload | null {
  const parsed = parseStructuredMessagePayload(payload)
  if (!parsed || parsed.type !== 'steward_say') return null
  const record = parsed as Record<string, unknown>
  if (typeof record.content !== 'string' || !record.content.trim()) return null
  return {
    v: 1,
    type: 'steward_say',
    content: record.content,
    source: record.source === 'fallback' ? 'fallback' : 'say',
    ...(validWorkerSource(record.worker) ? { worker: record.worker } : {}),
  }
}

function validWorkerSource(value: unknown): value is NonNullable<StewardSayPayload['worker']> {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && v.id.length <= 191 && typeof v.title === 'string' && v.title.length <= 500
    && typeof v.state === 'string' && v.state.length <= 64 && (v.scheduleId === undefined || typeof v.scheduleId === 'string' && v.scheduleId.length <= 191)
}

export function isAgentHiddenPayload(payload: string): boolean {
  return parseChannelDeliveryStatusPayload(payload)?.agentVisible === false
}

export function parseChannelDeliveryStatusPayload(payload: string): ChannelDeliveryStatusPayload | null {
  const parsed = parseStructuredMessagePayload(payload)
  if (!parsed || parsed.type !== 'channel_delivery_status') return null
  const record = parsed as Record<string, unknown>
  if (record.v !== 1) return null
  if (record.channel !== 'wechat') return null
  if (record.agentVisible !== false) return null
  const status = typeof record.status === 'string' && record.status.trim() ? record.status.trim() : ''
  if (!status) return null
  const content = typeof record.content === 'string' && record.content.trim()
    ? record.content
    : status === 'manual_review'
      ? '发送状态不确定，请检查微信'
      : '未能自动发送到微信'
  return {
    v: 1,
    type: 'channel_delivery_status',
    channel: 'wechat',
    status,
    agentVisible: false,
    content,
    replyId: stringOrUndefined(record.replyId),
    idempotencyKey: stringOrUndefined(record.idempotencyKey),
    bindingId: stringOrUndefined(record.bindingId),
    reasonCode: stringOrUndefined(record.reasonCode),
    copyText: stringOrUndefined(record.copyText),
    copyableContentRef: stringOrUndefined(record.copyableContentRef),
    errorSummary: stringOrUndefined(record.errorSummary),
  }
}

function approvalFallbackContent(source?: string): string {
  const name = source?.trim()
  const label = !name || name === 'codex' ? 'Codex' : name === 'workbuddy' ? 'WorkBuddy' : name
  return `${label} 正在等待用户确认后继续。`
}

export function buildApprovalPendingPayload(input?: Partial<ApprovalPendingPayload>): string {
  return JSON.stringify({
    v: 1,
    type: 'approval_pending',
    title: input?.title?.trim() || '需要用户确认',
    content: input?.content?.trim() || approvalFallbackContent(input?.source),
    source: input?.source?.trim() || 'codex',
    actionHint: input?.permission
      ? input?.actionHint?.trim()
      : input?.actionHint?.trim() || '当前神念暂不支持远程确认，请回到运行 Codex 的电脑/终端完成确认。',
    ...(input?.permission ? { permission: input.permission } : {}),
  } satisfies ApprovalPendingPayload)
}

export function isSystemEnvironmentContextPayload(payload: string): boolean {
  if (!ENVIRONMENT_CONTEXT_RE.test(payload)) return false
  const found = new Set<string>()
  for (const match of payload.matchAll(ENVIRONMENT_CONTEXT_REQUIRED_TAG_RE)) {
    if (match[1]) found.add(match[1].toLowerCase())
  }
  if (found.has('current_date') && found.has('timezone') && payload.includes('<workspace_roots>')) {
    return true
  }
  return found.has('cwd') && found.has('shell') && found.has('current_date') && found.has('timezone')
}

export function isCodexTurnAbortedPayload(payload: string): boolean {
  return CODEX_TURN_ABORTED_RE.test(payload)
}

export function isCodexProjectInstructionsPayload(payload: string): boolean {
  return CODEX_PROJECT_INSTRUCTIONS_RE.test(payload)
}

export function isSystemControlPayload(payload: string): boolean {
  // Codex can inject the catalog alone or before environment/project metadata.
  // Consume only a complete prefix and require the entire remainder to be control
  // context, so discussions, code samples and appended user requests stay visible.
  const plugins = payload.match(CODEX_RECOMMENDED_PLUGINS_PREFIX_RE)
  if (plugins) {
    const remainder = payload.slice(plugins[0].length).trim()
    return !remainder || isSystemEnvironmentContextPayload(remainder) ||
      isCodexProjectInstructionsPayload(remainder)
  }
  return (
    isSystemEnvironmentContextPayload(payload) ||
    isCodexTurnAbortedPayload(payload) ||
    CODEX_INTERNAL_CONTEXT_RE.test(payload) ||
    CODEX_APPS_OPEN_PAGE_CONTEXT_RE.test(payload) ||
    isCodexProjectInstructionsPayload(payload)
  )
}

export function stripGitDirectiveArtifacts(text: string): string {
  if (!text) return ''

  const normalized = text.replace(/\r\n/g, '\n')
  const hadDirective = /(^|\n)\s*::git-[a-z-]+\{[^\n]*\}\s*(?=\n|$)/.test(normalized)
  if (!hadDirective) return normalized
  const stripped = normalized.replace(GIT_DIRECTIVE_LINE_RE, '')

  if (!stripped.trim()) return ''
  return stripped.replace(/[ \t]+\n/g, '\n').replace(/\n+$/g, '')
}

export function extractPayloadText(payload: string): string {
  if (!payload) return ''

  const parsedUser = parseUserMessagePayload(payload)
  if (parsedUser) {
    return stripAttachmentRefs(parsedUser.content, parsedUser.attachments)
  }

  const parsed = parseStructuredMessagePayload(payload)
  if (parsed) {
    if (typeof parsed.content === 'string') return stripGitDirectiveArtifacts(parsed.content)
    if ('text' in parsed && typeof parsed.text === 'string') return stripGitDirectiveArtifacts(parsed.text)
  }

  try {
    const parsedJson = JSON.parse(payload) as unknown
    if (typeof parsedJson === 'string') return parsedJson
    if (typeof parsedJson === 'object' && parsedJson !== null) {
      const record = parsedJson as Record<string, unknown>
      if (typeof record.content === 'string') return stripGitDirectiveArtifacts(record.content)
      if (typeof record.text === 'string') return stripGitDirectiveArtifacts(record.text)
    }
  } catch {
    // fall through
  }

  return stripGitDirectiveArtifacts(payload)
}

/**
 * Converts already-readable text into the only form allowed in the replicated
 * personal-session index. A preview is content, not an opaque transport field:
 * private control context and binary payloads are therefore rejected instead
 * of being truncated into something that still leaks them.
 */
export function sanitizeSessionPreview(
  value: string | null | undefined,
  maxLength = 160,
): string | null {
  if (typeof value !== 'string' || !Number.isSafeInteger(maxLength) || maxLength < 1) return null
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (!normalized) return null
  if (
    PREVIEW_PRIVATE_CONTEXT_RE.test(normalized) ||
    PREVIEW_DATA_URL_RE.test(normalized) ||
    PREVIEW_BASE64_BLOB_RE.test(normalized) ||
    parseObjectPayload(normalized)
  ) return null
  const oneLine = normalized.replace(/\s+/g, ' ')
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}…` : oneLine
}

/** Extracts a safe, bounded preview from an envelope payload. */
export function sessionPreviewFromPayload(
  payload: string,
  maxLength = 160,
): string | null {
  if (!payload || isToolPayload(payload) || isSystemControlPayload(payload)) return null
  if (isApprovalPendingPayload(payload)) return sanitizeSessionPreview('需要用户确认', maxLength)

  const structured = parseStructuredMessagePayload(payload)
  if (structured) {
    const type = typeof structured.type === 'string' ? structured.type.toLowerCase() : ''
    if (!type || PREVIEW_HIDDEN_TYPES.has(type)) return null
    return sanitizeSessionPreview(extractPayloadText(payload), maxLength)
  }

  // JSON objects that are not a known structured message can contain raw tool
  // arguments/results. Never guess which property is safe for an index preview.
  if (parseObjectPayload(payload)) return null
  return sanitizeSessionPreview(extractPayloadText(payload), maxLength)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
