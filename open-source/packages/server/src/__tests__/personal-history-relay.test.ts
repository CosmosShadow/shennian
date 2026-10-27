// @covers src/relay/personal-history-relay.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { pubsub } from '../relay/pubsub.js'
import type { ReqFrame } from '@shennian/wire'
import {
  PersonalHistoryRelay,
  personalHistoryOpenError,
} from '../relay/personal-history-relay.js'

const identity = { protocolVersion: 2 as const, dataEpoch: 2 as const, daemonInstallationId: 'install-1' }

function socket() {
  return {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
  }
}

function request(
  id: string,
  method: 'session.history.open' | 'session.history.page' | 'session.history.close',
  subscriptionId: string,
): ReqFrame {
  return {
    type: 'req', id, method,
    params: { ...identity, sessionId: 'session-1', subscriptionId },
  }
}

function replicaRequest(
  id: string,
  method: 'session.body.replica.subscribe' | 'session.body.replica.unsubscribe',
): ReqFrame {
  return {
    type: 'req', id, method,
    params: {
      ...identity,
      appInstallationId: 'app-install-1',
      streamId: 'stream-1',
      generation: 1,
    },
  }
}

describe('personal history relay', () => {
  const registries: PersonalHistoryRelay[] = []
  afterEach(() => {
    for (const registry of registries) registry.reset()
    registries.length = 0
    vi.restoreAllMocks()
  })

  function registry() {
    const value = new PersonalHistoryRelay()
    registries.push(value)
    return value
  }

  it.each([
    [false, 'daemonInstallationId'], [false, 'dataEpoch'], [false, 'protocolVersion'],
    [false, 'sessionId'], [true, 'daemonInstallationId'], [true, 'appInstallationId'],
    [true, 'generation'], [true, 'dataEpoch'],
  ] as const)('validates cross-node delta (replica=%s, mismatch=%s)', (replica, mismatch) => {
    const callbacks = new Map<string, (data: string) => void>()
    vi.spyOn(pubsub, 'isActive', 'get').mockReturnValue(true)
    vi.spyOn(pubsub, 'subscribeHistory').mockImplementation((key, cb) => {
      callbacks.set(key, cb)
      return () => { callbacks.delete(key) }
    })
    const publish = vi.spyOn(pubsub, 'publishHistory').mockImplementation((key, data) => {
      callbacks.get(key)?.(data)
    })
    const appNode = registry()
    const daemonNode = registry()
    const owner = socket()
    if (replica) appNode.registerReplicaRoute({
      ...identity, socket: owner as never, machineId: 'machine-1', mode: 'legacy',
      appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
    })
    else appNode.registerClientRoute({
      ...identity, socket: owner as never, machineId: 'machine-1', mode: 'legacy',
      sessionId: 'session-1', subscriptionId: 'subscription-1',
    })
    const frame = {
      type: 'event', event: replica ? 'session.body.replica.delta' : 'session.body.delta',
      payload: { ...identity, sessionId: 'session-1', subscriptionId: 'subscription-1',
        appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
        fromRevision: 1, toRevision: 2, mutations: [], batches: [] },
    }
    daemonNode.routeMachineFrame('machine-other', JSON.stringify(frame))
    expect(owner.send).not.toHaveBeenCalled()
    daemonNode.routeMachineFrame('machine-1', JSON.stringify(frame))
    expect(owner.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify(frame))
    expect(publish).toHaveBeenCalled()
    owner.send.mockClear()
    // Raw Pub/Sub deltas cannot bypass authenticated source validation.
    for (const cb of callbacks.values()) cb(JSON.stringify(frame))
    expect(owner.send).not.toHaveBeenCalled()
    owner.send.mockClear()
    const originalPayload = { ...frame.payload }
    Object.assign(frame.payload, { [mismatch]: mismatch === 'generation' || mismatch === 'dataEpoch'
      || mismatch === 'protocolVersion' ? 999 : 'wrong-identity' })
    daemonNode.routeMachineFrame('machine-1', JSON.stringify(frame))
    expect(owner.send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('invalid_identity'))
    owner.send.mockClear()
    Object.assign(frame.payload, originalPayload)
    daemonNode.routeMachineFrame('machine-1', JSON.stringify(frame))
    expect(owner.send).not.toHaveBeenCalled()
  })

  it('routes a history response only to the socket that owns the subscription', () => {
    const relay = registry()
    const owner = socket()
    const other = socket()
    relay.registerClientRoute({
      ...identity,
      socket: owner as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-1', mode: 'legacy',
    })
    relay.registerClientRoute({
      ...identity,
      socket: other as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-2', mode: 'legacy',
    })
    relay.observeForwardedRequest(
      'machine-1', request('request-1', 'session.history.open', 'subscription-1'),
    )

    expect(relay.routeMachineFrame('machine-1', JSON.stringify({
      type: 'res', id: 'request-1', ok: true,
      payload: { ...identity, sessionId: 'session-1', subscriptionId: 'subscription-1' },
    }))).toBe(true)
    expect(owner.send).toHaveBeenCalledTimes(1)
    expect(other.send).not.toHaveBeenCalled()
  })

  it('routes body delta by subscription rather than broadcasting by machine', () => {
    const relay = registry()
    const owner = socket()
    const other = socket()
    relay.registerClientRoute({
      ...identity,
      socket: owner as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-1', mode: 'multiplex',
    })
    relay.registerClientRoute({
      ...identity,
      socket: other as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-2', mode: 'multiplex',
    })

    const handled = relay.routeMachineFrame('machine-1', JSON.stringify({
      type: 'event', event: 'session.body.delta', payload: {
        ...identity,
        sessionId: 'session-1', subscriptionId: 'subscription-1',
        fromRevision: 1, toRevision: 2, mutations: [],
      },
    }))
    expect(handled).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('"type":"relay"'))
    expect(other.send).not.toHaveBeenCalled()
  })

  it('routes one machine-level replica stream containing multiple session batches', () => {
    const relay = registry()
    const owner = socket()
    const other = socket()
    relay.registerReplicaRoute({
      socket: owner as never, machineId: 'machine-1', mode: 'multiplex',
      ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
    })
    relay.registerReplicaRoute({
      socket: other as never, machineId: 'machine-1', mode: 'multiplex',
      ...identity, appInstallationId: 'app-install-2', streamId: 'stream-2', generation: 1,
    })
    relay.observeForwardedRequest('machine-1', replicaRequest(
      'replica-subscribe', 'session.body.replica.subscribe',
    ))
    expect(relay.routeMachineFrame('machine-1', JSON.stringify({
      type: 'res', id: 'replica-subscribe', ok: true,
      payload: {
        ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1',
        generation: 1, highWatermarks: [],
      },
    }))).toBe(true)

    relay.routeMachineFrame('machine-1', JSON.stringify({
      type: 'event', event: 'session.body.replica.delta', payload: {
        ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
        batches: [
          { sessionId: 'session-1', fromRevision: 1, toRevision: 2, mutations: [] },
          { sessionId: 'session-2', fromRevision: 4, toRevision: 5, mutations: [] },
        ],
      },
    }))
    expect(owner.send).toHaveBeenCalledTimes(2)
    expect(other.send).not.toHaveBeenCalled()
  })

  it('keeps a machine replica route for the lifetime of its App socket', () => {
    vi.useFakeTimers()
    try {
      const relay = registry()
      const owner = socket()
      relay.registerReplicaRoute({
        socket: owner as never, machineId: 'machine-1', mode: 'multiplex',
        ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
      })
      relay.observeForwardedRequest('machine-1', replicaRequest(
        'replica-subscribe', 'session.body.replica.subscribe',
      ))
      relay.routeMachineFrame('machine-1', JSON.stringify({
        type: 'res', id: 'replica-subscribe', ok: true,
        payload: {
          ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1',
          generation: 1, highWatermarks: [],
        },
      }))

      vi.advanceTimersByTime(5 * 60_000)

      expect(relay.hasReplicaRoute(
        owner as never, 'machine-1', 'stream-1', 1,
      )).toBe(true)
      relay.routeMachineFrame('machine-1', JSON.stringify({
        type: 'event', event: 'session.body.replica.delta', payload: {
          ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
          batches: [{ sessionId: 'session-1', fromRevision: 1, toRevision: 2, mutations: [] }],
        },
      }))
      expect(owner.send).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires a replica route that never finishes subscribing', () => {
    vi.useFakeTimers()
    try {
      const relay = registry()
      const owner = socket()
      relay.registerReplicaRoute({
        socket: owner as never, machineId: 'machine-1', mode: 'multiplex',
        ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
      })
      vi.advanceTimersByTime(45_001)
      expect(relay.hasReplicaRoute(owner as never, 'machine-1', 'stream-1', 1)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('replaces a replica route only when the same App advances its generation', () => {
    const relay = registry()
    const client = socket()
    const route = {
      socket: client as never, machineId: 'machine-1', mode: 'multiplex' as const,
      ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1',
    }

    relay.registerReplicaRoute({ ...route, generation: 1 })
    expect(() => relay.registerReplicaRoute({ ...route, generation: 0 })).toThrow(
      'invalid replica generation',
    )

    relay.registerReplicaRoute({ ...route, generation: 2 })
    expect(relay.hasReplicaRoute(client as never, 'machine-1', 'stream-1', 1)).toBe(false)
    expect(relay.hasReplicaRoute(client as never, 'machine-1', 'stream-1', 2)).toBe(true)
  })

  it('limits active subscriptions per client socket', () => {
    const relay = registry()
    const client = socket()
    for (let index = 0; index < 4; index++) {
      relay.registerClientRoute({
      ...identity,
        socket: client as never, machineId: 'machine-1', sessionId: `session-${index}`,
        subscriptionId: `subscription-${index}`, mode: 'legacy',
      })
    }
    expect(() => relay.registerClientRoute({
      ...identity,
      socket: client as never, machineId: 'machine-1', sessionId: 'session-5',
      subscriptionId: 'subscription-5', mode: 'legacy',
    })).toThrow('subscription_limit_exceeded')
  })

  it('closes daemon subscriptions and removes routes when a client disconnects', () => {
    const relay = registry()
    const client = socket()
    const sendClose = vi.fn()
    relay.registerClientRoute({
      ...identity,
      socket: client as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-1', mode: 'legacy',
    })
    relay.closeSocket(client as never, sendClose)
    expect(sendClose).toHaveBeenCalledWith('machine-1', expect.objectContaining({
      method: 'session.history.close',
      params: expect.objectContaining({ sessionId: 'session-1', subscriptionId: 'subscription-1' }),
    }))
    expect(relay.hasClientRoute(
      client as never, 'machine-1', 'session-1', 'subscription-1',
    )).toBe(false)
  })

  it('unsubscribes the machine replica stream when its App socket closes', () => {
    const relay = registry()
    const client = socket()
    const sendClose = vi.fn()
    relay.registerReplicaRoute({
      socket: client as never, machineId: 'machine-1', mode: 'legacy',
      ...identity, appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
    })
    relay.closeSocket(client as never, sendClose)
    expect(sendClose).toHaveBeenCalledWith('machine-1', expect.objectContaining({
      method: 'session.body.replica.unsubscribe',
      params: expect.objectContaining({
        appInstallationId: 'app-install-1', streamId: 'stream-1', generation: 1,
      }),
    }))
    expect(relay.hasReplicaRoute(client as never, 'machine-1', 'stream-1', 1)).toBe(false)
  })

  it('closes every active route for a deleted session before late deltas arrive', () => {
    const relay = registry()
    const first = socket()
    const second = socket()
    const sendClose = vi.fn()
    relay.registerClientRoute({
      ...identity,
      socket: first as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-1', mode: 'legacy',
    })
    relay.registerClientRoute({
      ...identity,
      socket: second as never, machineId: 'machine-1', sessionId: 'session-2',
      subscriptionId: 'subscription-2', mode: 'legacy',
    })

    relay.closeSession('session-1', sendClose)

    expect(sendClose).toHaveBeenCalledWith('machine-1', expect.objectContaining({
      method: 'session.history.close',
      params: expect.objectContaining({ sessionId: 'session-1', subscriptionId: 'subscription-1' }),
    }))
    expect(relay.hasClientRoute(
      first as never, 'machine-1', 'session-1', 'subscription-1',
    )).toBe(false)
    expect(relay.hasClientRoute(
      second as never, 'machine-1', 'session-2', 'subscription-2',
    )).toBe(true)
  })

  it('terminates a slow socket instead of accumulating unbounded body bytes', () => {
    const relay = registry()
    const client = socket()
    client.bufferedAmount = 5 * 1024 * 1024
    relay.registerClientRoute({
      ...identity,
      socket: client as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-1', mode: 'legacy',
    })
    relay.routeMachineFrame('machine-1', JSON.stringify({
      type: 'event', event: 'session.body.delta', payload: {
        ...identity,
        sessionId: 'session-1', subscriptionId: 'subscription-1',
        fromRevision: 1, toRevision: 2, mutations: [],
      },
    }))
    expect(client.close).toHaveBeenCalledWith(4413, 'history backpressure exceeded')
  })

  it('does not let one slow subscriber block another subscriber of the same session', () => {
    const relay = registry()
    const slow = socket()
    const healthy = socket()
    slow.bufferedAmount = 5 * 1024 * 1024
    relay.registerClientRoute({
      ...identity,
      socket: slow as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-slow', mode: 'legacy',
    })
    relay.registerClientRoute({
      ...identity,
      socket: healthy as never, machineId: 'machine-1', sessionId: 'session-1',
      subscriptionId: 'subscription-healthy', mode: 'legacy',
    })

    relay.routeMachineFrame('machine-1', JSON.stringify({
      type: 'event', event: 'session.body.delta', payload: {
        ...identity,
        sessionId: 'session-1', subscriptionId: 'subscription-slow',
        fromRevision: 1, toRevision: 2, mutations: [],
      },
    }))
    relay.routeMachineFrame('machine-1', JSON.stringify({
      type: 'event', event: 'session.body.delta', payload: {
        ...identity,
        sessionId: 'session-1', subscriptionId: 'subscription-healthy',
        fromRevision: 1, toRevision: 2, mutations: [],
      },
    }))

    expect(slow.close).toHaveBeenCalledWith(4413, 'history backpressure exceeded')
    expect(healthy.send).toHaveBeenCalledOnce()
    expect(healthy.close).not.toHaveBeenCalled()
  })

  it('distinguishes an offline origin from missing history and an old daemon', () => {
    expect(personalHistoryOpenError(null)).toBe('history_unavailable')
    expect(personalHistoryOpenError({ machine: {
      online: false, sessionSyncProtocolVersion: 2, sessionSyncDataEpoch: 2,
      sessionSyncCapabilities: [], daemonInstallationId: 'install-1',
    } })).toBe('machine_offline')
    expect(personalHistoryOpenError({ machine: {
      online: true, sessionSyncProtocolVersion: null, sessionSyncDataEpoch: null,
      sessionSyncCapabilities: [], daemonInstallationId: null,
    } })).toBe('upgrade_required')
  })
})
