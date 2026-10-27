// @arch docs/features/desktop-login-and-first-use.md
// @test ../../__tests__/desktop-login-and-first-use.test.ts

export type DesktopEntryIntent =
  | { kind: 'workspace' }
  | { kind: 'room'; path: string }
  | { kind: 'machine-invite'; path: string }
  | { kind: 'authorization'; path: string }

export type DesktopRecoverySurface =
  | 'none'
  | 'credential-store-unavailable'
  | 'credential-corrupt'
  | 'access-revoked'
  | 'session-expired'

const ROOM = /^\/spaces\/[A-Za-z0-9_-]{1,128}$/
const MACHINE_INVITE = /^\/machine-invites\/[A-Za-z0-9_-]{16,128}$/
const AUTHORIZATION = /^\/authorize\/[A-Za-z0-9_-]{8,128}$/

/** Classifies only paths that already passed sanitizeAuthRedirect. */
export function getDesktopEntryIntent(path: string): DesktopEntryIntent {
  if (ROOM.test(path)) return { kind: 'room', path }
  if (MACHINE_INVITE.test(path)) return { kind: 'machine-invite', path }
  if (AUTHORIZATION.test(path)) return { kind: 'authorization', path }
  return { kind: 'workspace' }
}

export function getDesktopRecoverySurface(
  status: 'online' | 'offline' | 'missing' | 'revoked' | 'expired' | 'unavailable' | 'corrupt',
): DesktopRecoverySurface {
  if (status === 'unavailable') return 'credential-store-unavailable'
  if (status === 'corrupt') return 'credential-corrupt'
  if (status === 'revoked') return 'access-revoked'
  if (status === 'expired') return 'session-expired'
  return 'none'
}

export function desktopRecoveryAction(
  surface: DesktopRecoverySurface,
): 'retry-restore' | 'fresh-login' | 'none' {
  if (surface === 'credential-store-unavailable') return 'retry-restore'
  if (surface === 'none') return 'none'
  return 'fresh-login'
}

/** Desktop uses one login/register entry even if an old Web signup URL is opened. */
export function getLoginFormTitleKey(
  desktop: boolean,
  requestedMode: string | undefined,
): 'login_form_title_default' | 'login_form_title_signup' {
  return !desktop && requestedMode === 'signup'
    ? 'login_form_title_signup'
    : 'login_form_title_default'
}
