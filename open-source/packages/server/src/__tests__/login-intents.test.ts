// @covers open-source/packages/server/src/services/login-intents.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockTx, mockSignMachineToken, mockConnections, mockRedis } = vi.hoisted(() => {
  const mockTx = {
    loginIntent: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    machine: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    machineGrant: { deleteMany: vi.fn() },
    nianSession: { deleteMany: vi.fn() },
  }
  return {
    mockTx,
    mockSignMachineToken: vi.fn(() => 'machine-token-secret'),
    mockConnections: {
      getMachine: vi.fn(),
      getClients: vi.fn(() => new Set()),
      removeMachine: vi.fn(),
    },
    mockRedis: { del: vi.fn() },
    mockPrisma: {
      user: { findUnique: vi.fn() },
      loginIntent: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
    },
  }
})

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/redis.js', () => ({ redis: mockRedis }))
vi.mock('../relay/connections.js', () => ({ connections: mockConnections }))
vi.mock('../services/jwt.js', () => ({ signMachineToken: mockSignMachineToken }))

import {
  approveLoginIntent,
  claimLoginIntent,
  createLoginIntent,
  denyLoginIntent,
  getPrivateLoginIntentStatus,
  getPublicLoginIntent,
  hashDeviceSecret,
  LoginIntentError,
  normalizeLoginIntentReturnTo,
} from '../services/login-intents.js'

const deviceSecret = 'device-secret-that-is-long-enough-for-use'
const deviceSecretHash = hashDeviceSecret(deviceSecret)
const actionPayloadHash = 'a'.repeat(64)
const future = new Date(Date.now() + 60_000)

const baseIntent = {
  id: 'intent_1',
  deviceSecretHash,
  machineName: '李辰的 Mac',
  machineOs: 'darwin',
  agentList: ['codex'],
  actionType: 'room.create',
  actionSummary: '创建群聊「设计讨论」',
  actionPayloadHash,
  returnTo: '/spaces',
  status: 'waiting_user',
  approvedUserId: null,
  machineId: null,
  expiresAt: future,
  approvedAt: null,
  claimedAt: null,
  deniedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('LoginIntent device authorization', () => {
  beforeEach(() => {
    vi.stubEnv('SHENNIAN_REVIEW_ACCOUNT_PHONES', '+8619900000002')
    vi.stubEnv('SHENNIAN_REVIEW_LOGIN_CODE', '654321')
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8613900000000' })
  })

  it('accepts only explicit Shennian space return routes', () => {
    expect(normalizeLoginIntentReturnTo('/spaces/room_123')).toBe('/spaces/room_123')
    for (const unsafe of ['https://evil.example', '//evil.example', '/spaces/../admin', '/profile', '/(main)/spaces/room_123']) {
      expect(() => normalizeLoginIntentReturnTo(unsafe)).toThrow(LoginIntentError)
    }
  })

  it('rejects authorization and claim for restricted review accounts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8619900000002' })

    await expect(approveLoginIntent('intent_1', 'review_user')).rejects.toMatchObject({
      code: 'review_account_machine_access_forbidden',
      statusCode: 403,
    })

    mockTx.loginIntent.findUnique.mockResolvedValue({
      ...baseIntent,
      status: 'approved',
      approvedUserId: 'review_user',
    })
    await expect(claimLoginIntent('intent_1', deviceSecret)).rejects.toMatchObject({
      code: 'review_account_machine_access_forbidden',
      statusCode: 403,
    })
    expect(mockTx.machine.create).not.toHaveBeenCalled()
  })

  it('stores only the caller-generated device secret hash and immutable action hash', async () => {
    mockPrisma.loginIntent.create.mockImplementation(async ({ data }: { data: unknown }) => ({
      ...baseIntent,
      ...(data as object),
    }))

    await createLoginIntent({
      deviceSecretHash,
      daemonInstallationId: 'installation-1',
      machineName: '李辰的 Mac',
      machineOs: 'darwin',
      agentList: ['codex'],
      actionType: 'room.create',
      actionSummary: '创建群聊「设计讨论」',
      actionPayloadHash,
      returnTo: '/spaces',
    })

    expect(mockPrisma.loginIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceSecretHash,
        daemonInstallationId: 'installation-1',
        actionPayloadHash,
        returnTo: '/spaces',
      }),
    })
    expect(JSON.stringify(mockPrisma.loginIntent.create.mock.calls[0])).not.toContain(deviceSecret)
  })

  it('never exposes the device secret hash or approval identity in public metadata', async () => {
    mockPrisma.loginIntent.findUnique.mockResolvedValue(baseIntent)
    const result = await getPublicLoginIntent('intent_1')
    expect(result).toMatchObject({ id: 'intent_1', machineName: '李辰的 Mac', expired: false })
    expect(result).not.toHaveProperty('deviceSecretHash')
    expect(result).not.toHaveProperty('approvedUserId')
    expect(result).not.toHaveProperty('status')
  })

  it('requires the private secret even to poll status', async () => {
    mockPrisma.loginIntent.findUnique.mockResolvedValue(baseIntent)
    await expect(getPrivateLoginIntentStatus('intent_1', 'wrong-secret-that-is-still-long-enough')).rejects.toMatchObject({
      code: 'invalid_device_authorization',
      statusCode: 401,
    })
    await expect(getPrivateLoginIntentStatus('intent_1', deviceSecret)).resolves.toMatchObject({
      status: 'waiting_user',
      actionPayloadHash,
    })
  })

  it('makes browser approval atomic and idempotent only for the approving user', async () => {
    mockPrisma.loginIntent.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    mockPrisma.loginIntent.findUnique.mockResolvedValue({
      ...baseIntent,
      status: 'approved',
      approvedUserId: 'user_1',
    })

    await expect(approveLoginIntent('intent_1', 'user_1')).resolves.toMatchObject({
      status: 'approved',
      approvedByCurrentUser: true,
    })
    await expect(approveLoginIntent('intent_1', 'user_2')).rejects.toMatchObject({
      code: 'login_intent_unavailable',
    })
  })

  it('lets an authenticated user deny a waiting request without creating a machine', async () => {
    mockPrisma.loginIntent.updateMany.mockResolvedValueOnce({ count: 1 })
    mockPrisma.loginIntent.findUnique.mockResolvedValue({ ...baseIntent, status: 'denied' })

    await expect(denyLoginIntent('intent_1', 'user_1')).resolves.toMatchObject({
      status: 'denied',
      canApprove: false,
    })
    expect(mockPrisma.loginIntent.updateMany).toHaveBeenCalledWith({
      where: { id: 'intent_1', status: 'waiting_user', expiresAt: { gt: expect.any(Date) } },
      data: { status: 'denied', deniedAt: expect.any(Date) },
    })
    expect(mockTx.machine.create).not.toHaveBeenCalled()
  })

  it('returns the machine token exactly once and preserves the approved action hash', async () => {
    mockTx.loginIntent.findUnique
      .mockResolvedValueOnce({ ...baseIntent, status: 'approved', approvedUserId: 'user_1' })
      .mockResolvedValueOnce({ ...baseIntent, status: 'claimed', approvedUserId: 'user_1', machineId: 'machine_1' })
    mockTx.loginIntent.updateMany.mockResolvedValue({ count: 1 })
    mockTx.machine.create.mockResolvedValue({ id: 'machine_1' })

    const first = await claimLoginIntent('intent_1', deviceSecret)
    const replay = await claimLoginIntent('intent_1', deviceSecret)

    expect(first).toEqual({
      status: 'claimed',
      machineToken: 'machine-token-secret',
      machineId: 'machine_1',
      accountNamespaceId: '3ad9fb81e4e56e51e457cfbc8d601af030250b940cc6556264d2c05076387134',
      actionPayloadHash,
    })
    expect(replay).toEqual({ status: 'claimed', actionPayloadHash })
    expect(mockTx.machine.create).toHaveBeenCalledTimes(1)
    expect(mockSignMachineToken).toHaveBeenCalledTimes(1)
  })

  it('reuses the stable machine identity supplied by browser pairing', async () => {
    mockTx.loginIntent.findUnique.mockResolvedValue({
      ...baseIntent,
      status: 'approved',
      approvedUserId: 'user_1',
      daemonInstallationId: 'installation-1',
    })
    mockTx.loginIntent.updateMany.mockResolvedValue({ count: 1 })
    mockTx.machine.findUnique.mockResolvedValue({
      id: 'machine_1',
      userId: 'user_1',
      daemonInstallationId: 'installation-1',
    })
    mockTx.machine.update.mockResolvedValue({ id: 'machine_1' })

    await expect(claimLoginIntent('intent_1', deviceSecret)).resolves.toMatchObject({
      status: 'claimed',
      machineId: 'machine_1',
      machineToken: 'machine-token-secret',
    })

    expect(mockTx.machine.create).not.toHaveBeenCalled()
    expect(mockTx.machine.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'machine_1' },
      data: expect.objectContaining({
        userId: 'user_1',
        paired: true,
      }),
    })
    expect(mockTx.loginIntent.updateMany).toHaveBeenCalledWith({
      where: { machineId: 'machine_1' },
      data: { machineId: null },
    })
  })
})

afterEach(() => vi.unstubAllEnvs())
