// @arch open-source/docs/cli-runtime.md
// @test ../../__tests__/voice-window.test.ts

import {
  extractPayloadText,
  isAgentHiddenPayload,
  isSystemControlPayload,
  isToolPayload,
  type Envelope,
  type ReqFrame,
  type VoiceSessionBodyWindowParams,
} from '@shennian/wire'
import { getCanonicalSessionStore, getDaemonInstallationId } from '../store.js'
import type { SessionManagerRuntime } from '../types.js'
import { assertPersonalSyncIdentity, getPersonalSyncIdentity } from '../../personal-sync/epoch.js'

const MAX_MESSAGES = 8
const MAX_BYTES = 32 * 1024

export function handleVoiceSessionBodyWindow(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): void {
  const params = req.params as VoiceSessionBodyWindowParams
  assertPersonalSyncIdentity(params)
  if (!params?.sessionId?.trim() || !params.callId?.trim()) {
    throw new Error('sessionId and callId are required')
  }

  const limit = boundedInteger(params.limit, 4, MAX_MESSAGES)
  const maxBytes = boundedInteger(params.maxBytes, MAX_BYTES, MAX_BYTES)
  const page = getCanonicalSessionStore().readRecent(params.sessionId, Math.min(limit * 6, 48))
  const visible = page.messages.filter(isVoiceReadableMessage)
  const selected: Envelope[] = []
  let bytes = 0
  for (let index = visible.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const message = visible[index]
    const size = Buffer.byteLength(JSON.stringify(message), 'utf8')
    if (selected.length > 0 && bytes + size > maxBytes) break
    if (size > maxBytes) continue
    selected.push(message)
    bytes += size
  }
  selected.reverse()

  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: {
      ...getPersonalSyncIdentity(getDaemonInstallationId()),
      sessionId: params.sessionId,
      callId: params.callId,
      bodyRevision: page.bodyRevision,
      messages: selected,
      truncated: page.hasOlder || selected.length < visible.length,
    },
  })
}

function isVoiceReadableMessage(message: Envelope): boolean {
  if (message.role !== 'user' && message.role !== 'agent') return false
  if (isToolPayload(message.payload)) return false
  if (isSystemControlPayload(message.payload)) return false
  if (isAgentHiddenPayload(message.payload)) return false
  return extractPayloadText(message.payload).trim().length > 0
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid voice window limit')
  return Math.min(value, max)
}
