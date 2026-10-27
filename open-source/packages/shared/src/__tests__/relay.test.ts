// @arch open-source/docs/shared-runtime.md
// @covers open-source/packages/shared/src/relay.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiplexRelayClient, RelayClient } from '../relay'

type MockCloseEvent = { code: number; reason: string }

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: MockCloseEvent) => void) | null = null
  onerror: (() => void) | null = null
  readyState = MockWebSocket.OPEN

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()

  close(code = 1000): void {
    this.onclose?.({ code, reason: '' })
  }

  emitOpen(): void {
    this.onopen?.()
  }

  emitClose(code: number, reason = ''): void {
    this.onclose?.({ code, reason })
  }
}

describe('RelayClient', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (originalWebSocket) {
      globalThis.WebSocket = originalWebSocket
    }
  })

  it('does not reconnect after a permanent machine-not-found close', async () => {
    const client = new RelayClient({
      url: 'ws://localhost/relay/missing',
      token: 'tok',
    })

    client.connect()
    expect(MockWebSocket.instances).toHaveLength(1)
    MockWebSocket.instances[0].emitOpen()
    MockWebSocket.instances[0].emitClose(4004)

    await vi.advanceTimersByTimeAsync(5_000)

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(client.getState()).toBe('disconnected')
  })

  it('reconnects after a transient close', async () => {
    const client = new RelayClient({
      url: 'ws://localhost/relay/m1',
      token: 'tok',
    })

    client.connect()
    expect(MockWebSocket.instances).toHaveLength(1)
    MockWebSocket.instances[0].emitOpen()
    MockWebSocket.instances[0].emitClose(1006)

    await vi.advanceTimersByTimeAsync(1_500)

    expect(MockWebSocket.instances.length).toBeGreaterThan(1)
  })

  it('backs off repeated multiplex-unavailable closes instead of retrying every second', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const client = new MultiplexRelayClient({
      url: 'ws://localhost/relay/client',
      token: 'tok',
    })

    client.connect()
    MockWebSocket.instances[0].emitOpen()
    MockWebSocket.instances[0].emitClose(4004)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(MockWebSocket.instances).toHaveLength(2)

    MockWebSocket.instances[1].emitOpen()
    MockWebSocket.instances[1].emitClose(4004)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(MockWebSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(MockWebSocket.instances).toHaveLength(3)
  })

  it('does not publish a successful connection or reset retry backoff before a Server frame', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const connected = vi.fn()
    const client = new MultiplexRelayClient({
      url: 'ws://localhost/relay/client',
      token: 'tok',
      onConnected: connected,
    })

    client.connect()
    MockWebSocket.instances[0].emitOpen()
    expect(connected).not.toHaveBeenCalled()
    expect(client.getConnectivitySnapshot().phase).toBe('connecting')
    MockWebSocket.instances[0].emitClose(1013, 'rejected after upgrade')
    await vi.advanceTimersByTimeAsync(1_000)

    MockWebSocket.instances[1].emitOpen()
    MockWebSocket.instances[1].emitClose(1013, 'rejected after upgrade')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(MockWebSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(MockWebSocket.instances).toHaveLength(3)
    expect(connected).not.toHaveBeenCalled()

    MockWebSocket.instances[2].emitOpen()
    MockWebSocket.instances[2].onmessage?.({ data: JSON.stringify({
      type: 'event', event: 'message.created', payload: {},
    }) })
    expect(connected).not.toHaveBeenCalled()
    MockWebSocket.instances[2].onmessage?.({ data: JSON.stringify({
      type: 'event', event: 'tick', payload: { ts: Date.now() },
    }) })
    expect(connected).toHaveBeenCalledTimes(1)
    expect(client.getConnectivitySnapshot()).toMatchObject({ phase: 'connected', retryAttempt: 0 })
  })

  it('times out a silent connecting socket and keeps retrying without a total attempt limit', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const events: string[] = []
    const client = new MultiplexRelayClient({
      url: 'ws://localhost/relay/client',
      token: 'tok',
      onConnectivityEvent: (event) => events.push(event.name),
    })

    client.connect()
    MockWebSocket.instances[0].emitOpen()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(client.getState()).toBe('connecting')

    await vi.advanceTimersByTimeAsync(1)
    expect(client.getConnectivitySnapshot()).toMatchObject({
      phase: 'recovering',
      closeCode: 0,
      closeReason: 'connect_timeout',
      retryAttempt: 1,
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(MockWebSocket.instances).toHaveLength(2)

    MockWebSocket.instances[1].emitOpen()
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(MockWebSocket.instances).toHaveLength(3)
    expect(events.filter((name) => name === 'relay_retry_scheduled')).toHaveLength(2)
  })

  it('continues retrying at the thirty-second cap instead of exhausting attempts', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const client = new MultiplexRelayClient({
      url: 'ws://localhost/relay/client',
      token: 'tok',
    })
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]

    client.connect()
    for (const [index, delay] of delays.entries()) {
      MockWebSocket.instances[index].emitClose(1006, 'transient')
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(MockWebSocket.instances).toHaveLength(index + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(MockWebSocket.instances).toHaveLength(index + 2)
    }

    expect(client.getState()).toBe('connecting')
    expect(client.getConnectivitySnapshot().retryAttempt).toBe(7)
  })

  it('publishes one manual-retry event for one explicit reconnect', () => {
    const events: string[] = []
    const client = new MultiplexRelayClient({
      url: 'ws://localhost/relay/client',
      token: 'tok',
      onConnectivityEvent: (event) => events.push(event.name),
    })

    client.connect()
    client.disconnect()
    expect(client.reconnectNow('manual')).toBe(true)

    expect(events.filter((name) => name === 'relay_manual_retry')).toHaveLength(1)
  })

  it('does not retry an upgrade-gated multiplex socket or admit requests before authority confirmation', async () => {
    const unavailable = vi.fn()
    const client = new MultiplexRelayClient({
      url: 'ws://localhost/relay/client',
      token: 'tok',
      onUnavailable: unavailable,
    })

    client.connect()
    const socket = MockWebSocket.instances[0]
    socket.emitOpen()
    const pending = client.send('m1', {
      type: 'req',
      method: 'chat.queue.get',
      params: { sessionId: 's1' },
    })
    socket.emitClose(4406)

    await expect(pending).rejects.toThrow('Not connected')
    expect(unavailable).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(client.getState()).toBe('disconnected')
    expect(client.getConnectivitySnapshot()).toMatchObject({
      phase: 'blocked',
      reason: 'version_unsupported',
      closeCode: 4406,
      retryable: false,
      nextRetryAt: null,
    })
  })

  it('publishes a retry snapshot with the raw close reason and bounded next attempt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const snapshots: unknown[] = []
    const events: string[] = []
    const client = new MultiplexRelayClient({
      url: 'ws://localhost/relay/client',
      token: 'tok',
      onConnectivityChange: (snapshot) => snapshots.push(snapshot),
      onConnectivityEvent: (event) => events.push(event.name),
    })

    client.connect()
    MockWebSocket.instances[0].emitOpen()
    MockWebSocket.instances[0].emitClose(1013, 'rolling restart')

    expect(client.getConnectivitySnapshot()).toMatchObject({
      phase: 'recovering',
      reason: 'server_unavailable',
      closeCode: 1013,
      closeReason: 'rolling restart',
      retryAttempt: 1,
      nextRetryAt: Date.now() + 1_000,
    })
    expect(snapshots.length).toBeGreaterThan(2)
    expect(events).toContain('relay_disconnected')
    expect(events).toContain('relay_retry_scheduled')
  })

  it('pauses retries while offline and reconnects immediately when the network returns', () => {
    const client = new MultiplexRelayClient({
      url: 'ws://localhost/relay/client',
      token: 'tok',
    })
    client.connect()
    MockWebSocket.instances[0].emitOpen()

    client.setNetworkOnline(false)
    expect(client.getConnectivitySnapshot()).toMatchObject({
      phase: 'offline',
      reason: 'network_offline',
      nextRetryAt: null,
    })
    client.setNetworkOnline(true)
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(client.getState()).toBe('connecting')
  })

  it('rejects legacy in-flight requests immediately when the socket drops', async () => {
    const client = new RelayClient({
      url: 'ws://localhost/relay/m1',
      token: 'tok',
    })

    client.connect()
    const socket = MockWebSocket.instances[0]
    socket.emitOpen()
    const pending = client.send({
      type: 'req',
      method: 'chat.queue.get',
      params: { sessionId: 's1' },
    })
    socket.emitClose(1006)

    await expect(pending).rejects.toThrow('Client disconnected')
  })
})
