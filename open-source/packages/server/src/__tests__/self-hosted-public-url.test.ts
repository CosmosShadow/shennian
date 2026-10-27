// @covers open-source/packages/server/src/services/public-web-url.ts
import { afterEach, expect, it, vi } from 'vitest'
import { publicWebAppBaseUrl, roomInviteUrl, machineInviteUrl } from '../services/public-web-url.js'
const request = { protocol: 'https', hostname: 'untrusted-forwarded-host.example' }
afterEach(() => vi.unstubAllEnvs())
it('keeps self-hosted invitations on the configured instance rather than the official web app or request host', () => {
  vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'self-hosted')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('WEB_APP_PUBLIC_BASE_URL', '')
  vi.stubEnv('SHENNIAN_PUBLIC_URL', 'https://192.168.20.30')
  expect(new URL(roomInviteUrl(request, 'room-qa', 'test-invite')).origin).toBe('https://192.168.20.30')
  expect(new URL(machineInviteUrl(request, 'test-invite')).origin).toBe('https://192.168.20.30')
})
it('fails closed when self-hosted public origin is missing or invalid', () => {
  vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'self-hosted')
  vi.stubEnv('WEB_APP_PUBLIC_BASE_URL', '')
  vi.stubEnv('SHENNIAN_PUBLIC_URL', '')
  expect(() => publicWebAppBaseUrl(request)).toThrow('self_hosted_public_url_required')
  vi.stubEnv('SHENNIAN_PUBLIC_URL', 'https://user:pass@example.com')
  expect(() => publicWebAppBaseUrl(request)).toThrow()
})
it('preserves the official production default and explicit separate self-hosted Web deployment', () => {
  vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'official')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('WEB_APP_PUBLIC_BASE_URL', '')
  expect(publicWebAppBaseUrl(request)).toBe('https://app.shennian.net')
  vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'self-hosted')
  vi.stubEnv('WEB_APP_PUBLIC_BASE_URL', 'https://web.company.example/')
  expect(publicWebAppBaseUrl(request)).toBe('https://web.company.example')
})
