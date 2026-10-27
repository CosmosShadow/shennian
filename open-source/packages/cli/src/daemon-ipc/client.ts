// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-ipc.test.ts

import crypto from 'node:crypto'
import net from 'node:net'
import type { JsonValue } from './json.js'
import { resolveDaemonIpcPaths, type DaemonIpcPaths } from './paths.js'
import {
  DAEMON_IPC_MAX_REQUEST_BYTES,
  DAEMON_IPC_MAX_RESPONSE_BYTES,
  DAEMON_IPC_VERSION,
  DaemonIpcError,
  type DaemonIpcResponse,
} from './protocol.js'
import { readDaemonIpcSecret } from './secret.js'

export async function callDaemonIpc<T extends JsonValue = JsonValue>(input: {
  method: string
  params?: JsonValue
  paths?: DaemonIpcPaths
  timeoutMs?: number
}): Promise<T> {
  const paths = input.paths ?? resolveDaemonIpcPaths()
  const secret = readDaemonIpcSecret(paths.secretFile)
  const requestId = crypto.randomUUID()
  const payload = `${JSON.stringify({
    version: DAEMON_IPC_VERSION,
    requestId,
    auth: secret,
    method: input.method,
    params: input.params,
  })}\n`
  if (Buffer.byteLength(payload, 'utf8') > DAEMON_IPC_MAX_REQUEST_BYTES) {
    throw new DaemonIpcError('request_too_large', 'Daemon IPC request is too large.')
  }

  const response = await new Promise<DaemonIpcResponse>((resolve, reject) => {
    const socket = net.createConnection(paths.endpoint)
    let received = ''
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new DaemonIpcError('ipc_timeout', 'Shennian daemon did not respond.'))
    }, input.timeoutMs ?? 5_000)
    const finish = (fn: () => void) => {
      clearTimeout(timeout)
      socket.destroy()
      fn()
    }
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(payload))
    socket.on('data', (chunk: string) => {
      received += chunk
      if (Buffer.byteLength(received, 'utf8') > DAEMON_IPC_MAX_RESPONSE_BYTES) {
        finish(() => reject(new DaemonIpcError('response_too_large', 'Daemon IPC response is too large.')))
        return
      }
      const newline = received.indexOf('\n')
      if (newline < 0) return
      finish(() => {
        try {
          resolve(JSON.parse(received.slice(0, newline)) as DaemonIpcResponse)
        } catch {
          reject(new DaemonIpcError('invalid_response', 'Daemon IPC response is invalid.'))
        }
      })
    })
    socket.once('error', (error: NodeJS.ErrnoException) => finish(() => reject(classifyDaemonIpcConnectError(error))))
  })

  if (response.requestId !== requestId || response.version !== DAEMON_IPC_VERSION) {
    throw new DaemonIpcError('response_mismatch', 'Daemon IPC response did not match the request.')
  }
  if (!response.ok) throw new DaemonIpcError(response.error.code, response.error.message)
  return response.result as T
}

export function classifyDaemonIpcConnectError(error: NodeJS.ErrnoException): DaemonIpcError {
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return new DaemonIpcError('ipc_access_denied', 'This user cannot access the Shennian daemon IPC endpoint.')
  }
  if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
    return new DaemonIpcError('daemon_unavailable', 'Shennian daemon IPC endpoint is unavailable.')
  }
  return new DaemonIpcError('ipc_connection_failed', 'Could not connect to the Shennian daemon IPC endpoint.')
}
