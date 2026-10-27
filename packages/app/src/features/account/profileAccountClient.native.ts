// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type { User } from '@shennian/shared/auth'
import { authApi } from '../../config/api'
import type {
  ProfileAccountClient,
  ProfileAvatar,
  ProfileDevice,
} from './profileAccountClient.types'

export const profileAccountClient: ProfileAccountClient = {
  async getProfile() {
    return (await authApi<{ user: User }>('/auth/me')).user
  },
  async updateProfile(name) {
    return (await authApi<{ user: User }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })).user
  },
  async setAvatar(image, contentType) {
    return (await authApi<{ avatar: ProfileAvatar }>('/auth/me/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: image,
    })).avatar
  },
  async removeAvatar() {
    await authApi('/auth/me/avatar', { method: 'DELETE' })
  },
  async listDevices() {
    return authApi<ProfileDevice[]>('/auth/devices')
  },
  async revokeDevice(deviceId) {
    await authApi(`/auth/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
  },
  async deleteAccount(operationId) {
    await authApi<{ ok: boolean }>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ operationId }),
    })
  },
}
