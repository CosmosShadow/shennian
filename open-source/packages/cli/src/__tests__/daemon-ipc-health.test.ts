// @covers src/commands/daemon-ipc-health.ts
// @covers src/daemon-ipc/client.ts

import { describe, expect, it, vi } from 'vitest'
import { checkDaemonIpcHealth } from '../commands/daemon-ipc-health.js'
import { classifyDaemonIpcConnectError } from '../daemon-ipc/client.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'

describe('daemon IPC diagnostics', () => {
  it('distinguishes a running process from a reachable control endpoint', async () => {
    const call = vi.fn().mockResolvedValue({ daemonVersion: '0.5.9' })
    expect(await checkDaemonIpcHealth(false, call)).toEqual({ state: 'not_running' })
    expect(call).not.toHaveBeenCalled()
    expect(await checkDaemonIpcHealth(true, call)).toEqual({ state: 'ready' })
    expect(call).toHaveBeenCalledExactlyOnceWith({ method: 'protocol.info', timeoutMs: 2_000 })
  })

  it('reports old methods and inaccessible IPC without exposing OS error text', async () => {
    const call = vi.fn().mockRejectedValueOnce(new DaemonIpcError('method_not_found', 'private'))
      .mockRejectedValueOnce(new DaemonIpcError('ipc_access_denied', 'private'))
      .mockRejectedValueOnce(Object.assign(new Error('private path'), { code: 'ENOENT' }))
    expect(await checkDaemonIpcHealth(true, call)).toEqual({ state: 'unsupported', error: 'method_not_found' })
    expect(await checkDaemonIpcHealth(true, call)).toEqual({ state: 'unavailable', error: 'ipc_access_denied' })
    expect(await checkDaemonIpcHealth(true, call)).toEqual({ state: 'unavailable', error: 'ipc_secret_missing' })
  })

  it('keeps named-pipe access denial distinct from an absent endpoint', () => {
    expect(classifyDaemonIpcConnectError({ code: 'EACCES' } as NodeJS.ErrnoException).code)
      .toBe('ipc_access_denied')
    expect(classifyDaemonIpcConnectError({ code: 'ENOENT' } as NodeJS.ErrnoException).code)
      .toBe('daemon_unavailable')
    expect(classifyDaemonIpcConnectError({ code: 'ECONNRESET' } as NodeJS.ErrnoException).code)
      .toBe('ipc_connection_failed')
  })
})
