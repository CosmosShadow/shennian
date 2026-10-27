// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-ipc.test.ts

import type { JsonValue } from './json.js'

export const DAEMON_IPC_VERSION = 1 as const
export const DAEMON_IPC_MAX_REQUEST_BYTES = 1024 * 1024
export const DAEMON_IPC_MAX_RESPONSE_BYTES = 1024 * 1024

export type DaemonIpcRequest = {
  version: typeof DAEMON_IPC_VERSION
  requestId: string
  auth: string
  method: string
  params?: JsonValue
}

export type DaemonIpcSuccess = {
  version: typeof DAEMON_IPC_VERSION
  requestId: string
  ok: true
  result: JsonValue
}

export type DaemonIpcFailure = {
  version: typeof DAEMON_IPC_VERSION
  requestId: string
  ok: false
  error: { code: string; message: string }
}

export type DaemonIpcResponse = DaemonIpcSuccess | DaemonIpcFailure

export class DaemonIpcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'DaemonIpcError'
  }
}
