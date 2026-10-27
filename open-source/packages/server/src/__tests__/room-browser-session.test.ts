// @covers open-source/packages/server/src/services/room-browser-session.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  query: vi.fn(),
  member: vi.fn(),
  publish: vi.fn(),
  notify: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    roomBrowserSession: {
      create: mocks.create,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}))

vi.mock('../relay/connection-control.js', () => ({ publishRoomBrowserSessionRevoked: mocks.publish }))
vi.mock('../services/room-browser-notifications.js', () => ({ notifyRoomBrowserAccessChanged: mocks.notify }))

import {
  createActiveRoomBrowserSession,
  authenticateRoomBrowserSession,
  createRoomBrowserHandoff,
  exchangeRoomBrowserHandoff,
  listRoomBrowserSessionsForUser,
  readRoomBrowserCookie,
  revokeRoomBrowserSessionForUser,
  roomBrowserClientLabel,
  serializeRoomBrowserCookie,
} from '../services/room-browser-session.js'
import {
  addRoomBrowserSocket,
  closeRoomBrowserSessionSockets,
  closeRoomBrowserSockets,
} from '../services/room-browser-events.js'

describe('Room browser sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation(async (run) => run({
      $queryRaw: mocks.query, roomMembership: { findUnique: mocks.member },
      roomBrowserSession: { create: mocks.create, count: mocks.count, findMany: mocks.findMany, findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    }))
    mocks.query.mockResolvedValue([{ id: 'member_1' }])
    mocks.member.mockResolvedValue({ id: 'member_1', roomId: 'room_1', userId: 'user_1', status: 'active', principalType: 'human', room: { status: 'active' } })
    mocks.count.mockResolvedValue(0)
    mocks.findMany.mockResolvedValue([{ id: 'previous' }])
    mocks.updateMany.mockResolvedValue({ count: 1 })
  })

  it('stores only the handoff hash and binds it to one formal membership', async () => {
    const now = new Date('2026-08-31T00:00:00.000Z')
    const result = await createRoomBrowserHandoff({
      roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', now,
    })
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', status: 'pending_handoff',
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }) })
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(result.token)
  })

  it('rotates a one-time handoff into an independent active session', async () => {
    const now = new Date('2026-08-31T00:00:00.000Z')
    mocks.findUnique.mockResolvedValue({
      id: 'session_1', roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', status: 'pending_handoff',
      expiresAt: new Date('2026-08-31T00:05:00.000Z'),
    })
    mocks.updateMany.mockResolvedValue({ count: 1 })
    const result = await exchangeRoomBrowserHandoff('h'.repeat(43), 'room_1', now)
    expect(result.roomId).toBe('room_1')
    expect(result.token).not.toBe('h'.repeat(43))
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'session_1', status: 'consuming_handoff' }),
      data: expect.objectContaining({ status: 'active', tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }))
  })

  it('adds an independent eight-hour browser grant without revoking the existing browser', async () => {
    const now = new Date('2026-09-12T00:00:00Z')
    const result = await createActiveRoomBrowserSession({ roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', now })
    expect(result.expiresAt.getTime() - now.getTime()).toBe(8 * 60 * 60 * 1000)
    expect(mocks.query).toHaveBeenCalledOnce()
    expect(mocks.count).toHaveBeenCalledWith({ where: expect.objectContaining({
      userId: 'user_1', roomId: 'room_1', status: 'active', expiresAt: { gt: now },
    }) })
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith('user_1', 'room_1')
  })

  it('concurrent grants remain active without affecting another user or room', async () => {
    type Row = { id: string; userId: string; roomId: string; status: string; tokenHash?: string }
    const rows: Row[] = [
      { id: 'old', userId: 'user_1', roomId: 'room_1', status: 'active' },
      { id: 'other-user', userId: 'user_2', roomId: 'room_1', status: 'active' },
      { id: 'other-room', userId: 'user_1', roomId: 'room_2', status: 'active' },
    ]
    const matching = (row: Row, where: Partial<Row>) => Object.entries(where).every(([key, value]) => row[key as keyof Row] === value)
    mocks.findMany.mockImplementation(async ({ where }) => rows.filter(row => matching(row, where)).map(row => ({ id: row.id })))
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      const matched = rows.filter(row => matching(row, where))
      for (const row of matched) Object.assign(row, data)
      return { count: matched.length }
    })
    mocks.create.mockImplementation(async ({ data }) => { rows.push({ ...data, id: `new-${rows.length}` }) })
    mocks.count.mockImplementation(async ({ where }) => rows.filter(row => matching(row, {
      userId: where.userId, roomId: where.roomId, status: where.status,
    })).length)
    const tx = { $queryRaw: mocks.query, roomMembership: { findUnique: mocks.member }, roomBrowserSession: { create: mocks.create, count: mocks.count, findMany: mocks.findMany, findUnique: mocks.findUnique, updateMany: mocks.updateMany } }
    let queue = Promise.resolve()
    mocks.transaction.mockImplementation((run) => {
      const pending = queue.then(() => run(tx))
      queue = pending.catch(() => {})
      return pending
    })
    await Promise.all([1, 2].map(() => createActiveRoomBrowserSession({ roomId: 'room_1', userId: 'user_1', membershipId: 'member_1' })))
    expect(mocks.query.mock.calls.every(([sql]) => sql.join('').includes('FOR UPDATE'))).toBe(true)
    expect(rows.filter(row => row.userId === 'user_1' && row.roomId === 'room_1' && row.status === 'active')).toHaveLength(3)
    expect(rows.find(row => row.id === 'other-user')?.status).toBe('active')
    expect(rows.find(row => row.id === 'other-room')?.status).toBe('active')
  })

  it('refuses a ninth active browser without revoking any existing grant', async () => {
    mocks.count.mockResolvedValue(8)
    await expect(createActiveRoomBrowserSession({
      roomId: 'room_1', userId: 'user_1', membershipId: 'member_1',
    })).rejects.toMatchObject({ code: 'room_browser_session_limit_reached', statusCode: 409 })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.updateMany).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('replaces only the grant already held by the same browser context', async () => {
    const now = new Date('2026-09-12T00:00:00Z')
    mocks.findUnique.mockResolvedValue({
      id: 'same-browser', roomId: 'room_1', userId: 'user_1', identityId: null,
      authorizationVersion: 2, status: 'active', expiresAt: new Date('2026-09-12T01:00:00Z'),
    })
    await createActiveRoomBrowserSession({
      roomId: 'room_1', userId: 'user_1', membershipId: 'member_1',
      existingToken: 'e'.repeat(43), now,
    })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'same-browser', status: 'active', expiresAt: { gt: now } },
      data: { status: 'revoked' },
    })
    expect(mocks.publish).toHaveBeenCalledTimes(1)
    expect(mocks.publish).toHaveBeenCalledWith('same-browser')
  })

  it('does not evict the current browser when a handoff loses its atomic claim', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'handoff', roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', status: 'pending_handoff', expiresAt: new Date(Date.now() + 60_000) })
    mocks.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(exchangeRoomBrowserHandoff('h'.repeat(43), 'room_1')).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it.each(['removed', 'wrong-user', 'archived'])('fails closed when membership is %s at grant commit', async (state) => {
    mocks.member.mockResolvedValue({ roomId: 'room_1', userId: state === 'wrong-user' ? 'other' : 'user_1', principalType: 'human', status: state === 'removed' ? 'removed' : 'active', room: { status: state === 'archived' ? 'archived' : 'active' } })
    await expect(createActiveRoomBrowserSession({ roomId: 'room_1', userId: 'user_1', membershipId: 'member_1' })).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('rejects a handoff when the URL room does not match its bound Room', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'session_1', roomId: 'room_1', userId: 'user_1', membershipId: 'member_1', status: 'pending_handoff',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(
      exchangeRoomBrowserHandoff('h'.repeat(43), 'room_2'),
    ).rejects.toMatchObject({ code: 'room_browser_session_unavailable' })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a session when its formal membership is no longer active', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'session_1', authorizationVersion: 2, status: 'active', expiresAt: new Date(Date.now() + 60_000),
      roomId: 'room_1', userId: 'user_1', lastSeenAt: new Date(),
      room: { id: 'room_1', status: 'active' },
      user: { id: 'user_1' },
      membership: { principalType: 'human', id: 'member_1', roomId: 'room_1', userId: 'user_1', status: 'removed' },
    })
    await expect(authenticateRoomBrowserSession('s'.repeat(43))).rejects.toMatchObject({
      code: 'room_browser_session_unavailable', statusCode: 401,
    })
  })

  it('rejects a session as soon as its Room is archived', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'session_1', authorizationVersion: 2, status: 'active', expiresAt: new Date(Date.now() + 60_000),
      roomId: 'room_1', userId: 'user_1', lastSeenAt: new Date(),
      room: { id: 'room_1', status: 'archived' },
      user: { id: 'user_1' },
      membership: { principalType: 'human', id: 'member_1', roomId: 'room_1', userId: 'user_1', status: 'active' },
    })
    await expect(authenticateRoomBrowserSession('s'.repeat(43))).rejects.toMatchObject({
      code: 'room_browser_session_unavailable', statusCode: 401,
    })
  })

  it('rejects an otherwise valid legacy grant even if an old server minted it during rollout', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'legacy', authorizationVersion: 1, status: 'active', expiresAt: new Date(Date.now() + 60_000), room: { status: 'active' }, membership: { status: 'active', principalType: 'human' } })
    await expect(authenticateRoomBrowserSession('s'.repeat(43), 'room_1')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('uses a Host-only HttpOnly cookie and rejects duplicate values', () => {
    const request = {
      protocol: 'https',
      headers: {
        'x-forwarded-proto': 'https',
        cookie: `__Host-shennian-room=${'a'.repeat(43)}; __Host-shennian-room=${'b'.repeat(43)}`,
      },
    } as never
    expect(readRoomBrowserCookie(request)).toBeUndefined()
    const cookie = serializeRoomBrowserCookie(request, 's'.repeat(43), new Date(Date.now() + 60_000))
    expect(cookie).toContain('__Host-shennian-room=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Domain=')
  })

  it('stores only a short browser and system label instead of the raw user agent', () => {
    const label = roomBrowserClientLabel({ headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36 private-marker',
    } } as never)
    expect(label).toBe('Chrome · macOS')
    expect(label).not.toContain('private-marker')
  })

  it('closes every scoped socket immediately when the Room is archived', () => {
    const first = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() }
    const second = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() }
    addRoomBrowserSocket('room_1', 'session_1', 'member_1', new Date(Date.now() + 60_000), first)
    addRoomBrowserSocket('room_1', 'session_2', 'member_2', new Date(Date.now() + 60_000), second)

    closeRoomBrowserSockets('room_1', 4403, 'Room archived')

    expect(first.close).toHaveBeenCalledWith(4403, 'Room archived')
    expect(second.close).toHaveBeenCalledWith(4403, 'Room archived')
  })

  it('lists only the current user sessions with derived active, expired, and revoked audit states', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    mocks.findMany.mockResolvedValue([
      {
        id: 'active_1', clientLabel: 'Safari · macOS', status: 'active', createdAt: new Date('2026-08-31T22:00:00.000Z'),
        updatedAt: new Date('2026-08-31T22:00:00.000Z'), lastSeenAt: new Date('2026-08-31T23:59:00.000Z'),
        expiresAt: new Date('2026-09-01T06:00:00.000Z'),
      },
      {
        id: 'expired_1', clientLabel: null, status: 'active', createdAt: new Date('2026-08-31T10:00:00.000Z'),
        updatedAt: new Date('2026-08-31T10:00:00.000Z'), lastSeenAt: new Date('2026-08-31T11:00:00.000Z'),
        expiresAt: new Date('2026-08-31T18:00:00.000Z'),
      },
      {
        id: 'revoked_1', clientLabel: 'Chrome · Windows', status: 'revoked', createdAt: new Date('2026-08-31T09:00:00.000Z'),
        updatedAt: new Date('2026-08-31T12:00:00.000Z'), lastSeenAt: new Date('2026-08-31T11:30:00.000Z'),
        expiresAt: new Date('2026-08-31T17:00:00.000Z'),
      },
    ])

    const result = await listRoomBrowserSessionsForUser({ roomId: 'room_1', userId: 'user_1', now })

    expect(result.map((session) => session.status)).toEqual(['active', 'expired', 'revoked'])
    expect(result[2].endedAt).toBe('2026-08-31T12:00:00.000Z')
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId: 'room_1', userId: 'user_1', status: { in: ['active', 'revoked'] }, authorizationVersion: 2 },
      take: 20,
    }))
  })

  it('revokes only an active session owned by the authenticated user', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    mocks.findFirst.mockResolvedValue({
      id: 'session_1', authorizationVersion: 2, status: 'active', expiresAt: new Date('2026-09-01T01:00:00.000Z'),
    })
    mocks.updateMany.mockResolvedValue({ count: 1 })

    await expect(revokeRoomBrowserSessionForUser({
      roomId: 'room_1', userId: 'user_1', sessionId: 'session_1', now,
    })).resolves.toEqual({ sessionId: 'session_1', status: 'revoked', idempotent: false })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session_1', roomId: 'room_1', userId: 'user_1', status: 'active',
        expiresAt: { gt: now },
      },
      data: { status: 'revoked' },
    })
  })

  it('closes only sockets using the independently revoked browser session', () => {
    const revoked = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() }
    const retained = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() }
    addRoomBrowserSocket('room_1', 'session_1', 'member_1', new Date(Date.now() + 60_000), revoked)
    addRoomBrowserSocket('room_1', 'session_2', 'member_1', new Date(Date.now() + 60_000), retained)

    closeRoomBrowserSessionSockets('session_1')

    expect(revoked.close).toHaveBeenCalledWith(4403, 'Room browser session revoked')
    expect(retained.close).not.toHaveBeenCalled()
    closeRoomBrowserSockets('room_1')
  })
})
