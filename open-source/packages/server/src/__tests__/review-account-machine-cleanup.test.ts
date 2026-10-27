// @covers open-source/packages/server/src/services/review-account-machine-cleanup.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockConnections, mockRedis } = vi.hoisted(() => {
  const prisma = {
    user: { findMany: vi.fn() },
    machine: { findMany: vi.fn(), updateMany: vi.fn() },
    machineGrant: { count: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  }
  return {
    mockPrisma: prisma,
    mockConnections: {
      getMachine: vi.fn(),
      getClients: vi.fn(),
      removeMachine: vi.fn(),
    },
    mockRedis: { del: vi.fn() },
  }
})

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/redis.js', () => ({ redis: mockRedis }))
vi.mock('../relay/connections.js', () => ({ connections: mockConnections }))

import { cleanupReviewAccountMachines } from '../services/review-account-machine-cleanup.js'

describe('review account machine cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'review-1' }])
    mockPrisma.machine.findMany.mockResolvedValue([{
      id: 'machine-1', paired: true, online: true,
      machineToken: 'machine-secret', pairToken: 'pair-secret',
    }])
    mockPrisma.machineGrant.count.mockResolvedValue(1)
    mockPrisma.machineGrant.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.$transaction.mockImplementation((run) => run(mockPrisma))
    mockConnections.getMachine.mockReturnValue(undefined)
    mockConnections.getClients.mockReturnValue(undefined)
  })

  it('audits exact review-owned machines without changing data or exposing tokens', async () => {
    const report = await cleanupReviewAccountMachines()

    expect(report).toMatchObject({
      mode: 'audit', reviewAccounts: 1, machines: 1, machineTokens: 1,
      pairTokens: 1, pairedMachines: 1, onlineMachines: 1, activeGrants: 1,
      revokedMachines: 0,
    })
    expect(JSON.stringify(report)).not.toContain('machine-secret')
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('revokes only the audited machine capabilities and closes existing sockets', async () => {
    const machineSocket = { close: vi.fn() }
    const clientSocket = { close: vi.fn() }
    mockConnections.getMachine.mockReturnValue(machineSocket)
    mockConnections.getClients.mockReturnValue(new Set([clientSocket]))

    const report = await cleanupReviewAccountMachines({ apply: true })

    expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['machine-1'] } },
      data: expect.objectContaining({
        machineToken: null, pairToken: null, paired: false, online: false,
      }),
    })
    expect(mockPrisma.machineGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { machineId: { in: ['machine-1'] }, revokedAt: null },
    }))
    expect(machineSocket.close).toHaveBeenCalledWith(4403, 'review_account_machine_access_forbidden')
    expect(clientSocket.close).toHaveBeenCalledWith(4403, 'review_account_machine_access_forbidden')
    expect(mockRedis.del).toHaveBeenCalledWith('machine:machine-1:region')
    expect(report).toMatchObject({ revokedMachines: 1, revokedGrants: 1, disconnectedSockets: 2 })
  })
})
