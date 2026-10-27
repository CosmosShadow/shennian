/**
 * @covers packages/app/src/features/account/profileAccountClient.web.ts
 * @covers packages/app/src/features/account/profileAccountClient.native.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopProfileAccountError,
  profileAccountClient,
} from '../features/account/profileAccountClient.web'

type DesktopRoot = typeof globalThis & { shennianDesktop?: unknown }

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

afterEach(() => {
  delete (globalThis as DesktopRoot).shennianDesktop
})

describe('Desktop Profile account client', () => {
  it('fails closed when the main-process account bridge is absent', async () => {
    await expect(profileAccountClient.getProfile()).rejects.toEqual(
      expect.objectContaining<Partial<DesktopProfileAccountError>>({
        name: 'DesktopProfileAccountError',
        code: 'BRIDGE_UNAVAILABLE',
      }),
    )
  })

  it('uses fixed Profile and device operations without HTTP request details', async () => {
    const user = { id: 'user-1', name: 'New Name' }
    const device = {
      id: 'device-1',
      platform: 'macos',
      name: 'Mac',
      lastActiveAt: '2026-09-10T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      current: true,
    }
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { user } })
      .mockResolvedValueOnce({ ok: true, value: { user } })
      .mockResolvedValueOnce({ ok: true, value: [device] })
      .mockResolvedValueOnce({ ok: true, value: {} })
      .mockResolvedValueOnce({ ok: true, value: { ok: true } })
    ;(globalThis as DesktopRoot).shennianDesktop = { account: { execute } }

    await expect(profileAccountClient.getProfile()).resolves.toEqual(user)
    await expect(profileAccountClient.updateProfile('New Name')).resolves.toEqual(user)
    await expect(profileAccountClient.listDevices()).resolves.toEqual([device])
    await profileAccountClient.revokeDevice('device-1')
    await profileAccountClient.deleteAccount('operation-1')

    expect(execute.mock.calls.map(([command]) => command.operation)).toEqual([
      'account.profile.get',
      'account.profile.update',
      'account.devices.list',
      'account.device.revoke',
      'account.delete',
    ])
    expect(execute).toHaveBeenNthCalledWith(2, {
      requestId: expect.stringMatching(/^profile-account-/),
      operation: 'account.profile.update',
      input: { name: 'New Name' },
    })
    expect(execute).toHaveBeenNthCalledWith(4, {
      requestId: expect.stringMatching(/^profile-account-/),
      operation: 'account.device.revoke',
      input: { deviceId: 'device-1' },
    })
    expect(JSON.stringify(execute.mock.calls)).not.toContain('/auth/')
    expect(JSON.stringify(execute.mock.calls)).not.toContain('DELETE')
    expect(JSON.stringify(execute.mock.calls)).not.toContain('Authorization')
  })

  it('serializes avatar bytes and validates the main-process response', async () => {
    const avatar = {
      version: 'avatar-v1',
      smallUrl: '/public/avatar/96',
      mediumUrl: '/public/avatar/256',
      updatedAt: '2026-09-10T00:00:00.000Z',
    }
    const execute = vi.fn().mockResolvedValue({ ok: true, value: { avatar } })
    ;(globalThis as DesktopRoot).shennianDesktop = { account: { execute } }

    await expect(
      profileAccountClient.setAvatar(
        new Blob([new Uint8Array([1, 2, 3])]),
        'image/jpeg',
      ),
    ).resolves.toEqual(avatar)
    expect(execute).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^profile-account-/),
      operation: 'account.avatar.set',
      input: { contentType: 'image/jpeg', base64: 'AQID' },
    })

    execute.mockResolvedValueOnce({ ok: true, value: { avatar: null } })
    await expect(profileAccountClient.removeAvatar()).resolves.toBeUndefined()
  })

  it('keeps authenticated HTTP in the native adapter', () => {
    const native = read('../features/account/profileAccountClient.native.ts')
    const web = read('../features/account/profileAccountClient.web.ts')
    const profileDevices = read('../config/profileDevices.ts')
    const authSession = read('../config/authSession.ts')
    const avatarEditor = read('../features/profile/components/ProfileAvatarEditor.tsx')

    expect(native).toContain("import { authApi } from '../../config/api'")
    expect(() => read('../features/account/profileAccountClient.browser.ts')).toThrow()
    expect(web).not.toContain('authApi')
    expect(web).not.toContain("'/auth/")
    for (const source of [profileDevices, authSession, avatarEditor]) {
      expect(source).not.toContain('authApi')
      expect(source).toContain('profileAccountClient')
    }
  })
})
