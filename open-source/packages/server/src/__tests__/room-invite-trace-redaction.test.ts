// @covers open-source/packages/server/src/middleware/trace.ts

import { describe, expect, it } from 'vitest'
import { tracePathForRequest } from '../middleware/trace.js'

describe('Room invite trace redaction', () => {
  it('passes only a redacted invite path to the persistent HTTP trace log', () => {
    const rawToken = 'unit_invite_00000000000000000000000000000000'
    const path = tracePathForRequest(`/spaces/room_1?invite=${rawToken}&campaign=private`)
    expect(path).toBe('/spaces/room_1')
    expect(path).not.toContain(rawToken)
    expect(path).not.toContain('campaign')
  })
})
