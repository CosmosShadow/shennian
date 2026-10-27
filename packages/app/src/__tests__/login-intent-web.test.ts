// @covers packages/app/app/authorize/[intentId].tsx
// @covers packages/app/src/features/auth/utils/redirect.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sanitizeAuthRedirect } from '../features/auth/utils/redirect'

describe('browser device authorization', () => {
  it('lets login return only to a structurally valid authorization page', () => {
    expect(sanitizeAuthRedirect('/authorize/intent_12345678')).toBe('/authorize/intent_12345678')
    expect(sanitizeAuthRedirect('/authorize/../../profile')).toBe('/(main)')
    expect(sanitizeAuthRedirect('//evil.example/authorize/intent_12345678')).toBe('/(main)')
    expect(sanitizeAuthRedirect('https://evil.example')).toBe('/(main)')
  })

  it('presents device pairing as CLI sign-in without exposing credentials or audit internals', () => {
    const source = readFileSync(resolve(__dirname, '../../app/authorize/[intentId].tsx'), 'utf8')
    expect(source).toContain('/public`')
    expect(source).toContain('/verify-phone`')
    expect(source).toContain("credentials: 'omit'")
    expect(source).toContain('verifyIdentity')
    expect(source).not.toContain('authApi')
    expect(source).not.toContain('useAuthStore')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('/(auth)/login')
    expect(source).toContain('<meta name="referrer" content="no-referrer" />')
    expect(source).not.toContain("t('device_auth_agents')")
    expect(source).not.toContain("t('device_auth_requested_at')")
    expect(source).not.toContain("t('device_auth_action')")
    expect(source).not.toContain('/deny`,')
    expect(source).not.toContain('deviceSecret')
    expect(source).not.toContain('machineToken')
    expect(source).toContain('PhoneLoginPanel')
    expect(source).not.toContain('intent.machineName')
    expect(source).not.toContain('intent.machineOs')
    expect(source).toContain('accessibilityRole="tab"')
  })
})
