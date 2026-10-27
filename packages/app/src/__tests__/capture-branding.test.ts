// @covers packages/app/src/components/chat/captureBranding.ts

import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CAPTURE_BRAND_LOGO_DATA_URL,
  createCaptureBrandQrSvg,
  getCaptureBrandHref,
  normalizeCaptureBrandUrl,
} from '../components/chat/captureBranding'

describe('capture screenshot branding', () => {
  it('uses the packaged Shennian logo as a data URL', () => {
    expect(CAPTURE_BRAND_LOGO_DATA_URL).toMatch(/^data:image\/png;base64,/)
    expect(Buffer.from(CAPTURE_BRAND_LOGO_DATA_URL.split(',')[1], 'base64')).toEqual(
      readFileSync(fileURLToPath(new URL('../../public/logo-192.png', import.meta.url))),
    )
  })

  it('normalizes the public host into a scan target', () => {
    expect(normalizeCaptureBrandUrl('https://shennian.net/docs')).toBe('shennian.net')
    expect(getCaptureBrandHref('shennian.net')).toBe('https://shennian.net')
  })

  it('generates a real SVG QR code for the current domain', () => {
    const svg = createCaptureBrandQrSvg('https://shennian.net')

    expect(svg).toContain('capture-brand-qr')
    expect(svg).toContain('viewBox="0 0')
    expect(svg.match(/<rect /g)?.length ?? 0).toBeGreaterThan(100)
  })
})
