// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-asr-ws.test.ts

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket, RawData } from 'ws'
import { verifyToken } from '../services/jwt.js'
import {
  createRealtimeAsrClient,
  createDashScopeRealtimeAsrClient,
  getDefaultRealtimeAsrProvider,
  type AsrErrorCode,
  type AsrProvider,
  type RealtimeAsrClient,
  type RealtimeAsrOptions,
} from '../services/voice-asr.js'
import { isDiagnosticUserId } from '../services/log-policy.js'

const START_TIMEOUT_MS = 3_000
const CLIENT_IDLE_MS = 30_000
const MAX_FRAME_BYTES = 20 * 1024

type ClientFrame =
  | { type: 'start'; sessionId?: string; lang?: string; sampleRate?: number; encoding?: string }
  | { type: 'stop' }
  | { type: 'ping' }

type ServerFrame =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; index: number }
  | { type: 'end'; transcript: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

function extractToken(request: FastifyRequest): string | null {
  const url = new URL(request.url, 'http://localhost')
  const token = url.searchParams.get('token')
  return token?.trim() || null
}

function send(socket: WebSocket, frame: ServerFrame) {
  if (socket.readyState !== socket.OPEN) return
  try {
    socket.send(JSON.stringify(frame))
  } catch {
    // If writing fails the socket is already gone; further cleanup happens in close handler.
  }
}

function tryParse(data: string): ClientFrame | null {
  try {
    const parsed = JSON.parse(data) as ClientFrame
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function handleVoiceAsrConnection(
  socket: WebSocket,
  request: FastifyRequest,
  provider: AsrProvider | 'auto' = 'auto',
): void {
  const token = extractToken(request)
  if (!token) {
    socket.close(4001, 'Missing token')
    return
  }
  const payload = verifyToken(token)
  if (!payload) {
    socket.close(4001, 'Invalid token')
    return
  }
  const userId = payload.userId

  let started = false
  let closed = false
  let startTimer: NodeJS.Timeout | null = null
  let idleTimer: NodeJS.Timeout | null = null
  let upstream: RealtimeAsrClient | null = null

  function cleanup() {
    if (closed) return
    closed = true
    if (startTimer) clearTimeout(startTimer)
    if (idleTimer) clearTimeout(idleTimer)
    startTimer = null
    idleTimer = null
    if (upstream && !upstream.closed) {
      upstream.close()
    }
  }

  function sendError(code: AsrErrorCode | string, message: string) {
    send(socket, { type: 'error', code, message })
  }

  function kickIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (closed) return
      sendError('client_idle', 'no audio received for 30s')
      socket.close()
  }, CLIENT_IDLE_MS)
  }

  startTimer = setTimeout(() => {
    if (started || closed) return
    sendError('bad_request', 'start frame not received in 3s')
    socket.close()
  }, START_TIMEOUT_MS)

  async function startUpstream(options: { sampleRate: number; languageHints: string[] }) {
    const resolvedProvider = provider === 'auto' ? getDefaultRealtimeAsrProvider() : provider
    const finalSegments: string[] = []
    let ended = false

    const buildFinalTranscript = () => finalSegments.filter(Boolean).join('').trim()

    request.log.info(
      {
        userId,
        provider: resolvedProvider,
        requestedProvider: provider,
        sampleRate: options.sampleRate,
        languageHints: options.languageHints,
      },
      'voice asr upstream start',
    )
    const clientOptions: RealtimeAsrOptions = {
      sampleRate: options.sampleRate,
      languageHints: options.languageHints,
      onReady: () => {
        request.log.info({ userId, provider: resolvedProvider }, 'voice asr upstream ready')
        send(socket, { type: 'ready' })
      },
      onPartial: (text) => {
        send(socket, { type: 'partial', text })
      },
      onFinal: (text, index) => {
        const finalText = text.trim()
        if (!finalText || ended) return
        finalSegments[index] = finalText
        send(socket, { type: 'final', text: finalText, index })
      },
      onEnd: (transcript) => {
        if (ended) return
        ended = true
        const finalTranscript = transcript.trim() || buildFinalTranscript()
        request.log.info(
          { userId, provider: resolvedProvider, transcriptLength: finalTranscript.length },
          'voice asr upstream end',
        )
        send(socket, { type: 'end', transcript: finalTranscript })
        socket.close()
      },
      onError: (code, message) => {
        request.log.warn(
          { userId, provider: resolvedProvider, code, message },
          'voice asr upstream error',
        )
        sendError(code, message)
        socket.close()
      },
      onDebug: (event, payload) => {
        if (isDiagnosticUserId(userId)) {
          request.log.info({ userId, provider: resolvedProvider, event, payload }, 'voice asr upstream debug')
        }
      },
    }

    upstream =
      provider === 'dashscope'
        ? createDashScopeRealtimeAsrClient(clientOptions)
        : createRealtimeAsrClient(clientOptions)
  }

  socket.on('message', (raw: RawData, isBinary: boolean) => {
    if (closed) return

    if (isBinary) {
      if (!started || !upstream) return
      const buffer =
        raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : (raw as Buffer)
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_FRAME_BYTES) {
        sendError('bad_request', `invalid binary frame size ${buffer.byteLength}`)
        socket.close()
        return
      }
      upstream.sendAudio(buffer)
      kickIdleTimer()
      return
    }

    const text = raw.toString()
    const frame = tryParse(text)
    if (!frame) {
      sendError('bad_request', 'invalid json frame')
      socket.close()
      return
    }

    if (frame.type === 'ping') {
      send(socket, { type: 'pong' })
      return
    }

    if (frame.type === 'start') {
      if (started) {
        sendError('bad_request', 'duplicate start frame')
        socket.close()
        return
      }
      if (frame.encoding && frame.encoding !== 'pcm16le') {
        sendError('bad_request', `unsupported encoding ${frame.encoding}`)
        socket.close()
        return
      }
      started = true
      if (startTimer) {
        clearTimeout(startTimer)
        startTimer = null
      }
      kickIdleTimer()
      void startUpstream({
        sampleRate: typeof frame.sampleRate === 'number' ? frame.sampleRate : 16_000,
        languageHints: frame.lang ? [frame.lang.split('-')[0]!] : ['zh', 'en'],
      })
      return
    }

    if (frame.type === 'stop') {
      if (!started || !upstream) {
        sendError('bad_request', 'stop before start')
        socket.close()
        return
      }
      upstream.finish()
      return
    }

    sendError('bad_request', `unknown frame type`)
    socket.close()
  })

  socket.on('close', () => {
    cleanup()
  })

  socket.on('error', () => {
    cleanup()
  })
}

export async function voiceAsrWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/asr', { websocket: true }, (socket, request) => {
    handleVoiceAsrConnection(socket as unknown as WebSocket, request, 'auto')
  })

  app.get('/asr-dashscope', { websocket: true }, (socket, request) => {
    handleVoiceAsrConnection(socket as unknown as WebSocket, request, 'dashscope')
  })
}
