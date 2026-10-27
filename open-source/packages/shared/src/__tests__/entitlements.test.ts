// @covers open-source/packages/shared/src/lib/entitlements.ts

import { describe, expect, it } from 'vitest'
import { buildEntitlements, hasCapability, normalizeAccountTier } from '../lib/entitlements'

describe('entitlements', () => {
  it('opens Manager while keeping retired collaboration and connector capabilities off', () => {
    expect(normalizeAccountTier(undefined)).toBe('personal')
    expect(normalizeAccountTier('personal')).toBe('personal')
    expect(normalizeAccountTier('pro')).toBe('pro')
    expect(normalizeAccountTier('enterprise')).toBe('enterprise')
    expect(buildEntitlements('personal').capabilities.manager_agent).toBe(true)
    expect(buildEntitlements('pro').capabilities.manager_agent).toBe(true)
    expect(buildEntitlements('pro').capabilities.machine_sharing).toBe(false)
    expect(buildEntitlements('enterprise').capabilities.manager_agent).toBe(true)
    expect(buildEntitlements('enterprise').capabilities.managed_wecom).toBe(false)
    expect(buildEntitlements('enterprise').capabilities.external_channels).toBe(false)
  })

  it('prefers explicit server entitlements when present', () => {
    expect(hasCapability({ accountTier: 'enterprise', entitlements: { tier: 'enterprise', capabilities: { manager_agent: true, external_channels: true, machine_sharing: true, managed_wecom: false } } }, 'managed_wecom')).toBe(false)
  })
})
