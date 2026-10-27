// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-stop-ipc.test.ts

import { callDaemonIpc } from '../daemon-ipc/client.js'
import type { JsonValue } from '../daemon-ipc/json.js'

type ShutdownReply = { accepted?: unknown; pid?: unknown }
type ShutdownCall = (input: { method: string; params?: JsonValue; timeoutMs?: number }) => Promise<JsonValue>

/** Use the authenticated local control channel when S4U denies cross-session signals. */
export async function requestWindowsDaemonSelfStop(
  expectedPid: number,
  call: ShutdownCall = callDaemonIpc,
): Promise<{ accepted: true } | { accepted: false; error: string }> {
  if (!Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    return { accepted: false, error: 'daemon_instance_mismatch' }
  }
  try {
    const reply = await call({
      method: 'daemon.shutdown',
      params: { expectedPid } as JsonValue,
      timeoutMs: 3_000,
    }) as ShutdownReply
    if (reply?.accepted !== true || reply.pid !== expectedPid) {
      return { accepted: false, error: 'daemon_instance_mismatch' }
    }
    return { accepted: true }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code === 'ipc_access_denied' || code === 'method_not_found') {
      return { accepted: false, error: 'legacy_s4u_migration_required' }
    }
    if (code === 'unauthorized') return { accepted: false, error: 'daemon_shutdown_unauthorized' }
    if (code === 'daemon_unavailable') return { accepted: false, error: 'daemon_shutdown_ipc_unavailable' }
    return { accepted: false, error: 'daemon_shutdown_ipc_failed' }
  }
}
