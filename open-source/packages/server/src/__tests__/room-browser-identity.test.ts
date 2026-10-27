// @covers open-source/packages/server/src/services/room-browser-identity.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyRequest } from 'fastify'
const mocks = vi.hoisted(() => ({
  identity: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  sessions: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  publish: vi.fn(), notify: vi.fn(), scoped: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: { roomBrowserIdentity: mocks.identity, roomBrowserSession: mocks.sessions } }))
vi.mock('../relay/connection-control.js', () => ({ publishRoomBrowserSessionRevoked: mocks.publish }))
vi.mock('../services/room-browser-notifications.js', () => ({ notifyRoomBrowserAccessChanged: mocks.notify }))
vi.mock('../services/room-browser-session.js', async () => ({
  ...await vi.importActual('../services/room-browser-session.js'), authenticateRoomBrowserSession: mocks.scoped,
}))
import { authenticateRoomBrowserRequest, findRoomBrowserIdentity, logoutRoomBrowser, readRoomIdentityCookie,
  clearRoomIdentityCookie, trustedRoomBrowserRequest } from '../services/room-browser-identity.js'
import { RoomBrowserSessionError } from '../services/room-browser-session.js'
const token = 'i'.repeat(43)
function request(headers: Record<string, string> = {}) {
  return { protocol: 'https', host: 'app.shennian.net', hostname: 'app.shennian.net',
    headers: { cookie: `__Host-shennian-room-identity=${token}`, ...headers } } as FastifyRequest
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.scoped.mockImplementation(async (token, roomId) => {
    if (!token) throw new RoomBrowserSessionError('room_browser_session_unavailable')
    return { id: 'session_1', roomId }
  })
  mocks.identity.findUnique.mockResolvedValue(null)
  mocks.sessions.findFirst.mockResolvedValue(null)
})
describe('retired cross-room identity and explicit Room grants', () => {
  it('never uses even a valid remembered identity to grant or join another room', async () => {
    mocks.identity.findUnique.mockResolvedValue({ id: 'old_identity', status: 'active', userId: 'user_1' })
    expect(await findRoomBrowserIdentity(request())).toBeNull()
    await expect(authenticateRoomBrowserRequest(request(), 'room_2')).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.identity.findUnique).not.toHaveBeenCalled()
    expect(mocks.identity.create).not.toHaveBeenCalled()
    expect(mocks.sessions.create).not.toHaveBeenCalled()
  })
  it('selects only the explicitly requested room cookie across simultaneous tabs', async () => {
    const req = request({ cookie: `__Host-shennian-room-room_1=${'a'.repeat(43)}; __Host-shennian-room-room_2=${'b'.repeat(43)}` })
    await authenticateRoomBrowserRequest(req, 'room_2')
    expect(mocks.scoped).toHaveBeenCalledWith('b'.repeat(43), 'room_2', expect.any(Date))
    await expect(authenticateRoomBrowserRequest(req, 'room_3')).rejects.toMatchObject({ statusCode: 401 })
  })
  it('does not fall back to remembered identity after revocation or expiry', async () => {
    mocks.scoped.mockRejectedValue(new RoomBrowserSessionError('room_browser_session_unavailable'))
    await expect(authenticateRoomBrowserRequest(request({cookie: `__Host-shennian-room-room_1=${token}; __Host-shennian-room-identity=${token}`}), 'room_1'))
      .rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.identity.findUnique).not.toHaveBeenCalled()
    expect(mocks.sessions.create).not.toHaveBeenCalled()
  })
  it('logout revokes only this browser token in this group and invalidates the phone indicator', async () => {
    mocks.sessions.findFirst.mockResolvedValue({ id: 's1', roomId: 'room_1', userId: 'user_1' })
    await logoutRoomBrowser(request({ cookie: `__Host-shennian-room-room_1=${token}` }), 'room_1')
    expect(mocks.sessions.updateMany).toHaveBeenCalledWith({ where: { tokenHash: expect.any(String), status: 'active' }, data: { status: 'revoked' } })
    expect(mocks.publish).toHaveBeenCalledWith('s1')
    expect(mocks.notify).toHaveBeenCalledWith('user_1', 'room_1')
  })
  it('cannot log out a different group through the legacy fallback', async () => {
    mocks.sessions.findFirst.mockResolvedValue({ id: 's1', roomId: 'room_1', userId: 'user_1' })
    await logoutRoomBrowser(request({ cookie: `__Host-shennian-room=${token}` }), 'room_2')
    expect(mocks.sessions.updateMany).not.toHaveBeenCalled()
  })
  it('rejects ambiguous identity cookies and untrusted origins before any authorization', async () => {
    expect(readRoomIdentityCookie(request({ cookie: `__Host-shennian-room-identity=${token}; shennian-room-identity-dev=${token}` }))).toBeUndefined()
    for (const origin of ['https://evil.example', 'https://evil.shennian.net', 'null']) {
      await expect(authenticateRoomBrowserRequest(request({ origin }), 'room_1')).rejects.toMatchObject({ statusCode: 403 })
      await expect(findRoomBrowserIdentity(request({ origin }))).rejects.toMatchObject({ statusCode: 403 })
    }
    expect(trustedRoomBrowserRequest(request({ origin: 'https://app.shennian.net' }))).toBe(true)
    expect(trustedRoomBrowserRequest(request({ 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(trustedRoomBrowserRequest(request({ origin: 'http://localhost:8081' }))).toBe(false)
    expect(clearRoomIdentityCookie(request())).toContain('Max-Age=0')
  })
})
