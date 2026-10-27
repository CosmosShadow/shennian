// @covers open-source/packages/server/src/routes/machines.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const { mockPrisma } = vi.hoisted(() => {
  const tx = {
    nianSession: { deleteMany: vi.fn() },
    machineGrant: { deleteMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    qrSession: { deleteMany: vi.fn(), update: vi.fn() },
    machine: { delete: vi.fn(), update: vi.fn() },
  }

  return {
    mockPrisma: {
      user: { findUnique: vi.fn() },
      device: { findUnique: vi.fn() },
      machine: {
        findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(),
      },
      qrSession: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      machineGrant: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof tx) => unknown) => await fn(tx)),
      __tx: tx,
    },
  }
})

const { mockRedis, mockMachineSocket, mockClientSocket, mockConnections } = vi.hoisted(() => {
  const machineSocket = { close: vi.fn() }
  const clientSocket = { close: vi.fn() }
  return {
    mockRedis: { get: vi.fn(), del: vi.fn() },
    mockMachineSocket: machineSocket,
    mockClientSocket: clientSocket,
    mockConnections: {
      getMachine: vi.fn(() => machineSocket),
      getClients: vi.fn(() => new Set([clientSocket])),
      removeMachine: vi.fn(),
    },
  }
})

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/redis.js', () => ({ redis: mockRedis }))
vi.mock('../relay/connections.js', () => ({ connections: mockConnections }))
vi.mock('../relay/connection-control.js', () => ({ publishMachineAccessRevoked: vi.fn() }))
vi.mock('../services/jwt.js', () => ({
  signMachineToken: vi.fn(() => 'machine-token'),
  verifyToken: vi.fn((token: string) => {
    if (token === 'owner-token') return { userId: 'user-1', deviceId: 'device-1' }
    if (token === 'grantee-token') return { userId: 'user-2', deviceId: 'device-1' }
    return null
  }),
  verifyMachineToken: vi.fn((token: string) => (
    token === 'machine-auth-token' ? { machineId: 'machine-identity', type: 'machine' } : null
  )),
}))

const { mockCleanupRetiredExternalChannelMachineData } = vi.hoisted(() => ({
  mockCleanupRetiredExternalChannelMachineData: vi.fn(async () => undefined),
}))

const { mockRemoveOwnedMachine } = vi.hoisted(() => ({
  mockRemoveOwnedMachine: vi.fn(async () => ({ affectedBindingIds: [], affectedRoomIds: [] })),
}))

vi.mock('../services/retired-external-channel-data.js', () => ({
  cleanupRetiredExternalChannelMachineData: mockCleanupRetiredExternalChannelMachineData,
}))
vi.mock('../services/machine-removal.js', () => ({
  removeOwnedMachine: mockRemoveOwnedMachine,
}))

import { machineRoutes } from '../routes/machines.js'

describe('Machine routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.stubEnv('SHENNIAN_REVIEW_ACCOUNT_PHONES', '+8619900000002')
    vi.stubEnv('SHENNIAN_REVIEW_LOGIN_CODE', '654321')
    vi.clearAllMocks()
    mockPrisma.machine.findUnique.mockResolvedValue(null)
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8613900000000' })
    mockPrisma.device.findUnique.mockResolvedValue({
      id: 'device-1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })

    app = Fastify()
    await app.register(machineRoutes, { prefix: '/machines' })
    await app.register(machineRoutes, { prefix: '/api/machines' })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it.each(['/machines/identity', '/api/machines/identity'])(
    'returns the stable installation and authoritative epoch only to the machine at %s',
    async (url) => {
    mockPrisma.machine.findUnique.mockResolvedValue({
      id: 'machine-identity', userId: 'user-1', daemonInstallationId: 'installation-1',
      sessionSyncDataEpoch: null,
    })

    const response = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: 'Bearer machine-auth-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      machineId: 'machine-identity',
      daemonInstallationId: 'installation-1',
      dataEpoch: 2,
    })
    },
  )

  it('owner unbind preserves the stable machine identity and local-canonical metadata', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({
      id: 'machine-1',
      userId: 'user-1',
    })

    const res = await app.inject({
      method: 'DELETE',
      url: '/machines/machine-1',
      headers: { authorization: 'Bearer owner-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockCleanupRetiredExternalChannelMachineData).toHaveBeenCalledWith('machine-1')
    expect(mockRemoveOwnedMachine).toHaveBeenCalledWith('machine-1', 'user-1')
    expect(mockPrisma.__tx.machine.delete).not.toHaveBeenCalled()
  })

  it('desktop register creates a paired machine for the signed-in account', async () => {
    mockPrisma.machine.create.mockResolvedValue({
      id: 'machine-1',
      userId: 'user-1',
      name: 'demo-mac',
      os: 'macos',
      agentList: ['codex'],
      machineToken: null,
    })
    mockPrisma.machine.update.mockResolvedValue({
      id: 'machine-1',
      userId: 'user-1',
      name: 'demo-mac',
      os: 'macos',
      agentList: ['codex'],
      machineToken: 'machine-token',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/machines/desktop/register',
      headers: { authorization: 'Bearer owner-token' },
      payload: { name: 'demo-mac', os: 'macos', agentList: ['codex'] },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.machine.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        name: 'demo-mac',
        os: 'macos',
        agentList: ['codex'],
        paired: true,
      },
    })
    expect(mockPrisma.machine.update).toHaveBeenCalledWith({
      where: { id: 'machine-1' },
      data: { machineToken: 'machine-token' },
    })
    expect(res.json()).toEqual({
      machine: {
        id: 'machine-1',
        name: 'demo-mac',
        os: 'macos',
        agentList: ['codex'],
      },
      machineToken: 'machine-token',
      accountNamespaceId: 'ae2d20e67cb664fa97a6ac6afedbd6510907f908591339547b8831c76efa4db7',
    })
  })

  it('returns no machine metadata to a restricted review account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8619900000002' })

    const res = await app.inject({
      method: 'GET',
      url: '/machines',
      headers: { authorization: 'Bearer owner-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ machines: [] })
    expect(mockPrisma.machine.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.machineGrant.findMany).not.toHaveBeenCalled()
  })

  it('rejects machine registration for a restricted review account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8619900000002' })

    const res = await app.inject({
      method: 'POST',
      url: '/machines/desktop/register',
      headers: { authorization: 'Bearer owner-token' },
      payload: { name: 'review-mac', os: 'macos', agentList: ['codex'] },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'review_account_machine_access_forbidden' })
    expect(mockPrisma.machine.create).not.toHaveBeenCalled()
  })

  it('rejects pair claims for a restricted review account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8619900000002' })

    const res = await app.inject({
      method: 'POST',
      url: '/machines/pair/claim',
      headers: { authorization: 'Bearer owner-token' },
      payload: { pairToken: 'sn-test-test-test' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'review_account_machine_access_forbidden' })
    expect(mockPrisma.qrSession.findFirst).not.toHaveBeenCalled()
  })

  it('lets the former review phone reach ordinary pairing validation', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8619900000003' })
    mockPrisma.qrSession.findFirst.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/machines/pair/claim',
      headers: { authorization: 'Bearer owner-token' },
      payload: { pairToken: 'sn-test-test-test' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Invalid or expired pair token')
    expect(mockPrisma.qrSession.findFirst).toHaveBeenCalled()
  })

  it('desktop register does not overwrite an existing machine name', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({
      id: 'machine-1',
      userId: 'user-1',
      machineToken: 'existing-token',
    })
    mockPrisma.machine.update.mockResolvedValue({
      id: 'machine-1',
      userId: 'user-1',
      name: 'MacBook Pro',
      os: 'macos',
      agentList: ['codex'],
      machineToken: 'existing-token',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/machines/desktop/register',
      headers: { authorization: 'Bearer owner-token' },
      payload: {
        machineId: 'machine-1',
        name: 'New Local Hostname',
        os: 'macos',
        agentList: ['codex'],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.machine.update).toHaveBeenCalledWith({
      where: { id: 'machine-1' },
      data: {
        userId: 'user-1',
        os: 'macos',
        agentList: ['codex'],
        paired: true,
        pairToken: null,
        machineToken: 'existing-token',
      },
    })
  })

  it('records daemonInstallationId when creating an unauthenticated pairing intent', async () => {
    mockPrisma.machine.create.mockResolvedValue({ id: 'temporary-machine' })
    mockPrisma.qrSession.create.mockResolvedValue({ id: 'qr-1' })
    const response = await app.inject({
      method: 'POST',
      url: '/machines/pair/create',
      payload: {
        name: 'MacBook', os: 'macos', agentList: ['codex'],
        daemonInstallationId: 'installation-1',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(mockPrisma.machine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'MacBook', daemonInstallationId: 'installation-1',
      }),
    })
  })

  it('re-pairs the same account and installation on its globally stable machine identity', async () => {
    mockPrisma.qrSession.findFirst.mockResolvedValue({
      id: 'qr-1', status: 'pending', machineId: 'temporary-machine',
      expiresAt: new Date(Date.now() + 60_000),
    })
    mockPrisma.machine.findFirst.mockResolvedValueOnce({
      id: 'stable-machine', userId: 'user-1', name: 'Renamed Mac', os: 'macos', agentList: ['codex'],
      daemonInstallationId: 'installation-1', pairToken: 'sn-test', paired: true,
    })
    mockPrisma.__tx.machine.update.mockResolvedValue({
      id: 'stable-machine', name: 'Renamed Mac', os: 'macos', agentList: ['codex'],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/machines/pair/claim',
      headers: { authorization: 'Bearer owner-token' },
      payload: { pairToken: 'sn-test' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockPrisma.__tx.machine.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'stable-machine' },
      data: expect.objectContaining({
        daemonInstallationId: 'installation-1', paired: true, machineToken: 'machine-token',
      }),
    }))
    expect(mockPrisma.__tx.qrSession.update).toHaveBeenCalledWith({
      where: { id: 'qr-1' },
      data: { status: 'confirmed', userId: 'user-1', machineId: 'stable-machine' },
    })
    expect(mockPrisma.__tx.machine.delete).not.toHaveBeenCalled()
    expect(response.json().machine.id).toBe('stable-machine')
  })

  it('atomically transfers one daemon installation and drops only its old personal projection', async () => {
    mockPrisma.qrSession.findFirst.mockResolvedValue({
      id: 'qr-1', status: 'pending', machineId: 'stable-machine',
      expiresAt: new Date(Date.now() + 60_000),
    })
    mockPrisma.machine.findFirst.mockResolvedValue({
      id: 'stable-machine', userId: 'old-owner', name: 'Mac', os: 'macos', agentList: ['codex'],
      daemonInstallationId: 'installation-1', pairToken: 'sn-test', paired: true,
    })
    mockPrisma.__tx.machine.update.mockResolvedValue({
      id: 'stable-machine', name: 'Mac', os: 'macos', agentList: ['codex'],
    })

    const response = await app.inject({
      method: 'POST', url: '/machines/pair/claim',
      headers: { authorization: 'Bearer owner-token' }, payload: { pairToken: 'sn-test' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockPrisma.__tx.machine.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'stable-machine' },
      data: expect.objectContaining({ userId: 'user-1', machineToken: 'machine-token' }),
    }))
    expect(mockPrisma.__tx.machineGrant.deleteMany).toHaveBeenCalledWith({
      where: { machineId: 'stable-machine' },
    })
    expect(mockPrisma.__tx.nianSession.deleteMany).toHaveBeenCalledWith({
      where: {
        machineId: 'stable-machine',
        roomBinding: { is: null },
        roomNativeSources: { none: {} },
      },
    })
    expect(mockMachineSocket.close).toHaveBeenCalledWith(4403, 'ownership_transferred')
    expect(mockClientSocket.close).toHaveBeenCalledWith(4403, 'ownership_transferred')
    expect(mockConnections.removeMachine).toHaveBeenCalledWith('stable-machine')
    expect(mockRedis.del).toHaveBeenCalledWith('machine:stable-machine:region')
  })

  it('grantee unbind revokes only the grant', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({
      id: 'machine-1',
      userId: 'owner-1',
    })
    mockPrisma.machineGrant.findFirst.mockResolvedValue({
      id: 'grant-1',
      machineId: 'machine-1',
      granteeId: 'user-2',
      revokedAt: null,
    })

    const res = await app.inject({
      method: 'DELETE',
      url: '/machines/machine-1',
      headers: { authorization: 'Bearer grantee-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.machineGrant.update).toHaveBeenCalledWith({
      where: { id: 'grant-1' },
      data: { revokedAt: expect.any(Date) },
    })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

afterEach(() => vi.unstubAllEnvs())
