// @covers open-source/packages/server/src/relay/handler.ts

import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    machine: { findUnique: vi.fn() },
    device: { findUnique: vi.fn() },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/jwt.js', () => ({
  verifyMachineToken: vi.fn((token: string) => token === 'machine-token'
    ? { machineId: 'machine-1' }
    : null),
  verifyToken: vi.fn((token: string) => token === 'review-token'
    ? { userId: 'review-user', deviceId: 'device-1' }
    : null),
}))
vi.mock('../services/review-account-policy.js', () => ({
  REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR: 'review_account_machine_access_forbidden',
  isReviewAccountUserId: vi.fn(async (userId?: string) => userId === 'review-user'),
}))

import {
  handleClientConnection,
  handleMachineConnection,
  handleMultiplexClientConnection,
} from '../relay/handler.js'

function socket() {
  const socket = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN as number,
    close: vi.fn(() => { socket.readyState = WebSocket.CLOSED; socket.emit('close') }),
  })
  return socket
}

function request(url: string, params?: { machineId: string }) {
  return {
    url,
    params,
    ip: '127.0.0.1',
    log: { info: vi.fn(), warn: vi.fn() },
  }
}

describe('review account Relay boundary', () => {
  it('rejects review-owned machine connections before registration', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({
      id: 'machine-1', userId: 'review-user', machineToken: 'machine-token',
      daemonInstallationId: 'install-1',
    })
    const ws = socket()

    await handleMachineConnection(ws as never, request('/relay/machine?token=machine-token') as never)

    expect(ws.close).toHaveBeenCalledWith(4403, 'review_account_machine_access_forbidden')
  })

  it.each([
    ['legacy', handleClientConnection, { machineId: 'machine-1' }],
    ['multiplex', handleMultiplexClientConnection, undefined],
  ] as const)('rejects %s review clients before subscription', async (_mode, handler, params) => {
    mockPrisma.device.findUnique.mockResolvedValue({
      platform: 'ios', tokenExpiry: new Date(Date.now() + 60_000),
    })
    const ws = socket()

    await handler(
      ws as never,
      request('/relay/client?token=review-token', params) as never,
    )

    expect(ws.close).toHaveBeenCalledWith(4403, 'review_account_machine_access_forbidden')
  })
})
