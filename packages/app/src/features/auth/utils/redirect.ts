// @arch docs/architecture/app/modular-features.md#登录-feature

export const DEFAULT_AUTH_REDIRECT = '/(main)'

const AUTHORIZATION_REDIRECT = /^\/authorize\/[A-Za-z0-9_-]{8,128}$/
const ROOM_PAGE_REDIRECT = /^\/spaces\/[A-Za-z0-9_-]{1,128}$/
const MACHINE_INVITE_REDIRECT = /^\/machine-invites\/[A-Za-z0-9_-]{16,128}$/
const PERSON_PAGE_REDIRECT = /^\/contacts\/users\/[A-Za-z0-9_-]{8,64}$/
const MAIN_APP_REDIRECT = /^\/\(main\)(?:\/[A-Za-z0-9_-]{1,128})*$/

export function sanitizeAuthRedirect(
  value: unknown,
  fallback: string = DEFAULT_AUTH_REDIRECT,
): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  if (trimmed.includes('://') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return fallback
  }
  if (
    MAIN_APP_REDIRECT.test(trimmed) ||
    AUTHORIZATION_REDIRECT.test(trimmed) ||
    ROOM_PAGE_REDIRECT.test(trimmed)
    || MACHINE_INVITE_REDIRECT.test(trimmed)
    || PERSON_PAGE_REDIRECT.test(trimmed)
  ) return trimmed
  return fallback
}
