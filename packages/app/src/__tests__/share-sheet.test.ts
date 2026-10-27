// @covers packages/app/src/components/sheets/shareInvite.ts
// @covers packages/app/src/components/sheets/shareInviteQr.ts

import { describe, expect, it } from 'vitest'
import { buildShareInvitePayload } from '../components/sheets/shareInvite'
import { createShareInviteQrMatrix } from '../components/sheets/shareInviteQr'

describe('machine invite QR', () => {
  it('builds the scan payload expected by invite redemption', () => {
    expect(buildShareInvitePayload('invite-token')).toBe('share:invite-token')
  })

  it('creates a deterministic QR matrix from the invite payload', () => {
    const matrix = createShareInviteQrMatrix(buildShareInvitePayload('invite-token'))

    expect(matrix.size).toBeGreaterThan(20)
    expect(matrix.data).toHaveLength(matrix.size * matrix.size)
    expect(matrix.data.some(Boolean)).toBe(true)
  })
})
