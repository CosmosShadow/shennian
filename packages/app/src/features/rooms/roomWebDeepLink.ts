// @arch docs/features/network-rooms/ui.md#七room-workspace
// @test src/__tests__/room-invite-web.test.ts

const ROOM_PATH = /^\/spaces\/([A-Za-z0-9_-]{1,128})\/?$/

export function roomIdFromWebPathname(pathname: string): string | null {
  return ROOM_PATH.exec(pathname)?.[1] ?? null
}

export function roomAuthRedirectPathname(routerPathname: string, browserPathname?: string): string {
  return browserPathname && roomIdFromWebPathname(browserPathname)
    ? browserPathname
    : routerPathname
}
