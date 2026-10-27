// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test packages/app/src/__tests__/voice-account-client.test.ts
import type { VoiceAccountClient, VoiceDraftResponse } from './voiceAccountClient.types'
export type { VoiceDraftResponse } from './voiceAccountClient.types'
type Operation = 'voice.text.finalize'
type Result = { ok: true; value: unknown } | { ok: false; error: {
  code: string; message: string; retryable: boolean; action?: 'retry' | 'sign_in'
} }
type Root = typeof globalThis & { shennianDesktop?: { account?: {
  execute(command: { requestId: string; operation: Operation; input: object }): Promise<Result>
} } }
let sequence = 0
export class DesktopVoiceAccountError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false,
    readonly action?: 'retry' | 'sign_in') {
    super(message)
    this.name = 'DesktopVoiceAccountError'
  }
}
export const voiceAccountClient: VoiceAccountClient = {
  async finalizeText(input) {
    return requireDraft(await execute('voice.text.finalize', input))
  },
}
async function execute(operation: Operation, input: object): Promise<unknown> {
  const bridge = (globalThis as Root).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopVoiceAccountError('BRIDGE_UNAVAILABLE', 'Desktop Voice account bridge is unavailable.')
  }
  const result = await bridge.execute({ requestId: `voice-account-${Date.now()}-${++sequence}`, operation, input })
  if (result.ok) return result.value
  throw new DesktopVoiceAccountError(result.error.code, result.error.message, result.error.retryable, result.error.action)
}
function requireDraft(value: unknown): VoiceDraftResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOutput()
  const record = value as Record<string, unknown>
  if (typeof record.transcript !== 'string' || typeof record.draft !== 'string'
    || typeof record.model !== 'string'
    || !['new', 'append', 'edit', 'clarify'].includes(String(record.intent))) throw invalidOutput()
  return record as VoiceDraftResponse
}
function invalidOutput(): DesktopVoiceAccountError {
  return new DesktopVoiceAccountError('INVALID_OUTPUT', 'Desktop Voice response is invalid.')
}
