// @arch docs/features/desktop-local-first-client.md#53-登录恢复
// @test packages/app/src/__tests__/desktop-auth-recovery.test.ts

import { getDesktopRecoverySurface, type DesktopRecoverySurface } from '../desktop-onboarding/desktopEntryState'

export type DesktopAuthRecoveryIssue = Exclude<DesktopRecoverySurface, 'none'>

type Listener = () => void

let currentIssue: DesktopAuthRecoveryIssue | null = null
const listeners = new Set<Listener>()

export function getDesktopAuthRecoveryIssue(): DesktopAuthRecoveryIssue | null {
  return currentIssue
}

export function getDesktopAuthRecoveryServerSnapshot(): null {
  return null
}

export function subscribeDesktopAuthRecoveryIssue(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setDesktopAuthRecoveryStatus(
  status: 'online' | 'offline' | 'missing' | 'revoked' | 'expired' | 'unavailable' | 'corrupt',
): void {
  const surface = getDesktopRecoverySurface(status)
  const nextIssue = surface === 'none' ? null : surface
  if (nextIssue === currentIssue) return
  currentIssue = nextIssue
  for (const listener of listeners) listener()
}

export function beginDesktopFreshLogin(): void {
  setDesktopAuthRecoveryStatus('missing')
}
