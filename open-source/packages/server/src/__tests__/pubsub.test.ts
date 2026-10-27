// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/pubsub.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: any[]) => void

type MockRedisInstance = {
  connect: ReturnType<typeof vi.fn>
  publish: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeAllListeners: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: any[]) => void
}

const { redisInstances } = vi.hoisted(() => ({
  redisInstances: [] as MockRedisInstance[],
}))

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(function RedisMock() {
    const listeners = new Map<string, Set<Listener>>()
    const redis: MockRedisInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockResolvedValue(1),
      unsubscribe: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
      on: vi.fn((event: string, listener: Listener) => {
        const set = listeners.get(event) ?? new Set<Listener>()
        set.add(listener)
        listeners.set(event, set)
        return redis
      }),
      removeAllListeners: vi.fn(() => {
        listeners.clear()
        return redis
      }),
      emit: (event: string, ...args: any[]) => {
        for (const listener of listeners.get(event) ?? []) {
          listener(...args)
        }
      },
    }
    redisInstances.push(redis)
    return redis
  }),
}))

describe('RelayPubSub', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    redisInstances.length = 0
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('fails fast when Redis is configured but unavailable', async () => {
    const { pubsub } = await import('../relay/pubsub.js')
    await pubsub.init()
    await pubsub.destroy()

    expect(() => pubsub.publishToClient('m1', 'event-1')).toThrow('Redis pubsub unavailable')
  })

  it('marks pubsub unavailable during disconnect and recovers after ready', async () => {
    const { pubsub } = await import('../relay/pubsub.js')
    await pubsub.init()

    pubsub.subscribeClient('m1', vi.fn())
    const subscriber = redisInstances[0]

    expect(subscriber.subscribe).toHaveBeenCalledWith('client:m1')

    subscriber.emit('close')

    expect(() => pubsub.publishToClient('m1', 'event-2')).toThrow('Redis pubsub unavailable')

    subscriber.emit('ready')
    await vi.waitFor(() => {
      expect(subscriber.subscribe).toHaveBeenCalledTimes(2)
    })

    expect(() => pubsub.publishToClient('m1', 'event-3')).not.toThrow()
  })

  it('re-subscribes every tracked channel after Redis reconnects', async () => {
    const { pubsub } = await import('../relay/pubsub.js')
    await pubsub.init()

    pubsub.subscribeClient('machine-1', vi.fn())
    pubsub.subscribeUser('user-1', vi.fn())

    const subscriber = redisInstances[0]
    expect(subscriber.subscribe).toHaveBeenNthCalledWith(1, 'client:machine-1')
    expect(subscriber.subscribe).toHaveBeenNthCalledWith(2, 'user:user-1')

    subscriber.emit('reconnecting')
    subscriber.emit('ready')

    await vi.waitFor(() => {
      expect(subscriber.subscribe).toHaveBeenCalledWith('client:machine-1')
      expect(subscriber.subscribe).toHaveBeenCalledWith('user:user-1')
      expect(subscriber.subscribe).toHaveBeenCalledTimes(4)
    })
  })

  it('routes internal responses only through the addressed server instance channel', async () => {
    const { pubsub } = await import('../relay/pubsub.js')
    await pubsub.init()
    const handler = vi.fn()

    await pubsub.subscribeServerResponses('server-2', handler)
    pubsub.publishServerResponse('server-2', '{"type":"server.response"}')

    expect(redisInstances[0].subscribe).toHaveBeenCalledWith('server-response:server-2')
    expect(redisInstances[1].publish).toHaveBeenCalledWith(
      'server-response:server-2',
      '{"type":"server.response"}',
    )
  })

  it('keeps internal requests off the public client-to-machine relay channel', async () => {
    const { pubsub } = await import('../relay/pubsub.js')
    await pubsub.init()

    pubsub.subscribeServerRequests('machine-1', vi.fn())
    pubsub.publishServerRequest('machine-1', '{"type":"server.request"}')

    expect(redisInstances[0].subscribe).toHaveBeenCalledWith('server-request:machine-1')
    expect(redisInstances[1].publish).toHaveBeenCalledWith(
      'server-request:machine-1',
      '{"type":"server.request"}',
    )
    expect(redisInstances[1].publish).not.toHaveBeenCalledWith(
      'relay:machine-1',
      expect.any(String),
    )
  })

  it('broadcasts machine replacement only on the machine control channel', async () => {
    const { pubsub } = await import('../relay/pubsub.js')
    await pubsub.init()

    await pubsub.subscribeMachineControl('machine-1', vi.fn())
    pubsub.publishMachineControl('machine-1', '{"type":"machine.connection.replaced"}')

    expect(redisInstances[0].subscribe).toHaveBeenCalledWith('machine-control:machine-1')
    expect(redisInstances[1].publish).toHaveBeenCalledWith(
      'machine-control:machine-1',
      '{"type":"machine.connection.replaced"}',
    )
  })

  it('fans connection revocations out on the shared Server control channel', async () => {
    const { pubsub } = await import('../relay/pubsub.js')
    await pubsub.init()

    await pubsub.subscribeConnectionControl(vi.fn())
    pubsub.publishConnectionControl('{"version":1,"type":"device.revoke","deviceId":"d1"}')

    expect(redisInstances[0].subscribe).toHaveBeenCalledWith('connection-control:v1')
    expect(redisInstances[1].publish).toHaveBeenCalledWith(
      'connection-control:v1',
      '{"version":1,"type":"device.revoke","deviceId":"d1"}',
    )
  })

  it('routes voice agent events only through the addressed conversation channel', async () => {
    const { pubsub } = await import('../relay/pubsub.js')
    await pubsub.init()

    pubsub.subscribeVoiceChiefConversation('conversation-1', vi.fn())
    pubsub.publishVoiceChiefConversation('conversation-1', '{"state":"final"}')

    expect(redisInstances[0].subscribe).toHaveBeenCalledWith('voice-chief:conversation-1')
    expect(redisInstances[1].publish).toHaveBeenCalledWith(
      'voice-chief:conversation-1',
      '{"state":"final"}',
    )
  })
})
