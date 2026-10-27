// @covers open-source/packages/cli/src/commands/daemon-stop-ipc.ts

import { describe, expect, it, vi } from 'vitest'
import { requestWindowsDaemonSelfStop } from '../commands/daemon-stop-ipc.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'

describe('Windows cross-session daemon stop', () => {
  it('accepts only a response from the exact PID it requested', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true, pid: 43210 })
    await expect(requestWindowsDaemonSelfStop(43210, call)).resolves.toEqual({ accepted: true })
    expect(call).toHaveBeenCalledWith({
      method: 'daemon.shutdown', params: { expectedPid: 43210 }, timeoutMs: 3_000,
    })
    await expect(requestWindowsDaemonSelfStop(43211, call)).resolves.toEqual({
      accepted: false, error: 'daemon_instance_mismatch',
    })
    expect(await requestWindowsDaemonSelfStop(-1, call)).toEqual({
      accepted: false, error: 'daemon_instance_mismatch',
    })
  })

  it.each(['ipc_access_denied', 'method_not_found'])(
    'identifies an inaccessible or old S4U control channel (%s) for assisted migration',
    async (code) => {
      const call = vi.fn().mockRejectedValue(new DaemonIpcError(code, 'denied'))
      await expect(requestWindowsDaemonSelfStop(43210, call)).resolves.toEqual({
        accepted: false, error: 'legacy_s4u_migration_required',
      })
    },
  )

  it('keeps authentication and missing endpoints distinct from migration', async () => {
    const unauthorized = vi.fn().mockRejectedValue(new DaemonIpcError('unauthorized', 'bad secret'))
    const unavailable = vi.fn().mockRejectedValue(new DaemonIpcError('daemon_unavailable', 'missing'))
    await expect(requestWindowsDaemonSelfStop(43210, unauthorized)).resolves.toEqual({
      accepted: false, error: 'daemon_shutdown_unauthorized',
    })
    await expect(requestWindowsDaemonSelfStop(43210, unavailable)).resolves.toEqual({
      accepted: false, error: 'daemon_shutdown_ipc_unavailable',
    })
  })
})
