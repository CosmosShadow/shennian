// @arch docs/architecture/server/auth-flows.md
import type { User } from '@shennian/shared/auth'
import { api } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { profileAccountClient } from '../account/profileAccountClient'
import { requestNicknameSetup } from './nicknameSetup'

export type ScopedNicknameSetup = { name: string; token: string }

export function offerAccountNicknameSetup(user: User) {
  if (user.nameSetupRequired !== true) return
  void requestNicknameSetup({
    name: user.name,
    accountId: user.id,
    save: async (name) => {
      if (useAuthStore.getState().user?.id !== user.id) return
      const updated = await profileAccountClient.updateProfile(name)
      if (useAuthStore.getState().user?.id !== user.id) return
      useAuthStore.setState({ user: updated })
      await useAuthStore.getState().flushStorage()
    },
  })
}

export async function offerScopedNicknameSetup(setup?: ScopedNicknameSetup) {
  if (!setup) return
  await requestNicknameSetup({
    name: setup.name,
    save: async (name) => {
      await api('/auth/nickname-setup', {
        method: 'PATCH', credentials: 'omit',
        body: JSON.stringify({ token: setup.token, name }),
      })
    },
  })
}
