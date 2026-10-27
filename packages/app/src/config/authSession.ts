// @test src/__tests__/root-auth-session.test.ts

import { useAuthStore } from './auth'
import { seedProfileDevices } from './profileDevices'
import { profileAccountClient } from '../features/account/profileAccountClient'

export async function validateStoredSession(): Promise<void> {
  if (!useAuthStore.getState().isAuthenticated) return

  try {
    const [user, devices] = await Promise.all([
      profileAccountClient.getProfile(),
      profileAccountClient.listDevices(),
    ])
    seedProfileDevices(user.id, devices)
    const { token, refreshToken } = useAuthStore.getState()
    if (token && refreshToken) {
      await useAuthStore.getState().login(token, refreshToken, user)
    }
  } catch {
    // Remote validation must not block startup or destroy a recoverable local session.
  }
}

export async function refreshCurrentUser(): Promise<void> {
  if (!useAuthStore.getState().isAuthenticated) return

  const user = await profileAccountClient.getProfile()
  const { token, refreshToken } = useAuthStore.getState()
  if (token && refreshToken) {
    await useAuthStore.getState().login(token, refreshToken, user)
  }
}
