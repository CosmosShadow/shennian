// @covers open-source/packages/cli/src/log-redaction.ts

import { describe, expect, it } from 'vitest'
import { collectKnownLogSecrets, redactCliLogText, sanitizeCliLogValue } from '../log-redaction.js'

describe('CLI log redaction', () => {
  it('removes contextual and exact known credentials from daemon log text', () => {
    const machineToken = 'machine-canary-123456789'
    const customSecret = 'test-key-0000'
    const text = [
      `machineToken="${machineToken}"`,
      `Bearer ${machineToken}`,
      `Authorization: Basic ${machineToken}`,
      `Cookie: session=${customSecret}`,
      `password=${customSecret}`,
      'code=730194',
      'inviteCode=invite-code-canary-123456789',
      'csrfToken=csrf-canary-123456789',
      'deviceSecretHash=device-hash-canary-123456789',
      'tokenPreview=token-prefix-canary-123456789',
      `opaque=${customSecret}`,
      'daemonIpcSecret=daemon-ipc-canary-123456789',
      `auth=${customSecret}`,
      'apiKey="test-key-0000"',
    ].join(' ')
    const safe = redactCliLogText(text, [machineToken, customSecret])
    expect(safe).not.toContain(machineToken)
    expect(safe).not.toContain(customSecret)
    expect(safe).not.toContain('730194')
    expect(safe).not.toContain('invite-code-canary-123456789')
    expect(safe).not.toContain('csrf-canary-123456789')
    expect(safe).not.toContain('device-hash-canary-123456789')
    expect(safe).not.toContain('token-prefix-canary-123456789')
    expect(safe).not.toContain('test-key-0000')
    expect(safe).not.toContain('daemon-ipc-canary-123456789')
  })

  it('collects secrets from credential-named environment and config fields only', () => {
    const values = collectKnownLogSecrets(
      {
        SHENNIAN_TOKEN: 'environment-canary',
        ORDINARY_VALUE: 'keep-visible',
      },
      {
        machineToken: 'machine-canary',
        nested: { apiKey: 'api-canary', name: 'visible-name' },
      },
    )
    expect(values).toEqual(
      expect.arrayContaining(['environment-canary', 'machine-canary', 'api-canary']),
    )
    expect(values).not.toContain('keep-visible')
    expect(values).not.toContain('visible-name')
  })

  it('redacts plural credential maps instead of exposing token prefixes', () => {
    const safe = sanitizeCliLogValue({
      machineToken: 'machine-canary-123456789',
      tokenPreview: 'machine-canary-prefix',
      apiKeys: { openai: 'test-key-0000' },
      serverUrl: 'https://shennian.net',
    })
    expect(safe).toEqual({
      machineToken: '[redacted]',
      tokenPreview: '[redacted]',
      apiKeys: '[redacted]',
      serverUrl: 'https://shennian.net',
    })
  })

  it('fails closed on circular and over-deep diagnostic payloads', () => {
    const circular: Record<string, unknown> = { accessToken: 'access-canary-123456789' }
    circular.self = circular
    const safe = sanitizeCliLogValue(circular)
    expect(safe).toEqual({ accessToken: '[redacted]', self: '[circular]' })
  })
})
