// @arch docs/architecture/app/chat-voice-draft.md

import { getServerUrl } from '../../../config/server'

export type AsrClientPhase = 'connecting' | 'ready' | 'stopping' | 'closed'

export interface AsrClientCallbacks {
  onReady: () => void
  onPartial: (text: string) => void
  onFinal: (text: string, index: number) => void
  onEnd: (transcript: string) => void
  onError: (code: string, message: string) => void
  onClose: () => void
}

export interface AsrClientOptions {
  token: string
  sessionId: string
  lang?: string
  sampleRate?: number
}

export interface AsrClient {
  sendAudio(frame: Uint8Array | ArrayBuffer): void
  finish(): void
  close(): void
  readonly phase: AsrClientPhase
}

type ServerFrame =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; index: number }
  | { type: 'end'; transcript: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

const PING_INTERVAL_MS = 5_000

function buildAsrWsUrl(token: string): string {
  const base = getServerUrl()
  const url = new URL(base)
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  const prefix = isLocalhost ? '' : '/api'
  return `${protocol}//${url.host}${prefix}/voice/asr?token=${encodeURIComponent(token)}`
}

function tryParse(data: string): ServerFrame | null {
  try {
    const parsed = JSON.parse(data) as ServerFrame
    if (!parsed || typeof (parsed as { type?: unknown }).type !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function createAsrClient(
  options: AsrClientOptions,
  callbacks: AsrClientCallbacks,
): AsrClient {
  const socket = new WebSocket(buildAsrWsUrl(options.token))
  socket.binaryType = 'arraybuffer'
  let phase: AsrClientPhase = 'connecting'
  const pending: ArrayBuffer[] = []
  let pingTimer: ReturnType<typeof setInterval> | null = null

  function stopPingTimer() {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function closeSocket() {
    stopPingTimer()
    try {
      socket.close()
    } catch {
      // noop
    }
  }

  function handleFrame(frame: ServerFrame) {
    switch (frame.type) {
      case 'ready':
        phase = 'ready'
        callbacks.onReady()
        for (const buffer of pending.splice(0)) {
          socket.send(buffer)
        }
        return
      case 'partial':
        callbacks.onPartial(frame.text)
        return
      case 'final':
        callbacks.onFinal(frame.text, frame.index)
        return
      case 'end':
        callbacks.onEnd(frame.transcript)
        closeSocket()
        return
      case 'error':
        callbacks.onError(frame.code, frame.message)
        closeSocket()
        return
      case 'pong':
        return
      default:
        return
    }
  }

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        type: 'start',
        sessionId: options.sessionId,
        lang: options.lang ?? 'zh-CN',
        sampleRate: options.sampleRate ?? 16000,
        encoding: 'pcm16le',
      }),
    )
    pingTimer = setInterval(() => {
      if (socket.readyState !== socket.OPEN) return
      try {
        socket.send(JSON.stringify({ type: 'ping' }))
      } catch {
        // noop
      }
    }, PING_INTERVAL_MS)
  }

  socket.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const frame = tryParse(event.data)
      if (frame) handleFrame(frame)
    }
  }

  socket.onerror = () => {
    if (phase === 'closed') return
    callbacks.onError('connection_error', 'ws connection error')
  }

  socket.onclose = () => {
    if (phase === 'closed') return
    phase = 'closed'
    stopPingTimer()
    callbacks.onClose()
  }

  return {
    sendAudio(frame) {
      if (phase === 'closed' || phase === 'stopping') return
      let buffer: ArrayBuffer
      if (frame instanceof ArrayBuffer) {
        buffer = frame
      } else {
        const copy = new ArrayBuffer(frame.byteLength)
        new Uint8Array(copy).set(frame)
        buffer = copy
      }
      if (phase === 'connecting') {
        pending.push(buffer)
        return
      }
      if (socket.readyState !== socket.OPEN) return
      try {
        socket.send(buffer)
      } catch {
        // noop
      }
    },
    finish() {
      if (phase === 'closed' || phase === 'stopping') return
      phase = 'stopping'
      if (socket.readyState !== socket.OPEN) {
        closeSocket()
        return
      }
      try {
        socket.send(JSON.stringify({ type: 'stop' }))
      } catch {
        closeSocket()
      }
    },
    close() {
      if (phase === 'closed') return
      phase = 'closed'
      closeSocket()
    },
    get phase() {
      return phase
    },
  }
}
