// @covers open-source/packages/server/src/relay/handler.ts

import WebSocket from 'ws'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    machine: { findUnique: mockFindUnique },
  },
}))

import { authorizeRemoteAccessPauseRequest } from '../relay/handler.js'

function createSocket() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
  } as unknown as WebSocket
}

const request = {
  type: 'req' as const,
  id: 'pause-1',
  method: 'machine.remote-access.pause' as const,
  params: {},
}

describe('remote pause relay authorization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows only the online machine owner', async () => {
    mockFindUnique.mockResolvedValue({ userId: 'owner-1', online: true })
    const socket = createSocket()

    await expect(authorizeRemoteAccessPauseRequest(
      socket, 'legacy', 'machine-1', 'owner-1', request,
    )).resolves.toBe(true)
    expect(socket.send).not.toHaveBeenCalled()
  })

  it('rejects a grantee even when the grant has admin permission', async () => {
    mockFindUnique.mockResolvedValue({ userId: 'owner-1', online: true })
    const socket = createSocket()

    await expect(authorizeRemoteAccessPauseRequest(
      socket, 'multiplex', 'machine-1', 'grantee-1', request,
    )).resolves.toBe(false)
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('machine_owner_required'))
  })

  it('rejects offline machines instead of creating a delayed command', async () => {
    mockFindUnique.mockResolvedValue({ userId: 'owner-1', online: false })
    const socket = createSocket()

    await expect(authorizeRemoteAccessPauseRequest(
      socket, 'legacy', 'machine-1', 'owner-1', request,
    )).resolves.toBe(false)
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('machine_offline'))
  })
})
