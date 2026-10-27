// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-ipc-health.test.ts

import { callDaemonIpc } from '../daemon-ipc/client.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'

export type DaemonIpcHealth =
  | { state: 'not_running' | 'ready' }
  | { state: 'unsupported' | 'unavailable'; error: string }

/** A PID and pairing record do not prove that the daemon's local control path works. */
export async function checkDaemonIpcHealth(
  running: boolean,
  call: typeof callDaemonIpc = callDaemonIpc,
): Promise<DaemonIpcHealth> {
  if (!running) return { state: 'not_running' }
  try {
    await call({ method: 'protocol.info', timeoutMs: 2_000 })
    return { state: 'ready' }
  } catch (error) {
    const code = error instanceof DaemonIpcError ? error.code
      : error && typeof error === 'object' && 'code' in error &&
          (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM')
        ? error.code === 'ENOENT' ? 'ipc_secret_missing' : 'ipc_access_denied'
        : 'ipc_check_failed'
    return { state: code === 'method_not_found' ? 'unsupported' : 'unavailable', error: code }
  }
}
