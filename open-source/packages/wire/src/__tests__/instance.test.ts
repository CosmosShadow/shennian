// @covers open-source/packages/wire/src/instance.ts
import { describe, expect, it } from 'vitest'
import { normalizeInstanceOrigin } from '../instance.js'

describe('instance origin', () => {
  it('accepts domains, IPs, ports and explicit loopback HTTP without paths', () => {
    expect(normalizeInstanceOrigin(' AI.Example.com:8443/ ')).toBe('https://ai.example.com:8443')
    expect(normalizeInstanceOrigin('192.168.1.8:443')).toBe('https://192.168.1.8')
    expect(normalizeInstanceOrigin('[2001:db8::1]:8443')).toBe('https://[2001:db8::1]:8443')
    expect(normalizeInstanceOrigin('http://127.0.0.1:3100')).toBe('http://127.0.0.1:3100')
  })
  it('rejects insecure remote origins and non-origin inputs', () => {
    for (const value of [
      '', 'http://192.168.1.8', 'http://example.com', 'http://127.evil.example', 'ftp://example.com',
      'https://user:secret@example.com', 'https://example.com/api',
      'https://example.com/?token=secret', 'https://example.com#', 'https://example.com?',
      'https://example.com/../', 'https://example.com/%2e%2e/', '//example.com',
      'https://example.com\\@evil.test', 'https://example.com bad',
    ]) expect(() => normalizeInstanceOrigin(value), value).toThrow()
  })
})
