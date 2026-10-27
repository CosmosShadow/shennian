// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-route-registry.test.ts

const WORKSPACE_ROUTES = new Set([
  '/',
  '/agents',
  '/agents/new',
  '/contacts',
  '/plaza',
  '/machine-agents',
  '/machine-sharing',
  '/machines',
  '/project',
  '/room-workspace',
  '/spaces',
  '/spaces/details',
  '/spaces/manage',
  '/spaces/members',
  '/spaces/invite',
  '/spaces/browser-sessions',
  '/spaces/agent-add',
  '/spaces/agent-settings',
])

export function normalizeDesktopPathname(pathname: string): string {
  const withoutRouteGroup = pathname.replace(/^\/\(main\)(?=\/|$)/, '') || '/'
  return withoutRouteGroup.length > 1 ? withoutRouteGroup.replace(/\/+$/, '') : withoutRouteGroup
}

export function isDesktopSettingsPathname(pathname: string): boolean {
  return normalizeDesktopPathname(pathname) === '/profile'
}

export function isRegisteredDesktopWorkspacePath(pathname: string): boolean {
  if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\%?#\u0000-\u0020\u007f]/.test(pathname)) return false
  const normalized = normalizeDesktopPathname(pathname)
  if (normalized.split('/').some(segment => segment === '.' || segment === '..')) return false
  if (WORKSPACE_ROUTES.has(normalized)) return true
  if (/^\/chat\/[A-Za-z0-9._~-]{1,191}(?:\/preview)?$/.test(normalized)) return true
  if (/^\/machine\/[A-Za-z0-9._~-]{1,191}$/.test(normalized)) return true
  return /^\/agents\/(?!new(?:\/|$))[A-Za-z0-9._~-]{1,191}(?:\/settings)?$/.test(normalized)
}
