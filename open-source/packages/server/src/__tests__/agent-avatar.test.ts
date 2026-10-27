// @covers open-source/packages/server/src/services/agent-avatar.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, ossMock, prepareMock } = vi.hoisted(() => ({
  prismaMock: {
    agentIdentity: { findFirst: vi.fn(), update: vi.fn() },
  },
  ossMock: {
    putObjectBuffer: vi.fn(),
    deleteObjectIfExists: vi.fn(),
    getObjectBuffer: vi.fn(),
    listObjectsByPrefix: vi.fn(),
    deleteObjects: vi.fn(),
  },
  prepareMock: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../lib/oss.js', () => ossMock)
vi.mock('../services/user-avatar.js', () => ({
  UserAvatarError: class UserAvatarError extends Error {
    constructor(
      public readonly code: string,
      public readonly statusCode: number,
      message: string,
    ) {
      super(message)
    }
  },
  prepareAvatarImages: prepareMock,
}))

import {
  buildAgentAvatarObjectKeys,
  publicAgentAvatar,
  readPublicAgentAvatar,
  removeAgentAvatar,
  updateAgentAvatar,
} from '../services/agent-avatar.js'

const now = new Date('2026-08-26T12:00:00.000Z')

describe('Agent avatar service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent_12345678' })
    prepareMock.mockResolvedValue({
      version: 'v'.repeat(24),
      original: Buffer.from('original'),
      small: Buffer.from('small'),
      medium: Buffer.from('medium'),
    })
  })

  it('stores an independent versioned avatar only after verifying ownership', async () => {
    prismaMock.agentIdentity.update.mockResolvedValue({
      id: 'agent_12345678',
      avatarVersion: 'v'.repeat(24),
      avatarUpdatedAt: now,
    })
    const result = await updateAgentAvatar({
      userId: 'user-1',
      agentId: 'agent_12345678',
      contentType: 'image/png',
      buffer: Buffer.from('png'),
      now,
    })

    expect(prismaMock.agentIdentity.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'agent_12345678',
        ownerType: 'user',
        ownerUserId: 'user-1',
        status: { not: 'deleted' },
      },
    })
    expect(ossMock.putObjectBuffer).toHaveBeenCalledTimes(3)
    expect(prismaMock.agentIdentity.update).toHaveBeenCalledWith({
      where: { id: 'agent_12345678' },
      data: expect.objectContaining({
        avatarVersion: 'v'.repeat(24),
        avatarUpdatedAt: now,
      }),
    })
    expect(result.avatar?.smallUrl).toContain('/public/agent-avatars/agent_12345678/')
  })

  it('restores live Owner-avatar inheritance by clearing only the current pointer', async () => {
    prismaMock.agentIdentity.update.mockResolvedValue({ id: 'agent_12345678' })
    await expect(removeAgentAvatar('user-1', 'agent_12345678')).resolves.toMatchObject({
      avatar: null,
    })
    expect(prismaMock.agentIdentity.update).toHaveBeenCalledWith({
      where: { id: 'agent_12345678' },
      data: {
        avatarVersion: null,
        avatarOriginalObjectKey: null,
        avatarSmallObjectKey: null,
        avatarMediumObjectKey: null,
        avatarUpdatedAt: null,
      },
    })
    expect(ossMock.deleteObjectIfExists).not.toHaveBeenCalled()
  })

  it('serves only immutable derived sizes and never exposes source object keys', async () => {
    ossMock.getObjectBuffer.mockResolvedValue({ buffer: Buffer.from('image') })
    await expect(
      readPublicAgentAvatar({ agentId: 'agent_12345678', version: 'v'.repeat(24), size: '96' }),
    ).resolves.toEqual(Buffer.from('image'))
    expect(ossMock.getObjectBuffer).toHaveBeenCalledWith(
      buildAgentAvatarObjectKeys('agent_12345678', 'v'.repeat(24)).small,
    )
    await expect(
      readPublicAgentAvatar({ agentId: 'agent_12345678', version: 'v'.repeat(24), size: 'source' }),
    ).rejects.toMatchObject({ code: 'avatar_not_found', statusCode: 404 })
  })

  it('returns null while inheriting the Owner avatar', () => {
    expect(publicAgentAvatar({ id: 'agent_12345678', avatarVersion: null })).toBeNull()
  })
})
