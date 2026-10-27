// @covers open-source/packages/server/src/services/user-avatar.ts

import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockOss } = vi.hoisted(() => ({
  mockPrisma: { user: { update: vi.fn() } },
  mockOss: {
    putObjectBuffer: vi.fn(),
    getObjectBuffer: vi.fn(),
    deleteObjectIfExists: vi.fn(),
    listObjectsByPrefix: vi.fn(),
    deleteObjects: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/oss.js', () => mockOss)

import {
  cleanupUserAvatarObjects,
  detectAvatarMime,
  publicUserAvatar,
  readPublicUserAvatar,
  removeUserAvatar,
  updateUserAvatar,
} from '../services/user-avatar.js'

describe('user avatar service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOss.putObjectBuffer.mockResolvedValue(1)
    mockOss.deleteObjectIfExists.mockResolvedValue(undefined)
  })

  it('validates the file header, decodes pixels, crops square, and writes three WebP variants', async () => {
    const source = await sharp({
      create: { width: 320, height: 180, channels: 3, background: '#ff5500' },
    })
      .png()
      .toBuffer()
    const now = new Date('2026-08-23T12:00:00.000Z')
    mockPrisma.user.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'user_12345678',
        ...data,
      }),
    )

    const result = await updateUserAvatar({
      userId: 'user_12345678',
      contentType: 'image/png',
      buffer: source,
      now,
    })

    expect(result.avatar).toMatchObject({
      version: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/),
      updatedAt: now.toISOString(),
    })
    expect(mockOss.putObjectBuffer).toHaveBeenCalledTimes(3)
    const uploads = mockOss.putObjectBuffer.mock.calls as Array<[string, Buffer, string]>
    expect(uploads.map(([key]) => key)).toEqual([
      expect.stringMatching(/\/source\.webp$/),
      expect.stringMatching(/\/96\.webp$/),
      expect.stringMatching(/\/256\.webp$/),
    ])
    expect(uploads.every(([, , mime]) => mime === 'image/webp')).toBe(true)
    await expect(sharp(uploads[1]![1]).metadata()).resolves.toMatchObject({ width: 96, height: 96 })
    await expect(sharp(uploads[2]![1]).metadata()).resolves.toMatchObject({
      width: 256,
      height: 256,
    })
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_12345678' },
      data: expect.objectContaining({
        avatarVersion: expect.any(String),
        avatarUpdatedAt: now,
      }),
    })
  })

  it('rejects a claimed MIME that does not match the image signature', async () => {
    const jpeg = await sharp({
      create: { width: 128, height: 128, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer()

    expect(detectAvatarMime(jpeg)).toBe('image/jpeg')
    await expect(
      updateUserAvatar({ userId: 'user_12345678', contentType: 'image/png', buffer: jpeg }),
    ).rejects.toMatchObject({ code: 'avatar_type_invalid', statusCode: 415 })
    expect(mockOss.putObjectBuffer).not.toHaveBeenCalled()
  })

  it('cleans newly written objects if persistence fails', async () => {
    const png = await sharp({
      create: { width: 128, height: 128, channels: 3, background: '#224466' },
    })
      .png()
      .toBuffer()
    mockPrisma.user.update.mockRejectedValue(new Error('database unavailable'))

    await expect(
      updateUserAvatar({ userId: 'user_12345678', contentType: 'image/png', buffer: png }),
    ).rejects.toThrow('database unavailable')
    expect(mockOss.deleteObjectIfExists).toHaveBeenCalledTimes(3)
  })

  it('removes only the current profile pointer so historical message snapshots stay renderable', async () => {
    mockPrisma.user.update.mockResolvedValue({ id: 'user_12345678', avatarVersion: null })

    await expect(removeUserAvatar('user_12345678')).resolves.toMatchObject({ avatar: null })
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_12345678' },
      data: {
        avatarVersion: null,
        avatarOriginalObjectKey: null,
        avatarSmallObjectKey: null,
        avatarMediumObjectKey: null,
        avatarUpdatedAt: null,
      },
    })
    expect(mockOss.deleteObjectIfExists).not.toHaveBeenCalled()
  })

  it('builds immutable relative URLs and reads only supported variants', async () => {
    const updatedAt = new Date('2026-08-23T12:00:00.000Z')
    expect(
      publicUserAvatar({
        id: 'user_12345678',
        avatarVersion: 'v'.repeat(24),
        avatarUpdatedAt: updatedAt,
      }),
    ).toEqual({
      version: 'v'.repeat(24),
      smallUrl: `/public/profile-avatars/user_12345678/${'v'.repeat(24)}/96`,
      mediumUrl: `/public/profile-avatars/user_12345678/${'v'.repeat(24)}/256`,
      updatedAt: updatedAt.toISOString(),
    })

    mockOss.getObjectBuffer.mockResolvedValue({
      buffer: Buffer.from('webp'),
      mimeType: 'image/webp',
    })
    await expect(
      readPublicUserAvatar({ userId: 'user_12345678', version: 'v'.repeat(24), size: '96' }),
    ).resolves.toEqual(Buffer.from('webp'))
    await expect(
      readPublicUserAvatar({ userId: '../secret', version: 'v'.repeat(24), size: '96' }),
    ).rejects.toMatchObject({ code: 'avatar_not_found' })
    await expect(
      readPublicUserAvatar({ userId: 'user_12345678', version: 'v'.repeat(24), size: '1024' }),
    ).rejects.toMatchObject({ code: 'avatar_not_found' })
  })

  it('deletes every paginated avatar version when the account is deleted', async () => {
    mockOss.listObjectsByPrefix
      .mockResolvedValueOnce({
        objects: [{ name: 'profile-avatars/users/user_12345678/v1/96.webp' }],
        nextMarker: 'next',
        isTruncated: true,
      })
      .mockResolvedValueOnce({
        objects: [{ name: 'profile-avatars/users/user_12345678/v2/256.webp' }],
        nextMarker: null,
        isTruncated: false,
      })
    mockOss.deleteObjects.mockResolvedValue(1)

    await expect(cleanupUserAvatarObjects('user_12345678')).resolves.toBe(2)
    expect(mockOss.listObjectsByPrefix).toHaveBeenNthCalledWith(
      1,
      'profile-avatars/users/user_12345678/',
      null,
    )
    expect(mockOss.listObjectsByPrefix).toHaveBeenNthCalledWith(
      2,
      'profile-avatars/users/user_12345678/',
      'next',
    )
  })
})
