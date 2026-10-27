// @covers packages/app/src/features/landing/landingDownloads.ts

import { readI18nSource } from './i18n-source-test-helper'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pickDesktopDownloadUrl } from '../features/landing/landingDownloads'

describe('landing Desktop downloads', () => {
  it('publishes Desktop downloads for macOS and Windows only', () => {
    const landing = readFileSync(resolve(__dirname, '../features/landing/landingParts.tsx'), 'utf8')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')

    expect(landing).toContain("type OsKey = 'mac' | 'win'")
    expect(landing).not.toContain("key: 'linux'")
    expect(zh).not.toContain('gs_linux_')
    expect(zh).not.toContain('gs_card_linux_')
    expect(en).not.toContain('gs_linux_')
    expect(en).not.toContain('gs_card_linux_')
  })

  const release = {
    version: '0.4.0',
    platforms: {
      mac: {
        files: [
          {
            name: 'latest-mac.yml',
            url: 'https://example.test/latest-mac.yml',
            updateMetadata: true,
          },
          { name: 'Shennian-0.4.0-arm64-mac.zip', url: 'https://example.test/app.zip' },
          { name: 'Shennian-0.4.0-arm64.dmg', url: 'https://example.test/app.dmg' },
        ],
      },
      win: {
        files: [
          { name: 'Shennian-0.4.0.exe.blockmap', url: 'https://example.test/app.exe.blockmap' },
          { name: 'Shennian-Setup-0.4.0.exe', url: 'https://example.test/app.exe' },
        ],
      },
    },
  }

  it('selects only the macOS DMG and Windows installer', () => {
    expect(pickDesktopDownloadUrl(release, 'mac')).toBe('https://example.test/app.dmg')
    expect(pickDesktopDownloadUrl(release, 'win')).toBe('https://example.test/app.exe')
  })

  it('does not return updater metadata as an installer', () => {
    expect(
      pickDesktopDownloadUrl(
        {
          version: '0.4.0',
          platforms: { mac: { files: release.platforms.mac.files.slice(0, 1) } },
        },
        'mac',
      ),
    ).toBeUndefined()
  })
})
