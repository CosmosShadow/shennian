// @arch docs/features/desktop-local-first-client.md
// @test ../__tests__/desktop-crash-recovery.test.ts

import {
  isRegisteredDesktopWorkspacePath,
  normalizeDesktopPathname,
} from '../features/desktop-shell/desktopRouteRegistry'

const STORAGE_KEY = 'shennian.desktop.crashRecovery.v1'
const STORAGE_VERSION = 1
const MAX_HREF_LENGTH = 4096
const MAX_QUERY_VALUE_LENGTH = 2048

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StoredRecoveryRoute = {
  version: typeof STORAGE_VERSION
  accountId: string
  href: string
}

type RecoveryOptions = {
  enabled: boolean
  accountId: string | null | undefined
  storage?: RecoveryStorage
}

const SENSITIVE_PATH_SEGMENTS = new Set([
  'auth',
  'authorize',
  'desktop',
  'invite',
  'invites',
  'join',
  'landing',
  'login',
  'machine-invites',
  'pair',
  'pairing',
  'privacy',
  'profile',
  'room-join',
  'scan',
  'support',
])

const SENSITIVE_QUERY_KEYS =
  /(?:^|[-_])(auth|code|credential|invite|nonce|pair|password|redirect|secret|state|ticket|token)(?:$|[-_])/i

// Navigation includes forms and capability pages. Recovery deliberately does not.
const RECOVERY_ROUTES: Readonly<Record<string, { keys: readonly string[]; required: readonly string[] }>> = {
  '/': { keys: [], required: [] },
  '/agents': { keys: [], required: [] },
  '/machines': { keys: [], required: [] },
  '/spaces': { keys: [], required: [] },
  '/project': { keys: ['machineId', 'workDir'], required: ['machineId', 'workDir'] },
  '/machine-agents': { keys: ['machineId'], required: ['machineId'] },
  '/machine-sharing': { keys: ['machineId'], required: ['machineId'] },
  '/room-workspace': { keys: ['roomId', 'agentSessionId', 'scopedAgentSessionId'], required: ['roomId'] },
  '/spaces/details': { keys: ['roomId'], required: ['roomId'] },
  '/spaces/members': { keys: ['roomId'], required: ['roomId'] },
  '/spaces/browser-sessions': { keys: ['roomId'], required: ['roomId'] },
}

function getDesktopRecoveryStorage(): RecoveryStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function hasSensitivePath(pathname: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname).toLowerCase()
  } catch {
    return true
  }
  return decoded
    .split('/')
    .filter(Boolean)
    .some((segment) => SENSITIVE_PATH_SEGMENTS.has(segment))
}

export function isDesktopWorkspaceRoot(pathname: string): boolean {
  return normalizeDesktopPathname(pathname) === '/'
}

export function sanitizeDesktopRecoveryHref(href: string | null | undefined): string | null {
  const value = href?.trim()
  if (!value || value.length > MAX_HREF_LENGTH || !value.startsWith('/') || value.startsWith('//'))
    return null
  // Check the original pathname before URL parsing can erase traversal segments.
  if (!isRegisteredDesktopWorkspacePath(value.split(/[?#]/, 1)[0])) return null

  let url: URL
  try {
    url = new URL(value, 'https://desktop.shennian.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://desktop.shennian.invalid') return null

  const pathname = normalizeDesktopPathname(url.pathname)
  if (hasSensitivePath(pathname) || !isRegisteredDesktopWorkspacePath(pathname)) return null

  const policy = RECOVERY_ROUTES[pathname] ?? (
    /^\/(?:chat|machine)\/[A-Za-z0-9._~-]+$/.test(pathname)
      ? { keys: [], required: [] }
      : /^\/agents\/(?!new$)[A-Za-z0-9._~-]+$/.test(pathname)
        ? { keys: ['contextRoomId'], required: [] }
        : null
  )
  if (!policy) return null
  const allowedKeys = new Set(policy.keys)
  const safeQuery = new URLSearchParams()
  for (const [key, queryValue] of url.searchParams) {
    if (
      !allowedKeys.has(key) ||
      SENSITIVE_QUERY_KEYS.test(key) ||
      queryValue.length > MAX_QUERY_VALUE_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(queryValue)
    ) {
      continue
    }
    if (key !== 'workDir' && (!/^[A-Za-z0-9._~-]{1,191}$/.test(queryValue) || queryValue === '.' || queryValue === '..')) return null
    if (safeQuery.has(key)) return null
    safeQuery.append(key, queryValue)
  }

  if (policy.required.some(key => !safeQuery.get(key))) return null
  const query = safeQuery.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function recordDesktopCrashRecoveryRoute(
  href: string,
  { enabled, accountId, storage }: RecoveryOptions,
): boolean {
  if (!enabled || !accountId) return false
  const safeHref = sanitizeDesktopRecoveryHref(href)
  if (!safeHref) return false
  const target = storage ?? getDesktopRecoveryStorage()
  if (!target) return false
  try {
    const payload: StoredRecoveryRoute = { version: STORAGE_VERSION, accountId, href: safeHref }
    target.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function readDesktopCrashRecoveryRoute({
  enabled,
  accountId,
  storage,
}: RecoveryOptions): string | null {
  if (!enabled || !accountId) return null
  const target = storage ?? getDesktopRecoveryStorage()
  if (!target) return null
  try {
    const raw = target.getItem(STORAGE_KEY)
    if (!raw) return null
    const payload = JSON.parse(raw) as Partial<StoredRecoveryRoute>
    if (payload.version !== STORAGE_VERSION || payload.accountId !== accountId) return null
    const safeHref = sanitizeDesktopRecoveryHref(payload.href)
    if (!safeHref) {
      target.removeItem(STORAGE_KEY)
      return null
    }
    return safeHref
  } catch {
    try {
      target.removeItem(STORAGE_KEY)
    } catch {
      // A denied localStorage must not prevent the shell from starting.
    }
    return null
  }
}

/**
 * The account-scoped shell snapshot is written together with navigation and
 * reading state, so it is the authoritative last workspace location. The
 * smaller v1 route record remains a migration fallback for existing installs.
 */
export function resolveDesktopRecoveryHref(
  shellHref: string | null | undefined,
  legacyHref: string | null | undefined,
): string | null {
  return sanitizeDesktopRecoveryHref(shellHref) ?? sanitizeDesktopRecoveryHref(legacyHref)
}
