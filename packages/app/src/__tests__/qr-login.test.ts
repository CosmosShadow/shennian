// @arch docs/architecture/app/modular-features.md#登录-feature
// @covers packages/app/src/features/auth/qrLogin.ts
// @covers packages/app/src/features/auth/hooks/useQrLogin.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createQrLoginDataUrl, qrLoginDeepLink, qrLoginFailureCode } from '../features/auth/qrLogin'

describe('QR login rendering', () => {
  it('only exposes allowlisted failure codes, never server messages or arbitrary credential-shaped codes', () => {
    expect(qrLoginFailureCode({ code: 'CREDENTIAL_COMMIT_FAILED', message: 'private response' })).toBe('CREDENTIAL_COMMIT_FAILED')
    expect(qrLoginFailureCode({ code: 'private-token', message: 'private response' })).toBe('QR_LOGIN_FAILED')
    expect(qrLoginFailureCode(new Error('private response'))).toBe('QR_LOGIN_FAILED')
  })
  it('keeps the mobile scanner payload compatible', () => {
    expect(qrLoginDeepLink('ticket-123')).toBe('qr:ticket-123')
  })

  it('generates a local data URL instead of depending on a third-party image host', async () => {
    const url = await createQrLoginDataUrl('ticket-123')

    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(url).not.toContain('api.qrserver.com')
  })

  it('uses only the locally generated QR data URL without a server image fallback', () => {
    const source = readFileSync(resolve(__dirname, '../features/auth/hooks/useQrLogin.ts'), 'utf-8')

    expect(source).toContain('await createQrLoginDataUrl(data.qrId)')
    expect(source).not.toContain('setQrUrl(data.qrUrl)')
  })
})
