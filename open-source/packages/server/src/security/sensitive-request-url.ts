// @arch open-source/docs/server-runtime.md
// @test src/__tests__/sensitive-request-url.test.ts

const ROOM_CAPABILITY_EXCHANGE = /^\/spaces\/([^/?#]+)\?([^#]+)$/
const ROOM_ATTACHMENT_LINK = /^\/a\/([^/?#]+)(?:[?#].*)?$/
const MACHINE_INVITE_LINK = /^(?:\/api)?\/machines\/grants\/([^/?#]+)\/preview(?:[?#].*)?$/

export function isRoomInviteExchangeUrl(value: string): boolean {
  const match = ROOM_CAPABILITY_EXCHANGE.exec(value)
  if (!match) return false
  return new URLSearchParams(match[2]).has('invite')
}

export function redactSensitiveRequestUrl(value: string): string {
  if (/^\/(?:api\/)?local-apps\/(?:runtime|shared)\//.test(value)) return '/local-apps/runtime/[redacted]'
  const roomCapability = ROOM_CAPABILITY_EXCHANGE.exec(value)
  if (roomCapability) {
    const params = new URLSearchParams(roomCapability[2])
    if (params.has('invite') || params.has('access')) {
      return `/spaces/${roomCapability[1]}`
    }
  }
  if (ROOM_ATTACHMENT_LINK.test(value)) return '/a/[redacted]'
  if (MACHINE_INVITE_LINK.test(value)) return value.startsWith('/api/')
    ? '/api/machines/grants/[redacted]/preview'
    : '/machines/grants/[redacted]/preview'

  // Query strings regularly carry relay JWTs, continuation tokens and user
  // searches. The route path is sufficient for operations and must be the only
  // part persisted by Fastify or the HTTP trace logger.
  return value.split(/[?#]/, 1)[0] || '/'
}

export function serializeRequestForLog(request: {
  method?: string
  url?: string
  socket?: { remoteAddress?: string }
}) {
  return {
    method: request.method,
    url: redactSensitiveRequestUrl(request.url || ''),
    remoteAddress: request.socket?.remoteAddress,
  }
}
