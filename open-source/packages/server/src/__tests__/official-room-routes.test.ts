// @covers open-source/packages/server/src/routes/official-room.ts

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveOfficialRoom: vi.fn() }))
vi.mock('../services/official-room.js', () => mocks)

import { officialRoomRoutes } from '../routes/official-room.js'

describe('official Room public routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveOfficialRoom.mockResolvedValue({
      roomId: 'room-2',
      name: '神念官方交流群 2 群',
      inviteToken: 'invite-token',
      sequence: 2,
      humanCount: 1,
      maxHumanMembers: 100,
    })
  })

  it('returns the current target without authentication or caching', async () => {
    const app = Fastify()
    await app.register(officialRoomRoutes)

    const response = await app.inject({ method: 'GET', url: '/api/public/official-room' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      roomId: 'room-2',
      inviteToken: 'invite-token',
      inviteUrl: 'http://localhost:8081/spaces/room-2?invite=invite-token',
    })
  })

  it('redirects the stable web entry to the resolved invitation', async () => {
    const app = Fastify()
    await app.register(officialRoomRoutes)

    const response = await app.inject({ method: 'GET', url: '/join/official' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(
      'http://localhost:8081/spaces/room-2?invite=invite-token',
    )
  })

  it('returns a recoverable unavailable response', async () => {
    mocks.resolveOfficialRoom.mockRejectedValue(new Error('missing'))
    const app = Fastify({ logger: false })
    await app.register(officialRoomRoutes)

    const response = await app.inject({ method: 'GET', url: '/public/official-room' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'official_room_unavailable' })
  })
})
