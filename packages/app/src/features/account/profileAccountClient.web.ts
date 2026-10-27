// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type { User } from '@shennian/shared/auth'
import type {
  ProfileAccountClient,
  ProfileAvatar,
  ProfileDevice,
} from './profileAccountClient.types'

type ProfileOperation =
  | 'account.profile.get'
  | 'account.profile.update'
  | 'account.avatar.set'
  | 'account.avatar.remove'
  | 'account.devices.list'
  | 'account.device.revoke'
  | 'account.delete'

type DesktopResult =
  | { ok: true; value: unknown }
  | {
      ok: false
      error: {
        code: string
        message: string
        retryable: boolean
        action?: 'retry' | 'sign_in'
      }
    }

type DesktopProfileAccountBridge = {
  execute(command: {
    requestId: string
    operation: ProfileOperation
    input: Record<string, unknown>
  }): Promise<DesktopResult>
}

type DesktopProfileWindow = typeof globalThis & {
  shennianDesktop?: { account?: DesktopProfileAccountBridge }
}

let requestSequence = 0

export class DesktopProfileAccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopProfileAccountError'
  }
}

export const profileAccountClient: ProfileAccountClient = {
  async getProfile() {
    return requireUser(requireObject(await execute('account.profile.get', {})).user)
  },
  async updateProfile(name) {
    return requireUser(requireObject(await execute('account.profile.update', { name })).user)
  },
  async setAvatar(image, contentType) {
    const value = await execute('account.avatar.set', {
      contentType,
      base64: bytesToBase64(new Uint8Array(await image.arrayBuffer())),
    })
    return requireAvatar(requireObject(value).avatar)
  },
  async removeAvatar() {
    const value = requireObject(await execute('account.avatar.remove', {}))
    if (value.avatar !== null) throw invalidOutput()
  },
  async listDevices() {
    const value = await execute('account.devices.list', {})
    if (!Array.isArray(value)) throw invalidOutput()
    return value.map(requireDevice)
  },
  async revokeDevice(deviceId) {
    await execute('account.device.revoke', { deviceId })
  },
  async deleteAccount(operationId) {
    const value = requireObject(await execute('account.delete', { operationId }))
    if (value.ok !== true) throw invalidOutput()
  },
}

function requireBridge(): DesktopProfileAccountBridge {
  const bridge = (globalThis as DesktopProfileWindow).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopProfileAccountError(
      'BRIDGE_UNAVAILABLE',
      'Desktop Profile account bridge is unavailable.',
      false,
    )
  }
  return bridge
}

async function execute(operation: ProfileOperation, input: Record<string, unknown>): Promise<unknown> {
  const requestId = `profile-account-${Date.now()}-${++requestSequence}`
  const result = await requireBridge().execute({ requestId, operation, input })
  if (result.ok) return result.value
  throw new DesktopProfileAccountError(
    result.error.code,
    result.error.message,
    result.error.retryable,
    result.error.action,
  )
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOutput()
  return value as Record<string, unknown>
}

function requireUser(value: unknown): User {
  const user = requireObject(value)
  if (typeof user.id !== 'string' || typeof user.name !== 'string') throw invalidOutput()
  return user as User
}

function requireAvatar(value: unknown): ProfileAvatar {
  const avatar = requireObject(value)
  if (
    typeof avatar.version !== 'string' ||
    typeof avatar.smallUrl !== 'string' ||
    typeof avatar.mediumUrl !== 'string' ||
    typeof avatar.updatedAt !== 'string'
  ) throw invalidOutput()
  return avatar as ProfileAvatar
}

function requireDevice(value: unknown): ProfileDevice {
  const device = requireObject(value)
  if (
    typeof device.id !== 'string' ||
    typeof device.platform !== 'string' ||
    typeof device.name !== 'string' ||
    typeof device.lastActiveAt !== 'string' ||
    typeof device.createdAt !== 'string' ||
    typeof device.current !== 'boolean'
  ) throw invalidOutput()
  return device as ProfileDevice
}

function invalidOutput(): DesktopProfileAccountError {
  return new DesktopProfileAccountError(
    'INVALID_OUTPUT',
    'Desktop Profile response is invalid.',
    false,
  )
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 16 * 1024)))
  }
  return btoa(binary)
}
