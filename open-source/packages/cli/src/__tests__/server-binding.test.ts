// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/config/server-binding.ts
import { describe, expect, it } from 'vitest'
import { assertSingleServerBinding } from '../config/server-binding.js'
describe('single server credential binding', () => {
  it('allows a fresh Client to select an HTTPS IP', () => {
    expect(assertSingleServerBinding('192.0.2.11:8443', {})).toBe('https://192.0.2.11:8443')
  })
  it('refuses credential-bearing overrides to another origin, including ports', () => {
    const config = { machineToken: 'unit-token', serverUrl: 'https://company.test' }
    expect(assertSingleServerBinding('company.test/', config)).toBe('https://company.test')
    expect(() => assertSingleServerBinding('company.test:8443', config)).toThrow('already bound')
    expect(() => assertSingleServerBinding('shennian.net', config)).toThrow('already bound')
    expect(() => assertSingleServerBinding('http://192.0.2.11', {})).toThrow('instance_requires_https')
  })
})
