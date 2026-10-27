import Redis from 'ioredis'

const RELAY_PREFIX = 'relay:'
const CLIENT_PREFIX = 'client:'
const USER_PREFIX = 'user:'
const HISTORY_PREFIX = 'history:'
const SERVER_REQUEST_PREFIX = 'server-request:'
const SERVER_RESPONSE_PREFIX = 'server-response:'
const MACHINE_CONTROL_PREFIX = 'machine-control:'
const VOICE_CHIEF_PREFIX = 'voice-chief:'
const CONNECTION_CONTROL_CHANNEL = 'connection-control:v1'
const REDIS_RETRY_MIN_MS = 200
const REDIS_RETRY_MAX_MS = 5_000

type Handler = (data: string) => void

class RelayPubSub {
  private subscriber: Redis | null = null
  private publisher: Redis | null = null
  private handlers = new Map<string, Set<Handler>>()
  private subscribedChannels = new Set<string>()
  private ready = false
  private redisRequired = false
  private destroyed = false
  private initialized = false

  async init(): Promise<void> {
    const url = process.env.REDIS_URL
    if (!url) return
    this.redisRequired = true
    this.destroyed = false
    this.initialized = false

    this.subscriber = this.createRedisClient(url, 'subscriber')
    this.publisher = this.createRedisClient(url, 'publisher')

    try {
      await this.subscriber.connect()
      await this.publisher.connect()
    } catch (error) {
      this.disableRedis()
      throw new Error(
        `Redis pubsub initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      )
    }

    this.subscriber.on('message', (channel: string, message: string) => {
      const set = this.handlers.get(channel)
      if (set) {
        for (const fn of set) fn(message)
      }
    })

    this.initialized = true
    this.ready = true
    await this.resubscribeAll()
  }

  subscribeRelay(machineId: string, handler: Handler): () => void {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    const channel = RELAY_PREFIX + machineId
    this.addHandler(channel, handler)
    void this.subscribeChannel(channel)
    return () => this.removeHandler(channel, handler)
  }

  unsubscribeRelay(machineId: string): void {
    if (!this.ready || !this.subscriber) return this.requireRedis()
    const channel = RELAY_PREFIX + machineId
    this.handlers.delete(channel)
    this.subscribedChannels.delete(channel)
    void this.subscriber
      .unsubscribe(channel)
      .catch((error) => this.handleRedisFailure(error, 'unsubscribe relay channel failed'))
  }

  subscribeClient(machineId: string, handler: Handler): () => void {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    const channel = CLIENT_PREFIX + machineId
    this.addHandler(channel, handler)
    void this.subscribeChannel(channel)
    return () => this.removeHandler(channel, handler)
  }

  unsubscribeClient(machineId: string): void {
    if (!this.ready || !this.subscriber) return this.requireRedis()
    const channel = CLIENT_PREFIX + machineId
    this.handlers.delete(channel)
    this.subscribedChannels.delete(channel)
    void this.subscriber
      .unsubscribe(channel)
      .catch((error) => this.handleRedisFailure(error, 'unsubscribe client channel failed'))
  }

  publishToRelay(machineId: string, data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(RELAY_PREFIX + machineId, data)
      .catch((error) => this.handleRedisFailure(error, 'publish relay event failed'))
  }

  publishToClient(machineId: string, data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(CLIENT_PREFIX + machineId, data)
      .catch((error) => this.handleRedisFailure(error, 'publish client event failed'))
  }

  subscribeUser(userId: string, handler: Handler): () => void {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    const channel = USER_PREFIX + userId
    this.addHandler(channel, handler)
    void this.subscribeChannel(channel)
    return () => this.removeHandler(channel, handler)
  }

  publishToUser(userId: string, data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(USER_PREFIX + userId, data)
      .catch((error) => this.handleRedisFailure(error, 'publish user event failed'))
  }

  subscribeHistory(routeKey: string, handler: Handler): () => void {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    const channel = HISTORY_PREFIX + routeKey
    this.addHandler(channel, handler)
    void this.subscribeChannel(channel)
    return () => this.removeHandler(channel, handler)
  }

  publishHistory(routeKey: string, data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(HISTORY_PREFIX + routeKey, data)
      .catch((error) => this.handleRedisFailure(error, 'publish history event failed'))
  }

  subscribeServerRequests(machineId: string, handler: Handler): () => void {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    const channel = SERVER_REQUEST_PREFIX + machineId
    this.addHandler(channel, handler)
    void this.subscribeChannel(channel)
    return () => this.removeHandler(channel, handler)
  }

  publishServerRequest(machineId: string, data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(SERVER_REQUEST_PREFIX + machineId, data)
      .catch((error) => this.handleRedisFailure(error, 'publish server request failed'))
  }

  async subscribeServerResponses(instanceId: string, handler: Handler): Promise<() => void> {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    const channel = SERVER_RESPONSE_PREFIX + instanceId
    this.addHandler(channel, handler)
    await this.subscribeChannel(channel)
    return () => this.removeHandler(channel, handler)
  }

  publishServerResponse(instanceId: string, data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(SERVER_RESPONSE_PREFIX + instanceId, data)
      .catch((error) => this.handleRedisFailure(error, 'publish server response failed'))
  }

  async subscribeMachineControl(machineId: string, handler: Handler): Promise<() => void> {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    const channel = MACHINE_CONTROL_PREFIX + machineId
    this.addHandler(channel, handler)
    await this.subscribeChannel(channel)
    return () => this.removeHandler(channel, handler)
  }

  publishMachineControl(machineId: string, data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(MACHINE_CONTROL_PREFIX + machineId, data)
      .catch((error) => this.handleRedisFailure(error, 'publish machine control failed'))
  }

  subscribeVoiceChiefConversation(conversationId: string, handler: Handler): () => void {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    const channel = VOICE_CHIEF_PREFIX + conversationId
    this.addHandler(channel, handler)
    void this.subscribeChannel(channel)
    return () => this.removeHandler(channel, handler)
  }

  publishVoiceChiefConversation(conversationId: string, data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(VOICE_CHIEF_PREFIX + conversationId, data)
      .catch((error) => this.handleRedisFailure(error, 'publish voice chief event failed'))
  }

  async subscribeConnectionControl(handler: Handler): Promise<() => void> {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return () => {}
    }
    this.addHandler(CONNECTION_CONTROL_CHANNEL, handler)
    await this.subscribeChannel(CONNECTION_CONTROL_CHANNEL)
    return () => this.removeHandler(CONNECTION_CONTROL_CHANNEL, handler)
  }

  publishConnectionControl(data: string): void {
    if (!this.ready || !this.publisher) return this.requireRedis()
    void this.publisher
      .publish(CONNECTION_CONTROL_CHANNEL, data)
      .catch((error) => this.handleRedisFailure(error, 'publish connection control failed'))
  }

  get isActive(): boolean {
    return this.ready
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    this.disableRedis()
  }

  private addHandler(channel: string, handler: Handler): void {
    let set = this.handlers.get(channel)
    if (!set) {
      set = new Set()
      this.handlers.set(channel, set)
    }
    set.add(handler)
  }

  private removeHandler(channel: string, handler: Handler): void {
    const set = this.handlers.get(channel)
    if (!set) return
    set.delete(handler)
    if (set.size === 0) {
      this.handlers.delete(channel)
      this.subscribedChannels.delete(channel)
      if (this.ready && this.subscriber) {
        void this.subscriber
          .unsubscribe(channel)
          .catch((error) => this.handleRedisFailure(error, 'unsubscribe empty channel failed'))
      }
    }
  }

  private requireRedis(): void {
    if (this.redisRequired) {
      throw new Error('Redis pubsub unavailable')
    }
  }

  private createRedisClient(url: string, role: 'subscriber' | 'publisher'): Redis {
    const client = new Redis(url, {
      lazyConnect: true,
      retryStrategy: (times) =>
        Math.min(REDIS_RETRY_MIN_MS * Math.max(times, 1), REDIS_RETRY_MAX_MS),
    })
    client.on('error', (error) => this.handleRedisFailure(error, `Redis ${role} error`))
    client.on('close', () => this.handleRedisDisconnect(`Redis ${role} closed`))
    client.on('end', () => this.handleRedisDisconnect(`Redis ${role} ended`))
    client.on('reconnecting', () => this.handleRedisDisconnect(`Redis ${role} reconnecting`))
    client.on('ready', () => {
      this.handleRedisReady()
    })
    return client
  }

  private async subscribeChannel(channel: string): Promise<void> {
    if (!this.ready || !this.subscriber) {
      this.requireRedis()
      return
    }
    this.subscribedChannels.add(channel)
    await this.subscriber.subscribe(channel)
  }

  private async resubscribeAll(): Promise<void> {
    if (!this.ready || !this.subscriber || this.subscribedChannels.size === 0) return
    for (const channel of this.subscribedChannels) {
      try {
        await this.subscriber.subscribe(channel)
      } catch (error) {
        this.handleRedisFailure(error, `resubscribe failed for ${channel}`)
        return
      }
    }
  }

  private handleRedisDisconnect(reason: string): void {
    if (!this.redisRequired || this.destroyed || !this.initialized) return
    if (this.ready) {
      console.warn(`[relay/pubsub] ${reason}; waiting for Redis reconnect`)
    }
    this.ready = false
  }

  private handleRedisReady(): void {
    if (!this.redisRequired || this.destroyed || !this.initialized) return
    const wasReady = this.ready
    this.ready = true
    if (!wasReady) {
      console.warn('[relay/pubsub] Redis reconnected; resubscribing channels')
      void this.resubscribeAll()
    }
  }

  private handleRedisFailure(error: unknown, context: string): void {
    if (!this.redisRequired || this.destroyed || !this.initialized) return
    this.ready = false
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[relay/pubsub] ${context}: ${message}`)
  }

  private disableRedis(): void {
    this.ready = false
    this.initialized = false
    const subscriber = this.subscriber
    const publisher = this.publisher
    this.subscriber = null
    this.publisher = null
    subscriber?.removeAllListeners()
    publisher?.removeAllListeners()
    subscriber?.disconnect()
    publisher?.disconnect()
  }
}

export const pubsub = new RelayPubSub()
