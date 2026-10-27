// @covers src/services/personal-account-namespace.ts

import { describe, expect, it } from 'vitest'
import { personalAccountNamespaceId } from '../services/personal-account-namespace.js'

describe('personal account namespace', () => {
  it('is stable for one account and unlinkable to another account', () => {
    const first = personalAccountNamespaceId('account-1')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(personalAccountNamespaceId('account-1')).toBe(first)
    expect(personalAccountNamespaceId('account-2')).not.toBe(first)
    expect(first).not.toContain('account-1')
  })

  it('rejects missing account identities', () => {
    expect(() => personalAccountNamespaceId('')).toThrow('invalid account identity')
  })
})
