// @arch docs/engineering/build-and-release.md
// @covers packages/app/src/features/profile/version.ts

import { describe, expect, it } from 'vitest'
import { formatAppVersionLabel, formatRuntimeVersionDetails } from '../features/profile/version'

describe('profile version label', () => {
  it('shows one public delivery version on native', () => {
    expect(
      formatAppVersionLabel({
        platform: 'native',
        shellVersion: '0.2.0',
        deliveryVersion: '0.2.13',
        otaSuffix: '13',
      }),
    ).toBe('v0.2.13')
  })

  it('prefers an independently versioned OTA over the shared delivery version', () => {
    expect(
      formatAppVersionLabel({
        platform: 'native',
        shellVersion: '0.5.0',
        deliveryVersion: '0.5.9',
        otaVersion: '0.5.12',
      }),
    ).toBe('v0.5.12')
  })

  it('keeps the native shell version when there is no OTA suffix', () => {
    expect(
      formatAppVersionLabel({ platform: 'native', shellVersion: '0.2.0', otaSuffix: '' }),
    ).toBe('v0.2.0')
  })

  it('uses the delivery version directly on web', () => {
    expect(
      formatAppVersionLabel({
        platform: 'web',
        shellVersion: '0.2.0',
        deliveryVersion: '0.2.28',
        otaSuffix: '28',
      }),
    ).toBe('v0.2.28')
  })

  it('uses the delivery version as the primary Electron frontend version', () => {
    expect(
      formatAppVersionLabel({
        platform: 'desktop',
        shellVersion: '0.2.0',
        deliveryVersion: '0.2.55',
        desktopVersion: '0.2.38',
      }),
    ).toBe('v0.2.55')
  })

  it('shows desktop shell and frontend versions separately for diagnostics', () => {
    expect(
      formatRuntimeVersionDetails({
        platform: 'desktop',
        shellVersion: '0.2.30',
        deliveryVersion: '0.2.55',
        desktopVersion: '0.2.38',
      }),
    ).toEqual(['前端：v0.2.55', '桌面壳：v0.2.38'])
  })

  it('falls back to suffix notation for non-semver values', () => {
    expect(
      formatAppVersionLabel({ platform: 'native', shellVersion: 'preview', otaSuffix: '9' }),
    ).toBe('vpreview / OTA vpreview-9')
  })

  it('keeps the legacy helper behavior for existing callers', () => {
    expect(formatAppVersionLabel('0.2.0', '13')).toBe('v0.2.0 / OTA v0.2.13')
  })
})
