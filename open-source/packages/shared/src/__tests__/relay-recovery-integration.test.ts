// @arch open-source/docs/shared-runtime.md
// @covers open-source/packages/shared/src/relay.ts

import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import NodeWebSocket, { WebSocketServer } from 'ws'
import { MultiplexRelayClient } from '../relay'

const originalWebSocket = globalThis.WebSocket

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind')
  return address.port
}

async function closeServer(server: Server, webSockets: WebSocketServer): Promise<void> {
  for (const socket of webSockets.clients) socket.terminate()
  await new Promise<void>((resolve) => webSockets.close(() => resolve()))
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
})

describe('MultiplexRelayClient recovery integration', () => {
  it('recovers when the proxy returns a temporary 502 during the WebSocket handshake', async () => {
    globalThis.WebSocket = NodeWebSocket as unknown as typeof WebSocket
    const server = createServer()
    const webSockets = new WebSocketServer({ noServer: true })
    let upgrades = 0
    server.on('upgrade', (request, socket, head) => {
      upgrades += 1
      if (upgrades === 1) {
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      webSockets.handleUpgrade(request, socket, head, (client) => {
        client.send(JSON.stringify({ type: 'event', event: 'tick', payload: { ts: Date.now() } }))
        webSockets.emit('connection', client, request)
      })
    })
    const port = await listen(server)

    let resolveConnected!: () => void
    const connected = new Promise<void>((resolve) => { resolveConnected = resolve })
    const client = new MultiplexRelayClient({
      url: `ws://127.0.0.1:${port}/relay/client`,
      token: 'test-token',
      onConnected: resolveConnected,
    })
    client.connect()

    await Promise.race([
      connected,
      new Promise((_, reject) => setTimeout(() => reject(new Error('reconnect timed out')), 4_000)),
    ])
    expect(upgrades).toBeGreaterThanOrEqual(2)
    expect(client.getConnectivitySnapshot().phase).toBe('connected')

    client.disconnect()
    await closeServer(server, webSockets)
  })

  it('restores the account socket after an established server connection is terminated', async () => {
    globalThis.WebSocket = NodeWebSocket as unknown as typeof WebSocket
    const server = createServer()
    const webSockets = new WebSocketServer({ noServer: true })
    let connections = 0
    server.on('upgrade', (request, socket, head) => {
      webSockets.handleUpgrade(request, socket, head, (client) => {
        webSockets.emit('connection', client, request)
      })
    })
    webSockets.on('connection', (socket) => {
      connections += 1
      socket.send(JSON.stringify({ type: 'event', event: 'tick', payload: { ts: Date.now() } }))
      if (connections === 1) setTimeout(() => socket.terminate(), 10)
    })
    const port = await listen(server)

    let resolveRecovered!: () => void
    const recovered = new Promise<void>((resolve) => { resolveRecovered = resolve })
    const client = new MultiplexRelayClient({
      url: `ws://127.0.0.1:${port}/relay/client`,
      token: 'test-token',
      onConnected: () => {
        if (connections >= 2) resolveRecovered()
      },
    })
    client.connect()

    await Promise.race([
      recovered,
      new Promise((_, reject) => setTimeout(() => reject(new Error('recovery timed out')), 4_000)),
    ])
    expect(connections).toBeGreaterThanOrEqual(2)
    expect(client.getConnectivitySnapshot().phase).toBe('connected')

    client.disconnect()
    await closeServer(server, webSockets)
  })
})
