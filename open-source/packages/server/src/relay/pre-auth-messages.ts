// @arch open-source/docs/server-runtime.md
// @test src/__tests__/pre-auth-messages.test.ts
import WebSocket, { type RawData } from 'ws'

const MAX_PENDING_CONNECTIONS = 256
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024
let pendingConnections = 0
let bufferedBytes = 0

type MessageHandler = (data: RawData, isBinary: boolean) => void

/** Capture synchronously, but never dispatch until the caller finishes every auth guard. */
export function capturePreAuthMessages(
  socket: WebSocket,
  limits = { frames: 32, bytes: 1024 * 1024, timeoutMs: 15_000 },
): { activate: (handler: MessageHandler) => void } {
  if (socket.readyState !== WebSocket.OPEN) return { activate() {} }
  if (pendingConnections >= MAX_PENDING_CONNECTIONS) {
    socket.close(1008, 'authentication_pending_limit')
    return { activate() {} }
  }
  pendingConnections++
  let queue: Array<[RawData, boolean]> = []
  let bytes = 0
  let finished = false
  const sizeOf = (data: RawData) => Array.isArray(data)
    ? data.reduce((size, part) => size + part.byteLength, 0)
    : data.byteLength

  function discard() {
    if (finished) return
    finished = true
    pendingConnections--
    bufferedBytes -= bytes
    queue = []
    bytes = 0
    clearTimeout(timer)
    socket.off('message', capture)
    socket.off('close', discard)
  }
  function reject(reason: string) {
    discard()
    if (socket.readyState === WebSocket.OPEN) socket.close(1008, reason)
  }
  function capture(data: RawData, isBinary: boolean) {
    const size = sizeOf(data)
    if (queue.length >= limits.frames || size > limits.bytes - bytes || size > MAX_BUFFERED_BYTES - bufferedBytes) {
      reject('authentication_message_buffer_limit')
      return
    }
    bytes += size
    bufferedBytes += size
    queue.push([data, isBinary])
  }
  const timer = setTimeout(() => reject('authentication_timeout'), limits.timeoutMs)
  timer.unref()
  socket.on('message', capture)
  socket.once('close', discard)

  return {
    activate(handler) {
      if (finished || socket.readyState !== WebSocket.OPEN) { discard(); return }
      const buffered = queue
      discard()
      // No await between listener replacement and replay: no lost or duplicate live frames.
      socket.on('message', handler)
      for (const [data, isBinary] of buffered) {
        if (socket.readyState !== WebSocket.OPEN) break
        handler(data, isBinary)
      }
    },
  }
}
