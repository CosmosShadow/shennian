// @covers open-source/packages/server/src/routes/profile-avatars.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRead } = vi.hoisted(() => ({ mockRead: vi.fn() }))
vi.mock('../services/user-avatar.js', async () => {
  const actual = await vi.importActual<typeof import('../services/user-avatar.js')>(
    '../services/user-avatar.js',
  )
  return { ...actual, readPublicUserAvatar: mockRead }
})

import { profileAvatarRoutes } from '../routes/profile-avatars.js'

describe('public profile avatar route', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRead.mockResolvedValue(Buffer.from('webp-image'))
    app = Fastify()
    await app.register(profileAvatarRoutes)
    await app.ready()
  })

  afterEach(async () => app.close())

  it('serves an immutable decoded image without requiring login', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/public/profile-avatars/user_12345678/${'v'.repeat(24)}/256`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/webp')
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(mockRead).toHaveBeenCalledWith({
      userId: 'user_12345678',
      version: 'v'.repeat(24),
      size: '256',
    })
  })
})
