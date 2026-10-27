// @covers open-source/packages/server/src/routes/voice-asr-ws.ts
// @covers open-source/packages/server/src/services/voice-asr.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import WebSocket from 'ws'

vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'valid-token') return { userId: 'user1', deviceId: 'dev1' }
    return null
  }),
  verifyMachineToken: vi.fn(() => null),
  signToken: vi.fn(),
  signRefreshToken: vi.fn(),
}))

type AsrCallbacks = {
  onReady: () => void
  onPartial: (text: string) => void
  onFinal: (text: string, index: number) => void
  onEnd: (transcript: string) => void
  onError: (code: string, message: string) => void
}

type StubClient = {
  options: AsrCallbacks
  audio: Buffer[]
  finished: boolean
  closed: boolean
}

const stubClients: StubClient[] = []

function createStubClient(options: AsrCallbacks) {
  const stub: StubClient = {
    options,
    audio: [],
    finished: false,
    closed: false,
  }
  stubClients.push(stub)
  return {
    sendAudio(frame: Buffer | Uint8Array | ArrayBuffer) {
      const buf = Buffer.isBuffer(frame)
        ? frame
        : frame instanceof ArrayBuffer
          ? Buffer.from(frame)
          : Buffer.from(frame)
      stub.audio.push(buf)
    },
    finish() {
      stub.finished = true
    },
    close() {
      stub.closed = true
    },
    get closed() {
      return stub.closed
    },
  }
}

vi.mock('../services/voice-asr.js', () => ({
  getDefaultRealtimeAsrProvider: vi.fn(() => 'dashscope'),
  createRealtimeAsrClient: vi.fn((options: AsrCallbacks) => createStubClient(options)),
  createDashScopeRealtimeAsrClient: vi.fn((options: AsrCallbacks) => createStubClient(options)),
}))

import { voiceAsrWsRoutes } from '../routes/voice-asr-ws.js'

type PendingFrame = { type: string } & Record<string, unknown>

async function collectFrames(socket: WebSocket, count: number, timeoutMs = 2_000) {
  const frames: PendingFrame[] = []
  return new Promise<PendingFrame[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${count} frames, got ${frames.length}`))
    }, timeoutMs)
    const handler = (raw: WebSocket.RawData) => {
      const text = typeof raw === 'string' ? raw : raw.toString()
      try {
        const parsed = JSON.parse(text) as PendingFrame
        frames.push(parsed)
        if (frames.length >= count) {
          clearTimeout(timer)
          socket.off('message', handler)
          resolve(frames)
        }
      } catch {
        // ignore
      }
    }
    socket.on('message', handler)
  })
}

async function waitOpen(socket: WebSocket) {
  if (socket.readyState === socket.OPEN) return
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', (error) => reject(error))
  })
}

describe('Voice ASR WebSocket route', () => {
  let app: FastifyInstance
  let port: number

  beforeEach(async () => {
    stubClients.length = 0
    app = Fastify()
    await app.register(websocket)
    await app.register(voiceAsrWsRoutes, { prefix: '/voice' })
    await app.listen({ port: 0 })
    const address = app.server.address()
    if (!address || typeof address !== 'object') {
      throw new Error('failed to get server address')
    }
    port = address.port
  })

  afterEach(async () => {
    await app.close()
  })

  it('rejects connection without token', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/voice/asr`)
    await new Promise<void>((resolve) => {
      socket.once('close', (code) => {
        expect(code).toBe(4001)
        resolve()
      })
    })
  })

  it('rejects invalid token', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/voice/asr?token=bad`)
    await new Promise<void>((resolve) => {
      socket.once('close', (code) => {
        expect(code).toBe(4001)
        resolve()
      })
    })
  })

  it('relays partial / final / end frames from upstream', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/voice/asr?token=valid-token`)
    await waitOpen(socket)

    socket.send(
      JSON.stringify({
        type: 'start',
        sessionId: 's1',
        lang: 'zh-CN',
        sampleRate: 16000,
        encoding: 'pcm16le',
      }),
    )

    while (stubClients.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const stub = stubClients[0]!

    const readyPromise = collectFrames(socket, 1)
    stub.options.onReady()
    const [readyFrame] = await readyPromise
    expect(readyFrame?.type).toBe('ready')

    socket.send(Buffer.alloc(128, 1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stub.audio.length).toBe(1)
    expect(stub.audio[0]?.byteLength).toBe(128)

    const partialPromise = collectFrames(socket, 1)
    stub.options.onPartial('你好')
    const [partialFrame] = await partialPromise
    expect(partialFrame).toEqual({ type: 'partial', text: '你好' })

    const finalPromise = collectFrames(socket, 1)
    stub.options.onFinal('你好世界', 0)
    const [finalFrame] = await finalPromise
    expect(finalFrame).toEqual({ type: 'final', text: '你好世界', index: 0 })

    socket.send(JSON.stringify({ type: 'stop' }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(stub.finished).toBe(true)

    const endPromise = collectFrames(socket, 1)
    stub.options.onEnd('你好世界。')
    const [endFrame] = await endPromise
    expect(endFrame).toEqual({ type: 'end', transcript: '你好世界。' })

    await new Promise<void>((resolve) => {
      if (socket.readyState === socket.CLOSED) return resolve()
      socket.once('close', () => resolve())
    })
  })

  it('propagates upstream error frames and closes', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/voice/asr?token=valid-token`)
    await waitOpen(socket)
    socket.send(
      JSON.stringify({
        type: 'start',
        sessionId: 's1',
        lang: 'zh',
      }),
    )
    while (stubClients.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const stub = stubClients[0]!

    const errorPromise = collectFrames(socket, 1)
    stub.options.onError('upstream_failed', 'boom')
    const [frame] = await errorPromise
    expect(frame).toEqual({ type: 'error', code: 'upstream_failed', message: 'boom' })

    await new Promise<void>((resolve) => {
      if (socket.readyState === socket.CLOSED) return resolve()
      socket.once('close', () => resolve())
    })
  })

  it('rejects stop before start', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/voice/asr?token=valid-token`)
    await waitOpen(socket)

    const errPromise = collectFrames(socket, 1)
    socket.send(JSON.stringify({ type: 'stop' }))
    const [frame] = await errPromise
    expect(frame).toEqual({ type: 'error', code: 'bad_request', message: 'stop before start' })
  })

  it('responds to ping with pong', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/voice/asr?token=valid-token`)
    await waitOpen(socket)

    socket.send(
      JSON.stringify({
        type: 'start',
        sessionId: 's1',
      }),
    )
    while (stubClients.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const pong = collectFrames(socket, 1)
    socket.send(JSON.stringify({ type: 'ping' }))
    const [frame] = await pong
    expect(frame).toEqual({ type: 'pong' })

    socket.close()
  })

})
