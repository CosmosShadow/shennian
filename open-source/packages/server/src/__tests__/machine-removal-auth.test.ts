// @covers open-source/packages/server/src/middleware/auth.ts
// @covers open-source/packages/server/src/services/machine-removal.ts

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    device: { findUnique: vi.fn(), updateMany: vi.fn() },
    machine: { findUnique: vi.fn() },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn(() => null),
  verifyMachineToken: vi.fn((token: string) =>
    token === 'revoked-machine-token' ? { machineId: 'machine-1' } : null,
  ),
}))

import { registerAuthDecorators, requireUserOrMachineAuth } from '../middleware/auth.js'

describe('removed machine authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Machine removal clears the credential, so the token-indexed lookup cannot
    // return a principal even if the signed JWT has not reached its expiry yet.
    prismaMock.machine.findUnique.mockResolvedValue(null)
  })

  it('rejects the old signed machine token on every later HTTP request', async () => {
    const app = Fastify()
    registerAuthDecorators(app)
    app.get('/probe', { preHandler: requireUserOrMachineAuth }, async () => ({ ok: true }))

    const response = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: 'Bearer revoked-machine-token' },
    })
    await app.close()

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Machine not found' })
    expect(prismaMock.machine.findUnique).toHaveBeenCalledWith({
      where: { machineToken: 'revoked-machine-token' },
      select: { id: true, userId: true },
    })
  })
})
