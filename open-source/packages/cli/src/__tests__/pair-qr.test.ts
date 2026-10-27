// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/commands/pair-qr.ts

import { describe, expect, it } from 'vitest'
import { buildPairQrPayload, PAIR_QR_RENDER_OPTIONS } from '../commands/pair-qr'

describe('pair qr helpers', () => {
  it('encodes the pair token with the pair scheme', () => {
    expect(buildPairQrPayload('sn-abcd-efgh-ijkl')).toBe('pair:sn-abcd-efgh-ijkl')
  })

  it('renders the pairing qr in standard size for better scan reliability', () => {
    expect(PAIR_QR_RENDER_OPTIONS).toEqual({ small: false })
  })
})
