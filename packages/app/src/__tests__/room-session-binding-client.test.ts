// @covers packages/app/src/features/rooms/roomAccountClient.web.ts
// @covers packages/app/src/features/rooms/roomAccountClient.native.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { roomAccountClient as desktop } from '../features/rooms/roomAccountClient.web'
import { roomAccountClient as native } from '../features/rooms/roomAccountClient.native'

const { authApi } = vi.hoisted(() => ({ authApi: vi.fn() }))
vi.mock('../config/api', () => ({ authApi }))
type Root = typeof globalThis & { shennianDesktop?: unknown }
const binding = {
  id: 'binding-1', status: 'active', activationMode: 'auto_follow', agentDisplayName: 'Agent',
  room: { id: 'room-1', name: 'Room', status: 'active' },
}
afterEach(() => {
  delete (globalThis as Root).shennianDesktop
  vi.clearAllMocks()
})

describe('Room Session binding platform client', () => {
  it('looks up a binding through the fixed main command and preserves confirmed absence', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ ok: true, value: { binding } })
      .mockResolvedValueOnce({ ok: true, value: { binding: null } })
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    await expect(desktop.getSessionBinding('session-1')).resolves.toEqual(binding)
    expect(execute).toHaveBeenCalledWith({ requestId: expect.any(String),
      operation: 'room.binding.getBySession', input: { sessionId: 'session-1' } })
    await expect(desktop.getSessionBinding('session-2')).resolves.toBeNull()
    expect(authApi).not.toHaveBeenCalled()
  })

  it('rejects malformed binding data rather than inventing absence', async () => {
    const execute = vi.fn()
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    for (const value of [{}, { binding: {} }, { binding: { ...binding, activationMode: 'unknown' } },
      { binding: { ...binding, room: { ...binding.room, id: null } } }]) {
      execute.mockResolvedValueOnce({ ok: true, value })
      await expect(desktop.getSessionBinding('session-1')).rejects.toMatchObject({ code: 'INVALID_OUTPUT' })
    }
  })

  it('propagates bridge failures without making an HTTP fallback', async () => {
    await expect(desktop.getSessionBinding('session-1')).rejects.toMatchObject({ code: 'BRIDGE_UNAVAILABLE' })
    const execute = vi.fn().mockResolvedValue({ ok: false,
      error: { code: 'AUTH_REQUIRED', message: 'Sign in required', retryable: false, action: 'sign_in' } })
    ;(globalThis as Root).shennianDesktop = { account: { execute } }
    await expect(desktop.getSessionBinding('session-1')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(authApi).not.toHaveBeenCalled()
  })

  it('keeps the Native binding endpoint and its nullable response', async () => {
    authApi.mockResolvedValueOnce({ binding }).mockResolvedValueOnce({ binding: null })
    await expect(native.getSessionBinding('session/1')).resolves.toEqual(binding)
    expect(authApi).toHaveBeenCalledWith('/rooms/session/session%2F1/binding')
    await expect(native.getSessionBinding('session-2')).resolves.toBeNull()
  })
})
