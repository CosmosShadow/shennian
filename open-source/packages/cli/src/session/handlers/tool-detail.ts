// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-session-tool-detail.test.ts

import {
  isSystemControlPayload,
  SESSION_TOOL_DETAIL_LIMITS,
  type ReqFrame,
  type SessionToolDetailRequest,
  type SessionToolDetailResponse,
  type ToolDetailUnavailableReason,
} from '@shennian/wire'
import type { SessionManagerRuntime } from '../types.js'
import { readToolDetail } from '../tool-detail-store.js'
import { assertPersonalSyncIdentity, getPersonalSyncIdentity } from '../../personal-sync/epoch.js'
import { getDaemonInstallationId } from '../store.js'

const SENSITIVE_KEY_RE = /(?:token|api[-_]?key|password|passwd|pwd|secret|authorization|cookie|credential|private[-_]?key)/i
const SENSITIVE_ASSIGNMENT_RE = /\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD|AUTH)[A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s]+)/gi
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{12,}\b/g

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function clampMaxBytes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return SESSION_TOOL_DETAIL_LIMITS.defaultMaxBytes
  return Math.min(
    Math.max(SESSION_TOOL_DETAIL_LIMITS.minMaxBytes, Math.floor(parsed)),
    SESSION_TOOL_DETAIL_LIMITS.maxMaxBytes,
  )
}

function redactString(value: string, maxChars: number): string {
  if (isSystemControlPayload(value)) return '[SYSTEM CONTEXT REDACTED]'
  const redacted = value
    .replace(SENSITIVE_ASSIGNMENT_RE, '$1=[REDACTED]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(OPENAI_KEY_RE, 'sk-[REDACTED]')
  return redacted.length > maxChars ? `${redacted.slice(0, maxChars)}…` : redacted
}

function sanitizeValue(value: unknown, maxChars: number, depth = 0): unknown {
  if (value == null) return value
  if (typeof value === 'string') return redactString(value, maxChars)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 4) return '[Truncated]'
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, maxChars, depth + 1))
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      output[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitizeValue(raw, maxChars, depth + 1)
    }
    return output
  }
  return String(value)
}

function extractCommand(args: unknown, maxChars: number): string | undefined {
  const raw = asRecord(args)?.command
  if (typeof raw === 'string') return redactString(raw, maxChars)
  if (Array.isArray(raw)) return redactString(raw.map(String).join(' '), maxChars)
  return undefined
}

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function finalizeByteSize(payload: SessionToolDetailResponse): SessionToolDetailResponse {
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = byteSize(payload)
    if (next === payload.byteSize) break
    payload.byteSize = next
  }
  return payload
}

function unavailable(
  request: SessionToolDetailRequest,
  reason: ToolDetailUnavailableReason,
): SessionToolDetailResponse {
  const payload: SessionToolDetailResponse = {
    ...getPersonalSyncIdentity(getDaemonInstallationId()),
    sessionId: request.sessionId,
    toolCallId: request.toolCallId,
    detailRevision: request.detailRevision,
    detailStatus: reason === 'not_found' ? 'not_found' : 'unavailable',
    resultOmitted: true,
    redacted: true,
    byteSize: 0,
    expiresAt: new Date(Date.now() + SESSION_TOOL_DETAIL_LIMITS.responseTtlMs).toISOString(),
    source: 'unavailable',
    reason,
  }
  return finalizeByteSize(payload)
}

export async function handleSessionToolDetail(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const params = req.params as Partial<SessionToolDetailRequest>
  assertPersonalSyncIdentity(params)
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
  const toolCallId = typeof params.toolCallId === 'string' ? params.toolCallId : ''
  const detailRevision = typeof params.detailRevision === 'number' && Number.isSafeInteger(params.detailRevision)
    ? params.detailRevision
    : -1
  if (!sessionId || !toolCallId || detailRevision < 0) {
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: false,
      error: 'upgrade_required: sessionId, toolCallId and detailRevision are required',
    })
    return
  }

  const maxBytes = clampMaxBytes(params.maxBytes)
  const request: SessionToolDetailRequest = {
    ...getPersonalSyncIdentity(getDaemonInstallationId()), sessionId, toolCallId, detailRevision, maxBytes,
  }
  const detail = readToolDetail(sessionId, toolCallId)
  if (!detail) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: unavailable(request, 'not_found') })
    return
  }
  if (detail.detailRevision !== detailRevision) {
    runtime.client.sendRes({
      type: 'res', id: req.id, ok: true, payload: unavailable(request, 'revision_mismatch'),
    })
    return
  }

  const maxChars = Math.max(512, Math.floor(maxBytes / 4))
  const argsSummary = detail.args == null ? undefined : sanitizeValue(detail.args, maxChars)
  const command = extractCommand(detail.args, maxChars)
  const result = typeof detail.result === 'string'
    ? redactString(detail.result, maxChars)
    : detail.result == null
      ? undefined
      : redactString(JSON.stringify(sanitizeValue(detail.result, maxChars)), maxChars)
  const expiresAt = new Date(Date.now() + SESSION_TOOL_DETAIL_LIMITS.responseTtlMs).toISOString()
  let payload: SessionToolDetailResponse = {
    ...getPersonalSyncIdentity(getDaemonInstallationId()),
    sessionId, toolCallId, detailRevision,
    detailStatus: 'available',
    status: detail.status,
    ...(command ? { command } : {}),
    ...(argsSummary !== undefined ? { argsSummary } : {}),
    ...(result !== undefined ? { result } : {}),
    resultOmitted: result === undefined,
    redacted: true,
    byteSize: 0,
    expiresAt,
    source: 'local-tool-index',
  }
  finalizeByteSize(payload)
  if (payload.byteSize > maxBytes) {
    delete payload.result
    payload.resultOmitted = true
    finalizeByteSize(payload)
  }
  if (payload.byteSize > maxBytes) payload = unavailable(request, 'response_too_large')
  runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload })
}
