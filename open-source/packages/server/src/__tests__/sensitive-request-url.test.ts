// @covers open-source/packages/server/src/security/sensitive-request-url.ts

import { describe, expect, it } from 'vitest'
import {
  isRoomInviteExchangeUrl,
  redactSensitiveRequestUrl,
  serializeRequestForLog,
} from '../security/sensitive-request-url.js'
import { shouldSkipAccessLog } from '../middleware/trace.js'

describe('sensitive request URL redaction', () => {
  it('redacts the entire invite capability and query before Fastify or trace logging', () => {
    const raw = `/spaces/room_1?invite=${'secret-token-'.repeat(4)}&utm_source=private`
    expect(isRoomInviteExchangeUrl(raw)).toBe(true)
    expect(redactSensitiveRequestUrl(raw)).toBe('/spaces/room_1')
    expect(redactSensitiveRequestUrl(raw)).not.toContain('secret-token')
    expect(redactSensitiveRequestUrl(raw)).not.toContain('utm_source')
  })

  it('keeps raw capabilities out of Fastify request serializer output', () => {
    const raw = `/spaces/room_1?invite=${'private-capability-'.repeat(3)}`
    const serialized = serializeRequestForLog({
      method: 'GET', url: raw, socket: { remoteAddress: '127.0.0.1' },
    })
    expect(serialized.url).toBe('/spaces/room_1')
    expect(JSON.stringify(serialized)).not.toContain('private-capability')
  })

  it('redacts Room attachment bearer links from request logs', () => {
    const raw = `/a/${'private-attachment-capability'.repeat(3)}`
    expect(redactSensitiveRequestUrl(raw)).toBe('/a/[redacted]')
    expect(JSON.stringify(serializeRequestForLog({ method: 'GET', url: raw }))).not.toContain(
      'private-attachment-capability',
    )
  })

  it('redacts one-time Room browser handoffs from request logs', () => {
    const raw = `/spaces/room_1?access=${'private-handoff'.repeat(3)}`
    expect(redactSensitiveRequestUrl(raw)).toBe('/spaces/room_1')
    expect(JSON.stringify(serializeRequestForLog({ method: 'GET', url: raw }))).not.toContain(
      'private-handoff',
    )
  })

  it('redacts one-time machine invitation tokens embedded in preview paths', () => {
    const raw = `/machines/grants/${'private-machine-invite'.repeat(3)}/preview`
    expect(redactSensitiveRequestUrl(raw)).toBe('/machines/grants/[redacted]/preview')
    expect(JSON.stringify(serializeRequestForLog({ method: 'GET', url: raw }))).not.toContain(
      'private-machine-invite',
    )
  })

  it('keeps route paths but strips every query and fragment from logs', () => {
    expect(isRoomInviteExchangeUrl('/spaces/room_1')).toBe(false)
    expect(redactSensitiveRequestUrl('/spaces/room_1')).toBe('/spaces/room_1')
    expect(redactSensitiveRequestUrl('/api/rooms/room_1')).toBe('/api/rooms/room_1')
    expect(redactSensitiveRequestUrl('/relay/client?token=relay-secret&v=1')).toBe('/relay/client')
    expect(redactSensitiveRequestUrl('/sessions?updatedAfter=123&query=private')).toBe('/sessions')
    expect(redactSensitiveRequestUrl('/search#private-fragment')).toBe('/search')
  })

  it('keeps relay tokens out of Fastify request serializer output', () => {
    const serialized = serializeRequestForLog({
      method: 'GET',
      url: '/relay/machine?token=machine-secret&agents=codex',
      socket: { remoteAddress: '127.0.0.1' },
    })

    expect(serialized.url).toBe('/relay/machine')
    expect(JSON.stringify(serialized)).not.toContain('machine-secret')
  })

  it('keeps high-frequency transport endpoints out of the HTTP access log', () => {
    expect(shouldSkipAccessLog('/relay/machine?token=machine-secret')).toBe(true)
    expect(shouldSkipAccessLog('/relay/client?token=device-secret')).toBe(true)
    expect(shouldSkipAccessLog('/log')).toBe(true)
    expect(shouldSkipAccessLog('/log/batch')).toBe(true)
    expect(shouldSkipAccessLog('/channels/wechat/runtime')).toBe(true)
    expect(shouldSkipAccessLog('/api/channels/wechat/runtime')).toBe(true)
    expect(shouldSkipAccessLog('/rooms')).toBe(false)
  })
})
