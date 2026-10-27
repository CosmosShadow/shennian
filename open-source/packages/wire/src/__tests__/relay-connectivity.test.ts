// @arch open-source/docs/wire.md
// @covers open-source/packages/wire/src/relay-connectivity.ts

import { describe, expect, it } from 'vitest'
import { classifyRelayClose } from '../relay-connectivity.js'

describe('relay close classification', () => {
  it.each([
    [4001, 'auth_required', false],
    [4009, 'auth_required', false],
    [4003, 'permission_revoked', false],
    [4403, 'permission_revoked', false],
    [4411, 'permission_revoked', false],
    [4402, 'plan_required', false],
    [4406, 'version_unsupported', false],
    [4004, 'machine_unavailable', true],
    [4008, 'server_unavailable', true],
    [1013, 'server_unavailable', true],
    [1006, 'transient_transport', true],
  ])('maps %i to %s (retryable=%s)', (code, reason, retryable) => {
    expect(classifyRelayClose(code)).toEqual({ reason, retryable })
  })

  it('uses the structured reason as a compatibility fallback', () => {
    expect(classifyRelayClose(1000, 'upgrade_required:protocol_mismatch')).toEqual({
      reason: 'version_unsupported',
      retryable: false,
    })
  })
})
