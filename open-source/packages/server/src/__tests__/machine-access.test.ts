// @covers open-source/packages/server/src/services/machine-access.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => ({ prisma: {
  machine: { findUnique: vi.fn() }, machineGrant: { findFirst: vi.fn() },
} }))
vi.mock('../lib/prisma.js', () => ({ prisma }))
import { getMachineAccess, historicalPermissionAllowsUse, isActiveMachineGrant } from '../services/machine-access.js'

describe('machine access policy', () => {
  beforeEach(() => vi.resetAllMocks())
  it('keeps historical values compatible without treating admin as owner delegation', () => {
    expect(historicalPermissionAllowsUse('view')).toBe(false)
    expect(historicalPermissionAllowsUse('use')).toBe(true)
    expect(historicalPermissionAllowsUse('full')).toBe(true)
    expect(historicalPermissionAllowsUse('admin')).toBe(true)
  })
  it('rejects revoked and expired grants', () => {
    const now = new Date('2026-09-08T00:00:00Z')
    expect(isActiveMachineGrant({ granteeId: 'u1', revokedAt: now, expiresAt: null }, 'u1', now)).toBe(false)
    expect(isActiveMachineGrant({ granteeId: 'u1', revokedAt: null, expiresAt: new Date(now.getTime() - 1) }, 'u1', now)).toBe(false)
  })
  it('allows an owner and denies a paused machine', async () => {
    prisma.machine.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', remoteAccessDisabledAt: null })
    expect((await getMachineAccess('m1', 'u1'))?.role).toBe('owner')
    prisma.machine.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', remoteAccessDisabledAt: new Date() })
    expect(await getMachineAccess('m1', 'u1')).toBeNull()
  })
  it('permits view-only status but rejects use for a legacy view grant', async () => {
    prisma.machine.findUnique.mockResolvedValue({ id: 'm1', userId: 'owner', remoteAccessDisabledAt: null })
    prisma.machineGrant.findFirst.mockResolvedValue({ permission: 'view', expiresAt: null })
    expect((await getMachineAccess('m1', 'u1', 'view'))?.permission).toBe('view')
    expect(await getMachineAccess('m1', 'u1', 'use')).toBeNull()
  })
})
