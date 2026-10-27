// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-ipc.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import type { JsonValue } from './json.js'
import { resolveDaemonIpcPaths, type DaemonIpcPaths } from './paths.js'
import {
  DAEMON_IPC_MAX_REQUEST_BYTES,
  DAEMON_IPC_MAX_RESPONSE_BYTES,
  DAEMON_IPC_VERSION,
  DaemonIpcError,
  type DaemonIpcFailure,
  type DaemonIpcRequest,
  type DaemonIpcResponse,
} from './protocol.js'
import { ensurePrivateRuntimeDirectory, loadOrCreateDaemonIpcSecret } from './secret.js'
import { secureWindowsDaemonPipe } from './windows-acl.js'

export type DaemonIpcHandler = (params: JsonValue | undefined, context: {
  requestId: string
  afterResponse?: (callback: () => void) => void
}) => Promise<JsonValue> | JsonValue

export type DaemonIpcServer = {
  paths: DaemonIpcPaths
  close(): Promise<void>
}

export function assertUnixSocketEndpointLength(
  endpoint: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const maxBytes = platform === 'darwin' ? 104 : platform === 'linux' ? 107 : null
  if (maxBytes !== null && Buffer.byteLength(endpoint, 'utf8') > maxBytes) {
    throw new DaemonIpcError(
      'ipc_endpoint_too_long',
      `Daemon IPC endpoint exceeds the ${platform} Unix socket path limit.`,
    )
  }
}

export async function startDaemonIpcServer(options: {
  handlers: Record<string, DaemonIpcHandler>
  paths?: DaemonIpcPaths
}): Promise<DaemonIpcServer> {
  const paths = options.paths ?? resolveDaemonIpcPaths()
  ensurePrivateRuntimeDirectory(paths.runtimeDirectory)
  const secret = loadOrCreateDaemonIpcSecret(paths.runtimeDirectory, paths.secretFile)
  if (paths.transport === 'unix_socket') {
    assertUnixSocketEndpointLength(paths.endpoint)
    await prepareUnixSocket(paths.endpoint)
  }

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8')
    let received = ''
    let handled = false
    socket.on('data', (chunk: string) => {
      if (handled) return
      received += chunk
      if (Buffer.byteLength(received, 'utf8') > DAEMON_IPC_MAX_REQUEST_BYTES) {
        handled = true
        writeResponse(socket, failure('unknown', 'request_too_large', 'Daemon IPC request is too large.'))
        return
      }
      const newline = received.indexOf('\n')
      if (newline < 0) return
      handled = true
      let afterResponse: (() => void) | undefined
      void handleLine(received.slice(0, newline), secret, options.handlers, {
        afterResponse: (callback) => { afterResponse = callback },
      })
        .then((response) => writeResponse(socket, response, afterResponse))
        .catch(() => writeResponse(socket, failure('unknown', 'internal_error', 'Daemon IPC request failed.')))
    })
    socket.on('error', () => {})
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(daemonIpcListenOptions(paths), () => {
      server.off('error', onError)
      resolve()
    })
  })
  let socketIdentity: { dev: number; ino: number } | null = null
  if (paths.transport === 'windows_named_pipe') {
    try {
      secureWindowsDaemonPipe(paths.endpoint)
    } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw error
    }
  }
  if (paths.transport === 'unix_socket') {
    try {
      fs.chmodSync(paths.endpoint, 0o600)
      const stat = fs.lstatSync(paths.endpoint)
      if (!stat.isSocket() || stat.isSymbolicLink()) {
        throw new DaemonIpcError(
          'unsafe_ipc_endpoint',
          'Daemon IPC endpoint was not created as a Unix socket.',
        )
      }
      socketIdentity = { dev: stat.dev, ino: stat.ino }
    } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw error
    }
  }

  return {
    paths,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (paths.transport === 'unix_socket' && socketIdentity) {
        try {
          const stat = fs.lstatSync(paths.endpoint)
          if (stat.isSocket() && stat.dev === socketIdentity.dev && stat.ino === socketIdentity.ino) {
            fs.unlinkSync(paths.endpoint)
          }
        } catch {}
      }
    },
  }
}

async function prepareUnixSocket(endpoint: string): Promise<void> {
  try {
    const stat = fs.lstatSync(endpoint)
    if (!stat.isSocket() || stat.isSymbolicLink()) {
      throw new DaemonIpcError('unsafe_ipc_endpoint', 'Refusing to replace a non-socket IPC endpoint.')
    }
    if (await canConnect(endpoint)) {
      throw new DaemonIpcError('daemon_ipc_in_use', 'Another Shennian daemon IPC server is already running.')
    }
    fs.unlinkSync(endpoint)
  } catch (error) {
    if (isNotFound(error)) return
    throw error
  }
}

function canConnect(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint)
    const finish = (connected: boolean) => {
      socket.destroy()
      resolve(connected)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(300, () => finish(false))
  })
}

async function handleLine(
  line: string,
  secret: string,
  handlers: Record<string, DaemonIpcHandler>,
  context: { afterResponse?: (callback: () => void) => void } = {},
): Promise<DaemonIpcResponse> {
  let request: Partial<DaemonIpcRequest>
  try {
    request = JSON.parse(line) as Partial<DaemonIpcRequest>
  } catch {
    return failure('unknown', 'invalid_json', 'Daemon IPC request must be JSON.')
  }
  const requestId = typeof request.requestId === 'string' ? request.requestId.slice(0, 128) : 'unknown'
  if (request.version !== DAEMON_IPC_VERSION) {
    return failure(requestId, 'unsupported_version', 'Unsupported daemon IPC version.')
  }
  if (!timingSafeSecretEqual(request.auth, secret)) {
    return failure(requestId, 'unauthorized', 'Daemon IPC authentication failed.')
  }
  if (typeof request.method !== 'string' || !/^[a-z][a-z0-9_.-]{0,127}$/.test(request.method)) {
    return failure(requestId, 'invalid_method', 'Invalid daemon IPC method.')
  }
  const handler = handlers[request.method]
  if (!handler) return failure(requestId, 'method_not_found', 'Daemon IPC method is not supported.')
  try {
    const result = await handler(request.params, { requestId, ...context })
    return { version: DAEMON_IPC_VERSION, requestId, ok: true, result }
  } catch (error) {
    if (error instanceof DaemonIpcError) {
      return failure(requestId, error.code, error.message)
    }
    return failure(requestId, 'method_failed', 'Daemon IPC method failed.')
  }
}

export function timingSafeSecretEqual(value: unknown, secret: string): boolean {
  if (typeof value !== 'string') return false
  const actual = Buffer.from(value)
  const expected = Buffer.from(secret)
  const padded = Buffer.alloc(expected.length)
  actual.copy(padded, 0, 0, expected.length)
  const equal = crypto.timingSafeEqual(padded, expected)
  return equal && actual.length === expected.length
}

function failure(requestId: string, code: string, message: string): DaemonIpcFailure {
  return { version: DAEMON_IPC_VERSION, requestId, ok: false, error: { code, message } }
}

function writeResponse(socket: net.Socket, response: DaemonIpcResponse, afterResponse?: () => void): void {
  let serialized = JSON.stringify(response)
  if (Buffer.byteLength(`${serialized}\n`, 'utf8') > DAEMON_IPC_MAX_RESPONSE_BYTES) {
    serialized = JSON.stringify(
      failure(response.requestId, 'response_too_large', 'Daemon IPC response is too large.'),
    )
  }
  socket.end(`${serialized}\n`, afterResponse)
}

export function daemonIpcListenOptions(
  paths: DaemonIpcPaths,
): string | { path: string; readableAll: false; writableAll: false } {
  if (paths.transport === 'unix_socket') return paths.endpoint
  return { path: paths.endpoint, readableAll: false, writableAll: false }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
