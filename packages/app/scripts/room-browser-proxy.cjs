/* global URL, module */
// @arch docs/features/network-rooms/scoped-browser-access.md
// @test ../src/__tests__/room-browser-proxy.test.ts

// Preserve production Origin checks while using Metro's first-party proxy for
// HttpOnly room cookies. Never rewrite cross-origin browser requests to localhost.
function createRoomBrowserOriginRewriter(target) {
  const upstreamOrigin = new URL(target).origin
  return (proxyReq, request) => {
    if (!/^\/api\/(?:room-browser|room-invites)(?:\/|$)/.test(request.url ?? '')) return
    const origin = request.headers.origin
    if (!origin) return
    try {
      const source = new URL(origin)
      const scheme = request.socket?.encrypted ? 'https:' : 'http:'
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname) ||
        source.host !== request.headers.host ||
        source.protocol !== scheme
      )
        return
      proxyReq.setHeader('origin', upstreamOrigin)
    } catch {
      /* The server rejects malformed origins. */
    }
  }
}
module.exports = { createRoomBrowserOriginRewriter }
