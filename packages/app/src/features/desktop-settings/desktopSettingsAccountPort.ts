// @arch docs/features/desktop-settings-information-architecture.md#数据与平台边界
// @test ../../__tests__/desktop-settings-account-port.test.ts

import type { ProfileDevice } from '../account/profileAccountClient.types'
import type {
  RoomInvitationClient,
  RoomInvitationExchange,
  RoomInvitationResult,
} from '../rooms/roomInvitationClient.types'
import { parseDesktopDeviceSnapshot, type DesktopDeviceSnapshot } from './desktopProfileDevices'

type Operation =
  | 'account.profile.update'
  | 'account.avatar.set'
  | 'account.devices.list'
  | 'account.devices.getState'
  | 'account.device.revoke'
  | 'account.delete'
  | 'room.invitation.exchange'
  | 'room.invitation.join'

type Result =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean; action?: 'retry' | 'sign_in' } }

type AccountBridge = {
  execute(command: {
    requestId: string
    operation: Operation
    input: Record<string, unknown>
  }): Promise<Result>
}

type DataBridge = {
  subscribe(listener: (event: { accountId: string; topic?: string; revision?: number }) => void): () => void
}

type DesktopWindow = typeof globalThis & {
  shennianDesktop?: { account?: AccountBridge; data?: DataBridge }
}

let sequence = 0

export class DesktopSettingsAccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopSettingsAccountError'
  }
}

export const desktopSettingsAccountPort = {
  async updateProfile(name: string): Promise<void> {
    const value = object(await execute('account.profile.update', { name }))
    const user = object(value.user)
    if (typeof user.id !== 'string' || !user.id || typeof user.name !== 'string') invalidOutput()
  },

  async setAvatar(
    image: Blob,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  ): Promise<void> {
    const value = object(await execute('account.avatar.set', {
      contentType,
      base64: bytesToBase64(new Uint8Array(await image.arrayBuffer())),
    }))
    const avatar = object(value.avatar)
    if (
      typeof avatar.version !== 'string' ||
      typeof avatar.smallUrl !== 'string' ||
      typeof avatar.mediumUrl !== 'string' ||
      typeof avatar.updatedAt !== 'string'
    ) invalidOutput()
  },

  async refreshDevices(): Promise<void> {
    const value = await execute('account.devices.list', {})
    if (!Array.isArray(value) || value.length > 1000) invalidOutput()
    value.forEach(requireDevice)
  },

  async readDeviceSnapshot(): Promise<DesktopDeviceSnapshot> {
    return parseDesktopDeviceSnapshot(await execute('account.devices.getState', {}))
  },

  subscribeDeviceRevision(accountId: string, listener: () => void): () => void {
    const data = requireDataBridge()
    return data.subscribe(event => {
      if (event.accountId === accountId && event.topic === 'account.devices') listener()
    })
  },

  async revokeDevice(deviceId: string): Promise<void> {
    await execute('account.device.revoke', { deviceId })
  },

  async deleteAccount(operationId: string): Promise<void> {
    const value = object(await execute('account.delete', { operationId }))
    if (value.ok !== true) invalidOutput()
  },
}

export const desktopSettingsInvitationPort: RoomInvitationClient = {
  async exchange(input): Promise<RoomInvitationExchange> {
    const value = object(await execute('room.invitation.exchange', input))
    let roomId: unknown
    if (value.entryState === 'can_join') {
      const invite = object(value.invite)
      const room = object(invite.room)
      roomId = room.id
      if (
        typeof value.joinHandle !== 'string' || !value.joinHandle ||
        typeof room.name !== 'string' || typeof room.description !== 'string' ||
        !['open', 'approval', 'closed'].includes(String(room.joinPolicy))
      ) invalidOutput()
    } else if (value.entryState === 'joined' || value.entryState === 'pending_approval') {
      roomId = value.roomId
    } else invalidOutput()
    if (typeof roomId !== 'string' || !roomId || (input.roomId && roomId !== input.roomId)) invalidOutput()
    return value as RoomInvitationExchange
  },

  async join(input): Promise<RoomInvitationResult> {
    const value = object(await execute('room.invitation.join', input))
    if (
      !['joined', 'pending_approval'].includes(String(value.outcome)) ||
      typeof value.roomId !== 'string' || !value.roomId ||
      (value.joinRequestId !== undefined &&
        (typeof value.joinRequestId !== 'string' || !value.joinRequestId))
    ) invalidOutput()
    return value as RoomInvitationResult
  },
}

function requireAccountBridge(): AccountBridge {
  const account = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!account || typeof account.execute !== 'function') {
    throw new DesktopSettingsAccountError(
      'BRIDGE_UNAVAILABLE',
      'Desktop settings account bridge is unavailable.',
      false,
    )
  }
  return account
}

function requireDataBridge(): DataBridge {
  const data = (globalThis as DesktopWindow).shennianDesktop?.data
  if (!data || typeof data.subscribe !== 'function') {
    throw new DesktopSettingsAccountError(
      'BRIDGE_UNAVAILABLE',
      'Desktop settings data bridge is unavailable.',
      false,
    )
  }
  return data
}

async function execute(operation: Operation, input: Record<string, unknown>): Promise<unknown> {
  const result = await requireAccountBridge().execute({
    requestId: `desktop-settings-${++sequence}`,
    operation,
    input,
  })
  if (result.ok) return result.value
  throw new DesktopSettingsAccountError(
    result.error.code,
    result.error.message,
    result.error.retryable,
    result.error.action,
  )
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidOutput()
  return value as Record<string, unknown>
}

function requireDevice(value: unknown): ProfileDevice {
  const device = object(value)
  const keys = ['id', 'platform', 'name', 'lastActiveAt', 'createdAt', 'current']
  if (
    Object.keys(device).length !== keys.length ||
    !Object.keys(device).every(key => keys.includes(key)) ||
    typeof device.id !== 'string' || !device.id ||
    typeof device.platform !== 'string' ||
    typeof device.name !== 'string' ||
    typeof device.lastActiveAt !== 'string' ||
    typeof device.createdAt !== 'string' ||
    typeof device.current !== 'boolean'
  ) invalidOutput()
  return device as ProfileDevice
}

function invalidOutput(): never {
  throw new DesktopSettingsAccountError(
    'INVALID_OUTPUT',
    'Desktop settings account response is invalid.',
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
