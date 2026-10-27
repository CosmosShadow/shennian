// @arch docs/features/desktop-local-first-client.md#八desktop-产品与交互规范
// @test packages/app/src/__tests__/desktop-room-navigation-target.test.ts

export type AuthenticatedRoomNavigationTarget =
  | `/spaces/${string}`
  | {
      pathname: '/(main)/room-workspace'
      params: { roomId: string }
    }

export type OfficialRoomLinkNavigationTarget =
  | AuthenticatedRoomNavigationTarget
  | {
      pathname: '/(main)/room-join'
      params: { roomId: string; invite: string }
    }

const AUTHENTICATED_ROOM_CHILD_ROUTES = new Set([
  'agent-add',
  'agents',
  'browser-sessions',
  'details',
  'invite',
  'manage',
  'members',
  'open-on-computer',
])

const OFFICIAL_ROOM_LINK_ORIGIN = 'https://app.shennian.net'
const OFFICIAL_ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/
const OFFICIAL_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/

function extractOfficialRoomLink(url: string): { roomId: string; inviteToken?: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (
    parsed.origin !== OFFICIAL_ROOM_LINK_ORIGIN ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    return null
  }

  const match = parsed.pathname.match(/^\/spaces\/([^/]+)$/)
  if (!match) return null

  let roomId: string
  try {
    roomId = decodeURIComponent(match[1])
  } catch {
    return null
  }
  if (!OFFICIAL_ROOM_ID_PATTERN.test(roomId)) return null

  const query = Array.from(parsed.searchParams.entries())
  if (query.length === 0) return { roomId }
  if (query.length !== 1 || query[0][0] !== 'invite') return null

  const inviteToken = query[0][1]
  if (!OFFICIAL_INVITE_TOKEN_PATTERN.test(inviteToken)) return null
  return { roomId, inviteToken }
}

export function getActiveRoomNavigationId(input: {
  pathname: string
  roomId?: string | string[]
}): string | null {
  const routeRoomId = Array.isArray(input.roomId) ? input.roomId[0] : input.roomId
  if (
    routeRoomId &&
    (input.pathname === '/room-workspace' || input.pathname.startsWith('/spaces/'))
  ) {
    return routeRoomId
  }

  const publicRoomMatch = input.pathname.match(/^\/spaces\/([^/]+)$/)
  if (!publicRoomMatch) return null
  if (AUTHENTICATED_ROOM_CHILD_ROUTES.has(publicRoomMatch[1])) return null
  try {
    return decodeURIComponent(publicRoomMatch[1])
  } catch {
    return publicRoomMatch[1]
  }
}

export function shouldCountRoomMessageAsUnread(
  activeRoomId: string | null,
  messageRoomId: string,
): boolean {
  return activeRoomId !== messageRoomId
}

/**
 * The Electron renderer uses react-native-web, so Platform.OS alone cannot
 * distinguish the public single-Room browser from the full Desktop control
 * surface. Desktop and native clients must remain in the authenticated main
 * workspace; only the browser Web surface uses the public Room route.
 */
export function getAuthenticatedRoomNavigationTarget(input: {
  roomId: string
  platform: 'web' | 'ios' | 'android' | string
  desktopControlSurface: boolean
}): AuthenticatedRoomNavigationTarget {
  if (input.desktopControlSurface || input.platform !== 'web') {
    return {
      pathname: '/(main)/room-workspace',
      params: { roomId: input.roomId },
    }
  }

  return `/spaces/${encodeURIComponent(input.roomId)}`
}

export function getOfficialRoomLinkNavigationTarget(input: {
  url: string
  platform: 'web' | 'ios' | 'android' | string
  desktopControlSurface: boolean
}): OfficialRoomLinkNavigationTarget | null {
  const room = extractOfficialRoomLink(input.url)
  if (!room) return null
  if (room.inviteToken) {
    return {
      pathname: '/(main)/room-join',
      params: { roomId: room.roomId, invite: room.inviteToken },
    }
  }
  return getAuthenticatedRoomNavigationTarget({
    roomId: room.roomId,
    platform: input.platform,
    desktopControlSurface: input.desktopControlSurface,
  })
}
