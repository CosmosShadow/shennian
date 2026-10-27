// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/relay/client.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const wsMock = vi.hoisted(() => ({
  instances: [] as Array<{
    url: string
    close: (code?: number, reason?: string | Buffer) => void
    terminate: () => void
    emit: (event: string, ...args: unknown[]) => void
    listeners: Map<string, Array<(...args: unknown[]) => void>>
    sent: string[]
    closeError?: Error
  }>,
}))

vi.mock('ws', () => {
  class MockWebSocket {
    url: string
    listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    sent: string[] = []
    closeError?: Error

    constructor(url: string) {
      this.url = url
      wsMock.instances.push(this)
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      const handlers = this.listeners.get(event) ?? []
      handlers.push(handler)
      this.listeners.set(event, handlers)
      return this
    }

    removeAllListeners(): this {
      this.listeners.clear()
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      const handlers = this.listeners.get(event) ?? []
      if (event === 'error' && handlers.length === 0) {
        throw args[0] instanceof Error ? args[0] : new Error('Unhandled socket error')
      }
      for (const handler of handlers) {
        handler(...args)
      }
    }

    close(code = 1000, reason: string | Buffer = ''): void {
      if (this.closeError) this.emit('error', this.closeError)
      this.emit('close', code, Buffer.isBuffer(reason) ? reason : Buffer.from(reason))
    }

    terminate(): void {
      this.emit('close', 1006, Buffer.alloc(0))
    }

    ping(): void {}

    send(data: string): void {
      this.sent.push(data)
    }
  }

  return { default: MockWebSocket }
})

const relayProblems = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => String(call[0])).filter((line) => /was not delivered|not valid JSON/.test(line))

describe('CliRelayClient disconnect diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers()
    wsMock.instances.length = 0
  })

  it('reports socket error details on disconnect', async () => {
    const { CliRelayClient } = await import('../relay/client')
    const disconnected = vi.fn()
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine',
      machineToken: 'token',
      onDisconnected: disconnected,
    })

    client.connect()
    wsMock.instances[0]?.emit('error', new Error('getaddrinfo ENOTFOUND shennian.net'))

    expect(disconnected).toHaveBeenCalledWith(expect.objectContaining({
      code: 1000,
      error: 'getaddrinfo ENOTFOUND shennian.net',
      phase: 'connecting',
      reconnectAttempt: 1,
      trigger: 'socket-error',
    }))

    client.disconnect()
  })

  it('absorbs a late socket error while disconnecting during the opening handshake', async () => {
    const { CliRelayClient } = await import('../relay/client')
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine',
      machineToken: 'token',
    })

    client.connect()
    wsMock.instances[0]!.closeError = new Error('WebSocket was closed before the connection was established')

    expect(() => client.disconnect()).not.toThrow()
  })

  it('reports the daemon auto-upgrade policy in the machine handshake', async () => {
    const { CliRelayClient } = await import('../relay/client')
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine',
      machineToken: 'token',
      autoUpgradePolicy: 'none',
    })

    client.connect()

    expect(wsMock.instances[0]?.url).toContain('upgradePolicy=none')
    client.disconnect()
  })

  it('reports the complete personal sync protocol and stable daemon identity', async () => {
    const { CliRelayClient } = await import('../relay/client')
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine',
      machineToken: 'token',
      sessionSyncProtocolVersion: 1,
      sessionSyncCapabilities: ['session_index_v1', 'local_canonical_v1'],
      daemonInstallationId: 'install-1',
      dataEpoch: 2,
      updaterProtocolVersion: 1,
    })

    client.connect()
    const url = new URL(wsMock.instances[0]!.url)
    expect(url.searchParams.get('syncProtocol')).toBe('1')
    expect(url.searchParams.get('syncCapabilities')).toBe('session_index_v1,local_canonical_v1')
    expect(url.searchParams.get('daemonInstallationId')).toBe('install-1')
    expect(url.searchParams.get('dataEpoch')).toBe('2')
    expect(url.searchParams.get('updaterProtocol')).toBe('1')
    client.disconnect()
  })

  it('advertises Project FS only after an exact Server challenge on the live connection', async () => {
    const crypto = await import('node:crypto')
    const wire = await import('@shennian/wire')
    const { CliRelayClient } = await import('../relay/client')
    const onReq = vi.fn()
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine',
      machineToken: 'machine-secret',
      sessionSyncCapabilities: ['session_index_v1', wire.PROJECT_FS_OPAQUE_CAPABILITY],
      daemonInstallationId: 'install-1',
      onReq,
    })
    client.connect()
    const socket = wsMock.instances[0]!
    expect(new URL(socket.url).searchParams.get('syncCapabilities')).toBe('session_index_v1')
    socket.emit('open')
    const challenge = {
      version: 1 as const,
      nonce: 'n'.repeat(32),
      daemonInstallationId: 'install-1',
    }
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'req',
          id: 'negotiate-1',
          method: wire.PROJECT_FS_NEGOTIATION_METHOD,
          params: challenge,
        }),
      ),
    )
    const response = JSON.parse(socket.sent.at(-1)!)
    expect(response).toMatchObject({
      type: 'res',
      id: 'negotiate-1',
      ok: true,
      payload: { capability: wire.PROJECT_FS_OPAQUE_CAPABILITY, ...challenge },
    })
    expect(response.payload.proof).toBe(
      crypto
        .createHmac('sha256', 'machine-secret')
        .update(wire.projectFsNegotiationProofPayload('negotiate-1', challenge))
        .digest('base64url'),
    )
    expect(onReq).not.toHaveBeenCalled()
    client.disconnect()
  })

  it('rejects a forged or stale Project FS Server signal', async () => {
    const wire = await import('@shennian/wire')
    const { CliRelayClient } = await import('../relay/client')
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine',
      machineToken: 'machine-secret',
      daemonInstallationId: 'install-2',
    })
    client.connect()
    const socket = wsMock.instances[0]!
    socket.emit('open')
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'req',
          id: 'forged',
          method: wire.PROJECT_FS_NEGOTIATION_METHOD,
          params: { version: 1, nonce: 'n'.repeat(32), daemonInstallationId: 'install-1' },
        }),
      ),
    )
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: 'res',
      id: 'forged',
      ok: false,
      error: 'invalid_identity',
    })
    client.disconnect()
  })

  it('fails closed before negotiation and revokes the connection generation on disconnect', async () => {
    const { CliRelayClient } = await import('../relay/client')
    const changed = vi.fn()
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine',
      machineToken: 'machine-secret',
      daemonInstallationId: 'install-1',
      onProjectFsCapabilityChanged: changed,
    })
    client.connect()
    const socket = wsMock.instances[0]!
    socket.emit('open')
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'req',
          id: 'open-before-negotiation',
          method: 'project.fs.open',
          params: {},
        }),
      ),
    )
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: 'res',
      id: 'open-before-negotiation',
      ok: false,
      payload: { rejection: { code: 'capability_required' } },
    })
    expect(changed).not.toHaveBeenCalledWith(true)

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'req',
          id: 'negotiate-live',
          method: 'project.fs.negotiate',
          params: { version: 1, nonce: 'n'.repeat(32), daemonInstallationId: 'install-1' },
        }),
      ),
    )
    expect(changed).toHaveBeenCalledWith(true)
    client.disconnect()
    expect(changed).toHaveBeenLastCalledWith(false)
  })

  it('reports connect timeout as the disconnect trigger', async () => {
    vi.useFakeTimers()
    const { CliRelayClient } = await import('../relay/client')
    const disconnected = vi.fn()
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine',
      machineToken: 'token',
      onDisconnected: disconnected,
    })

    client.connect()
    vi.advanceTimersByTime(15_000)

    expect(disconnected).toHaveBeenCalledWith(expect.objectContaining({
      code: 1006,
      phase: 'connecting',
      reconnectAttempt: 1,
      trigger: 'connect-timeout',
    }))

    client.disconnect()
  })

  it('surfaces structured buffered-event rejection and removes it from reconnect replay', async () => {
    const { CliRelayClient, SessionSyncRejectedError } = await import('../relay/client')
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine', machineToken: 'token',
    })
    client.connect()
    wsMock.instances[0]?.emit('open')
    const pending = client.sendBufferedEvent({
      type: 'event', id: 'index-1', event: 'session.index.updated', payload: {},
    })
    wsMock.instances[0]?.emit('message', Buffer.from(JSON.stringify({
      type: 'res', id: 'index-1', ok: false, error: 'invalid_identity',
      rejection: { code: 'invalid_identity', retryable: false, requiredAction: 'quarantine_record' },
    })))

    await expect(pending).rejects.toMatchObject({
      name: SessionSyncRejectedError.name,
      rejection: { code: 'invalid_identity', requiredAction: 'quarantine_record' },
    })
    client.disconnect()
  })

  it('reports agent events that could not be delivered instead of dropping them silently', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    error.mockClear()
    const { CliRelayClient } = await import('../relay/client')
    const client = new CliRelayClient({ serverUrl: 'wss://shennian.net/relay/machine', machineToken: 'token' })
    client.connect()
    wsMock.instances[0]?.emit('open')
    const send = (id: string) => client.sendAgentEvent({ type: 'event', id, event: 'agent', payload: { state: 'final' } })
    send('evt-1')
    send('evt-2')
    wsMock.instances[0]?.emit('message', Buffer.from(JSON.stringify({ type: 'res', id: 'evt-1', ok: false, error: 'server said no' })))
    await vi.advanceTimersByTimeAsync(0)
    wsMock.instances[0]?.emit('message', Buffer.from(JSON.stringify({ type: 'res', id: 'evt-2', ok: false, error: 'server said no' })))
    await vi.advanceTimersByTimeAsync(0)
    expect(relayProblems(error)).toHaveLength(1)
    expect(relayProblems(error)[0]).toContain('agent/final was not delivered: server said no')
    vi.setSystemTime(Date.now() + 31_000) // only the clock moves: no heartbeat or reconnect timers fire
    send('evt-3')
    wsMock.instances[0]?.emit('message', Buffer.from(JSON.stringify({ type: 'res', id: 'evt-3', ok: false, error: 'again' })))
    await vi.advanceTimersByTimeAsync(0)
    expect(relayProblems(error)).toHaveLength(2)
    expect(relayProblems(error)[1]).toContain('(+1 more since the last report)')
    client.disconnect()
  })

  it('does not report a buffered event that was merely superseded by its own resend', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    error.mockClear()
    const { CliRelayClient } = await import('../relay/client')
    const client = new CliRelayClient({ serverUrl: 'wss://shennian.net/relay/machine', machineToken: 'token' })
    client.connect()
    wsMock.instances[0]?.emit('open')
    client.sendAgentEvent({ type: 'event', id: 'same', event: 'agent', payload: { state: 'delta' } })
    client.sendAgentEvent({ type: 'event', id: 'same', event: 'agent', payload: { state: 'delta' } })
    await Promise.resolve()
    expect(relayProblems(error)).toHaveLength(0)
    client.disconnect()
  })

  it('notes an unreadable server frame once instead of ignoring it invisibly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    error.mockClear()
    const { CliRelayClient } = await import('../relay/client')
    const client = new CliRelayClient({ serverUrl: 'wss://shennian.net/relay/machine', machineToken: 'token' })
    client.connect()
    wsMock.instances[0]?.emit('open')
    wsMock.instances[0]?.emit('message', Buffer.from('not json'))
    wsMock.instances[0]?.emit('message', Buffer.from('still not json'))
    expect(relayProblems(error)).toHaveLength(1)
    expect(relayProblems(error)[0]).not.toContain('still not json')
    client.disconnect()
  })

  it('does not reconnect after a permanent protocol close', async () => {
    vi.useFakeTimers()
    const { CliRelayClient, isPermanentRelayClose } = await import('../relay/client')
    const disconnected = vi.fn()
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine', machineToken: 'token',
      onDisconnected: disconnected,
    })
    client.connect()
    wsMock.instances[0]?.emit('close', 4406, Buffer.from('upgrade_required:session_sync_protocol_mismatch'))
    vi.advanceTimersByTime(60_000)

    expect(isPermanentRelayClose(4406, 'upgrade_required')).toBe(true)
    expect(isPermanentRelayClose(1006, '')).toBe(false)
    expect(disconnected).toHaveBeenCalledTimes(1)
    expect(wsMock.instances).toHaveLength(1)
  })

  it('reconnects after a transient machine-offline or service-unavailable close', async () => {
    vi.useFakeTimers()
    const { CliRelayClient, isPermanentRelayClose } = await import('../relay/client')
    const client = new CliRelayClient({
      serverUrl: 'wss://shennian.net/relay/machine', machineToken: 'token',
    })
    client.connect()
    wsMock.instances[0]?.emit('close', 1013, Buffer.from('machine_offline'))
    vi.advanceTimersByTime(2_000)

    expect(isPermanentRelayClose(1013, 'machine_offline')).toBe(false)
    expect(isPermanentRelayClose(1013, 'service_unavailable')).toBe(false)
    expect(wsMock.instances).toHaveLength(2)
    client.disconnect()
  })
})
