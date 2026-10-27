// @arch open-source/docs/shared-runtime.md
// @covers open-source/packages/shared/src/relay-manager.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RelayManager } from '../relay-manager'
import type { EventFrame } from '@shennian/wire'
import type { RelayConnectivitySnapshot } from '@shennian/wire'

const recoveringSnapshot: RelayConnectivitySnapshot = {
  phase: 'recovering', reason: 'transient_transport', closeCode: 1006, closeReason: null,
  retryable: true, retryAttempt: 1, nextRetryAt: null, disconnectedAt: 1,
  lastConnectedAt: 1, connectionId: 'relay-test',
}

const { multiplexInstances } = vi.hoisted(() => ({
  multiplexInstances: [] as Array<{
    subscribe: ReturnType<typeof vi.fn>
    sendEvent: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    _fireEvent: (machineId: string, e: EventFrame) => void
    _fireUserEvent: (e: EventFrame) => void
    _fireUnavailable: () => void
    _fireDisconnected: () => void
    _fireConnectivity: (snapshot: RelayConnectivitySnapshot) => void
    getState: ReturnType<typeof vi.fn>
    getConnectivitySnapshot: ReturnType<typeof vi.fn>
    setNetworkOnline: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('../relay', () => {
  class MockRelayClient {
    _onEvent: (e: EventFrame) => void
    _onConnected: () => void
    connect = vi.fn()
    disconnect = vi.fn()
    getState = vi.fn(() => 'connected' as const)
    send = vi.fn()

    constructor(opts: { onEvent: (e: EventFrame) => void; onConnected: () => void }) {
      this._onEvent = opts.onEvent
      this._onConnected = opts.onConnected
      setTimeout(() => opts.onConnected(), 0)
    }

    _fireEvent(e: EventFrame) {
      this._onEvent(e)
    }

    _fireConnected() {
      this._onConnected()
    }
  }
  class MockMultiplexRelayClient {
    _onEvent: (machineId: string, e: EventFrame) => void
    _onConnected: () => void
    _onUnavailable: () => void
    _onDisconnected: () => void
    _onUserEvent: (e: EventFrame) => void
    _onConnectivityChange?: (snapshot: RelayConnectivitySnapshot) => void
    connect = vi.fn()
    disconnect = vi.fn()
    subscribe = vi.fn()
    unsubscribe = vi.fn()
    getState = vi.fn(() => 'connected' as const)
    getConnectivitySnapshot = vi.fn(() => ({
      ...recoveringSnapshot,
      phase: this.getState() === 'connected' ? 'connected' : 'recovering',
    }))
    setNetworkOnline = vi.fn()
    send = vi.fn()
    sendEvent = vi.fn()

    constructor(opts: {
      onEvent: (machineId: string, e: EventFrame) => void
      onConnected: () => void
      onUnavailable: () => void
      onDisconnected: () => void
      onUserEvent: (e: EventFrame) => void
      onConnectivityChange?: (snapshot: RelayConnectivitySnapshot) => void
    }) {
      this._onEvent = opts.onEvent
      this._onConnected = opts.onConnected
      this._onUnavailable = opts.onUnavailable
      this._onDisconnected = opts.onDisconnected
      this._onUserEvent = opts.onUserEvent
      this._onConnectivityChange = opts.onConnectivityChange
      multiplexInstances.push(this)
      setTimeout(() => opts.onConnected(), 0)
    }

    _fireEvent(machineId: string, e: EventFrame) {
      this._onEvent(machineId, e)
    }

    _fireConnected() {
      this._onConnected()
    }

    _fireUnavailable() {
      this._onUnavailable()
    }

    _fireDisconnected() {
      this._onDisconnected()
    }

    _fireConnectivity(snapshot: RelayConnectivitySnapshot) {
      this.getConnectivitySnapshot.mockReturnValue(snapshot)
      this._onConnectivityChange?.(snapshot)
    }

    _fireUserEvent(e: EventFrame) {
      this._onUserEvent(e)
    }
  }
  return { RelayClient: MockRelayClient, MultiplexRelayClient: MockMultiplexRelayClient }
})

function makeEvent(event: string, payload?: unknown): EventFrame {
  return { type: 'event', event, payload } as EventFrame
}

describe('RelayManager', () => {
  let mgr: RelayManager

  beforeEach(() => {
    multiplexInstances.length = 0
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      getToken: () => 'tok',
    })
  })

  it('acquire creates connection and fires local + global handlers', () => {
    const globalHandler = vi.fn()
    const localHandler = vi.fn()
    mgr.setEventHandler(globalHandler)

    const client = mgr.acquire('m1', localHandler) as ReturnType<typeof vi.fn> & {
      _fireEvent: (e: EventFrame) => void
    }
    expect(client).not.toBeNull()

    const evt = makeEvent('agent', { text: 'hi' })
    client!._fireEvent(evt)

    expect(localHandler).toHaveBeenCalledWith(evt)
    expect(globalHandler).toHaveBeenCalledWith('m1', evt)
  })

  it('second acquire reuses connection but adds local handler', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    const c1 = mgr.acquire('m1', handler1) as ReturnType<typeof vi.fn> & {
      _fireEvent: (e: EventFrame) => void
    }
    const c2 = mgr.acquire('m1', handler2)

    expect(c1).toBe(c2)

    const evt = makeEvent('test')
    c1!._fireEvent(evt)

    expect(handler1).toHaveBeenCalledWith(evt)
    expect(handler2).toHaveBeenCalledWith(evt)
  })

  it('release removes local handler; double release disconnects', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    const client = mgr.acquire('m1', handler1) as ReturnType<typeof vi.fn> & {
      _fireEvent: (e: EventFrame) => void
      disconnect: ReturnType<typeof vi.fn>
    }
    mgr.acquire('m1', handler2)

    mgr.release('m1', handler1)
    const evt = makeEvent('test')
    client!._fireEvent(evt)

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalledWith(evt)

    mgr.release('m1', handler2)
    expect(client!.disconnect).toHaveBeenCalled()
  })

  it('getState returns disconnected for unknown machine', () => {
    expect(mgr.getState('unknown')).toBe('disconnected')
  })

  it('does not fire reconnect callback on first connect, only later reconnects', async () => {
    const reconnect = vi.fn()
    mgr.setOnReconnect(reconnect)

    const client = mgr.acquire('m1') as ReturnType<typeof vi.fn> & { _fireConnected: () => void }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reconnect).not.toHaveBeenCalled()

    client!._fireConnected()
    await new Promise((resolve) => setTimeout(resolve, 550))

    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('uses one multiplex connection when buildClientUrl is provided', () => {
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    const c1 = mgr.acquire('m1', handler1)
    const c2 = mgr.acquire('m2', handler2)

    expect(c1).not.toBeNull()
    expect(c2).not.toBeNull()
    expect(c1).not.toBe(c2)
    expect(multiplexInstances).toHaveLength(1)
    expect(multiplexInstances[0].subscribe).toHaveBeenCalledWith('m1')
    expect(multiplexInstances[0].subscribe).toHaveBeenCalledWith('m2')

    multiplexInstances[0]._fireEvent('m1', makeEvent('agent'))
    expect(handler1).toHaveBeenCalledWith(makeEvent('agent'))
    expect(handler2).not.toHaveBeenCalled()
    mgr.getClient('m1')?.sendEvent(makeEvent('session.message'))

    expect(multiplexInstances[0].sendEvent).toHaveBeenCalledWith('m1', makeEvent('session.message'))
  })

  it('publishes account-level multiplex connection changes independently of machines', async () => {
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    const states: string[] = []
    mgr.onUserConnectionStateChange((state) => states.push(state))

    expect(mgr.connectUserEvents()).toBe(true)
    expect(states).toEqual(['connecting'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(states).toEqual(['connecting', 'connected'])

    multiplexInstances[0]._fireDisconnected()
    expect(states).toEqual(['connecting', 'connected', 'disconnected'])
  })

  it('connects and forwards user-scoped events without requiring a machine subscription', () => {
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    const handler = vi.fn()
    mgr.setEventHandler(handler)

    expect(mgr.connectUserEvents()).toBe(true)
    expect(multiplexInstances).toHaveLength(1)
    const event = makeEvent('room.message.created', { roomId: 'room_1' })
    multiplexInstances[0]._fireUserEvent(event)

    expect(handler).toHaveBeenCalledWith('', event)
    expect(multiplexInstances[0].subscribe).not.toHaveBeenCalled()
  })

  it('reconciles after an account socket reconnects even when machines were acquired later', async () => {
    vi.useFakeTimers()
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    const reconnect = vi.fn()
    mgr.setOnReconnect(reconnect)

    mgr.connectUserEvents()
    await vi.runOnlyPendingTimersAsync()
    mgr.acquire('m1')
    multiplexInstances[0]._fireConnected()
    await vi.advanceTimersByTimeAsync(500)

    expect(reconnect).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('resume actively reconnects an existing foreground account socket', () => {
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    mgr.connectUserEvents()
    multiplexInstances[0].connect.mockClear()

    expect(mgr.resume()).toBe(true)
    expect(multiplexInstances[0].connect).toHaveBeenCalledTimes(1)
  })

  it('rebuilds a stuck foreground multiplex socket after the watchdog threshold', async () => {
    vi.useFakeTimers()
    const connectivityEvent = vi.fn()
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
      onConnectivityEvent: connectivityEvent,
    })
    mgr.connectUserEvents()
    const first = multiplexInstances[0]
    first.getState.mockReturnValue('disconnected')
    first._fireConnectivity({ ...recoveringSnapshot, disconnectedAt: Date.now() })

    await vi.advanceTimersByTimeAsync(10_100)

    expect(first.disconnect).toHaveBeenCalledTimes(1)
    expect(multiplexInstances).toHaveLength(2)
    expect(connectivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'relay_watchdog_rebuild',
    }))
    vi.useRealTimers()
  })

  it('rebuilds a multiplex socket that stays connecting past the watchdog threshold', async () => {
    vi.useFakeTimers()
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    mgr.connectUserEvents()
    const first = multiplexInstances[0]
    first.getState.mockReturnValue('connecting')
    first._fireConnectivity({
      ...recoveringSnapshot,
      phase: 'connecting',
      closeCode: null,
      disconnectedAt: null,
      nextRetryAt: null,
    })

    await vi.advanceTimersByTimeAsync(12_100)

    expect(first.disconnect).toHaveBeenCalledTimes(1)
    expect(multiplexInstances).toHaveLength(2)
    vi.useRealTimers()
  })

  it('keeps manual reconnect idempotent while the replacement is connecting', () => {
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    mgr.connectUserEvents()
    multiplexInstances[0].getState.mockReturnValue('disconnected')

    expect(mgr.reconnectNow('manual')).toBe(true)
    multiplexInstances[1].getState.mockReturnValue('connecting')
    expect(mgr.reconnectNow('manual')).toBe(true)
    expect(multiplexInstances).toHaveLength(2)
  })

  it('does not rebuild while the device is offline', async () => {
    vi.useFakeTimers()
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    mgr.connectUserEvents()
    const first = multiplexInstances[0]
    first.getState.mockReturnValue('disconnected')
    mgr.setNetworkOnline(false)
    first._fireConnectivity({ ...recoveringSnapshot, disconnectedAt: Date.now() })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(multiplexInstances).toHaveLength(1)
    vi.useRealTimers()
  })

  it('does not create per-machine sockets when multiplex is unavailable', () => {
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })

    const first = mgr.acquire('m1')
    expect(first).not.toBeNull()
    multiplexInstances[0]._fireUnavailable()

    expect(multiplexInstances[0].disconnect).not.toHaveBeenCalled()
    expect(mgr.getClient('m1')).toBeDefined()
    expect(mgr.getState('m1')).toBe('connected')
    mgr.getClient('m1')?.sendEvent(makeEvent('session.message'))
    expect(multiplexInstances[0].sendEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps sendWhenReady pending across a transient disconnect and sends after recovery', async () => {
    vi.useFakeTimers()
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    mgr.connectUserEvents()
    const client = multiplexInstances[0]
    await vi.advanceTimersByTimeAsync(0)
    client.getState.mockReturnValue('disconnected')
    client.send.mockResolvedValue(undefined)

    const pending = mgr.sendWhenReady('m1', {
      type: 'req', method: 'chat.queue.get', params: { sessionId: 's1' },
    }, 10_000)
    client._fireDisconnected()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(client.send).not.toHaveBeenCalled()

    client.getState.mockReturnValue('connected')
    client._fireConnected()
    await expect(pending).resolves.toBeUndefined()
    expect(client.send).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('fails sendWhenReady immediately with a structured terminal reason', async () => {
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    mgr.connectUserEvents()
    const client = multiplexInstances[0]
    client.getState.mockReturnValue('disconnected')
    const pending = mgr.sendWhenReady('m1', {
      type: 'req', method: 'chat.queue.get', params: { sessionId: 's1' },
    }, 10_000)
    client._fireConnectivity({
      ...recoveringSnapshot,
      phase: 'blocked',
      reason: 'version_unsupported',
      retryable: false,
    })

    await expect(pending).rejects.toMatchObject({
      name: 'RelayConnectionError',
      snapshot: { reason: 'version_unsupported' },
    })
  })

  it('suspends the relay in background and restores one multiplex socket', () => {
    mgr = new RelayManager({
      buildUrl: (id) => `ws://localhost/${id}`,
      buildClientUrl: () => 'ws://localhost/client',
      getToken: () => 'tok',
    })
    const retainedHandle = mgr.acquire('m1')
    mgr.acquire('m2')

    mgr.suspend()
    expect(multiplexInstances[0].disconnect).toHaveBeenCalledTimes(1)
    expect(mgr.getState('m1')).toBe('disconnected')
    const backgroundHandle = mgr.acquire('m3')
    expect(backgroundHandle?.getState()).toBe('disconnected')
    expect(multiplexInstances).toHaveLength(1)

    expect(mgr.resume()).toBe(true)
    expect(multiplexInstances).toHaveLength(2)
    expect(multiplexInstances[1].subscribe).toHaveBeenCalledWith('m1')
    expect(multiplexInstances[1].subscribe).toHaveBeenCalledWith('m2')
    expect(multiplexInstances[1].subscribe).toHaveBeenCalledWith('m3')
    retainedHandle?.sendEvent(makeEvent('session.message'))
    expect(multiplexInstances[1].sendEvent).toHaveBeenCalledWith(
      'm1',
      makeEvent('session.message'),
    )
  })
})
