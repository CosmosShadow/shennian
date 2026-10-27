// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type { User } from '@shennian/shared/auth'

export type ProfileDevice = {
  id: string
  platform: string
  name: string
  lastActiveAt: string
  createdAt: string
  current: boolean
}

export type ProfileAvatar = NonNullable<User['avatar']>

export type ProfileAccountClient = {
  getProfile(): Promise<User>
  updateProfile(name: string): Promise<User>
  setAvatar(
    image: Blob,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  ): Promise<ProfileAvatar>
  removeAvatar(): Promise<void>
  listDevices(): Promise<ProfileDevice[]>
  revokeDevice(deviceId: string): Promise<void>
  deleteAccount(operationId: string): Promise<void>
}

export type ProfileDeviceClient = Pick<ProfileAccountClient, 'listDevices' | 'revokeDevice'>
