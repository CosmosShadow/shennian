// @covers open-source/packages/cli/src/room/device-authorization-client.ts

import { describe, expect, it, vi } from 'vitest'
import { HttpDeviceAuthorizationClient } from '../room/device-authorization-client.js'

describe('HTTP device authorization client', () => {
  it('keeps the device secret in a request header and out of the URL', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      status: 'approved',
      actionPayloadHash: 'a'.repeat(64),
    }), { status: 200 }))
    const client = new HttpDeviceAuthorizationClient('https://shennian.net/', fetchImpl as typeof fetch)
    await client.getStatus({ loginIntentId: 'intent_123', deviceSecret: 'private-device-secret' })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://shennian.net/auth/device-authorizations/intent_123/status')
    expect(url).not.toContain('private-device-secret')
    expect(init?.headers).toEqual({ 'x-shennian-device-secret': 'private-device-secret' })
    expect(init?.body).toBeUndefined()
  })

  it('does not include a server response body in a safe error', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      error: 'invalid_device_authorization',
      message: 'secret-value-that-must-not-be-forwarded',
    }), { status: 401 }))
    const client = new HttpDeviceAuthorizationClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(client.claim({ loginIntentId: 'intent_123', deviceSecret: 'private' })).rejects.toMatchObject({
      code: 'invalid_device_authorization',
      message: 'Shennian device authorization request failed.',
    })
  })
})
