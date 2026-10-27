// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/pre-auth-messages.ts
import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'
import WebSocket from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePreAuthMessages } from '../relay/pre-auth-messages.js'

class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = WebSocket.CLOSED
    this.emit('close')
  })
  asWebSocket() { return this as unknown as WebSocket }
  receive(value: string) { this.emit('message', Buffer.from(value), false) }
}
const limits = { frames: 2, bytes: 10, timeoutMs: 100 }
afterEach(() => vi.useRealTimers())

describe('messages received while authentication is pending', () => {
  it('buffers the immediate first frame and dispatches only after async authentication', async () => {
    const socket = new Socket(), handler = vi.fn()
    const buffer = capturePreAuthMessages(socket.asWebSocket())
    socket.receive('first')
    await Promise.resolve()
    socket.receive('second')
    expect(handler).not.toHaveBeenCalled()
    buffer.activate(handler)
    socket.receive('third')
    expect(handler.mock.calls.map(([data]) => data.toString())).toEqual(['first', 'second', 'third'])
    expect(socket.listenerCount('message')).toBe(1)
    expect(socket.listenerCount('close')).toBe(0)
  })
  it('does not replay when authentication rejects and closes the socket', () => {
    const socket = new Socket(), handler = vi.fn(), buffer = capturePreAuthMessages(socket.asWebSocket())
    socket.receive('request')
    socket.close(4401)
    buffer.activate(handler)
    expect(handler).not.toHaveBeenCalled()
    expect(socket.listenerCount('message')).toBe(0)
  })
  it('bounds the number of unauthenticated frames and never dispatches overflow', () => {
    const socket = new Socket(), handler = vi.fn(), buffer = capturePreAuthMessages(socket.asWebSocket(), limits)
    socket.receive('a'); socket.receive('b'); socket.receive('c')
    buffer.activate(handler)
    expect(socket.close).toHaveBeenCalledWith(1008, 'authentication_message_buffer_limit')
    expect(handler).not.toHaveBeenCalled()
  })
  it('bounds total bytes including fragmented and binary data', () => {
    for (const data of [[Buffer.alloc(5), Buffer.alloc(6)], new ArrayBuffer(11)]) {
      const socket = new Socket(), handler = vi.fn(), buffer = capturePreAuthMessages(socket.asWebSocket(), limits)
      socket.emit('message', data, true)
      buffer.activate(handler)
      expect(socket.close).toHaveBeenCalledWith(1008, 'authentication_message_buffer_limit')
      expect(handler).not.toHaveBeenCalled()
    }
  })
  it('accepts the exact byte boundary and preserves binary flags', () => {
    const socket = new Socket(), handler = vi.fn(), buffer = capturePreAuthMessages(socket.asWebSocket(), limits)
    const data = Buffer.alloc(10)
    socket.emit('message', data, true)
    buffer.activate(handler)
    expect(handler).toHaveBeenCalledExactlyOnceWith(data, true)
  })
  it('closes stalled authentication and does not leave a timer after activation', () => {
    vi.useFakeTimers()
    const socket = new Socket(), handler = vi.fn(), buffer = capturePreAuthMessages(socket.asWebSocket(), limits)
    socket.receive('pending')
    vi.advanceTimersByTime(100)
    buffer.activate(handler)
    expect(socket.close).toHaveBeenCalledWith(1008, 'authentication_timeout')
    expect(handler).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    const accepted = new Socket()
    capturePreAuthMessages(accepted.asWebSocket(), limits).activate(handler)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cannot activate twice or dispatch after the first replay closes the socket', () => {
    const socket = new Socket(), handler = vi.fn(() => socket.close()), buffer = capturePreAuthMessages(socket.asWebSocket())
    socket.receive('first'); socket.receive('second')
    buffer.activate(handler); buffer.activate(handler)
    expect(handler).toHaveBeenCalledTimes(1)
  })
  it('caps aggregate unauthenticated bytes and releases the budget on close', () => {
    const sockets: Socket[] = []
    const data = Buffer.alloc(1024 * 1024)
    try {
      for (let i = 0; i < 17; i++) {
        const socket = new Socket()
        sockets.push(socket)
        capturePreAuthMessages(socket.asWebSocket())
        socket.emit('message', data, true)
      }
      expect(sockets.slice(0, 16).every(s => s.readyState === WebSocket.OPEN)).toBe(true)
      expect(sockets[16].close).toHaveBeenCalledWith(1008, 'authentication_message_buffer_limit')
    } finally { for (const s of sockets) s.close() }
    const next = new Socket(), handler = vi.fn()
    const buffer = capturePreAuthMessages(next.asWebSocket())
    next.emit('message', data, true)
    buffer.activate(handler)
    expect(handler).toHaveBeenCalledOnce()
  })
  it('caps simultaneous pending authentication without allocating another queue', () => {
    const sockets: Socket[] = []
    try {
      for (let i = 0; i < 257; i++) {
        const socket = new Socket()
        sockets.push(socket)
        capturePreAuthMessages(socket.asWebSocket())
      }
      expect(sockets[256].close).toHaveBeenCalledWith(1008, 'authentication_pending_limit')
      expect(sockets[256].listenerCount('message')).toBe(0)
    } finally { for (const s of sockets) s.close() }
    const next = new Socket()
    capturePreAuthMessages(next.asWebSocket()).activate(vi.fn())
    expect(next.close).not.toHaveBeenCalled()
  })

})
