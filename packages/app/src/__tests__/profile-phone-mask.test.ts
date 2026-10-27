// @arch docs/features/free-growth-phase.md
// @covers packages/app/src/features/profile/profileUtils.ts

import { describe, expect, it } from 'vitest'
import { displayDeviceName, maskPhone, platformIconName, type DeviceInfo } from '../features/profile/profileUtils'

describe('profile phone masking', () => {
  it('masks a mainland mobile number while preserving its country code', () => {
    expect(maskPhone('+8619900000001')).toBe('+86 199****0001')
  })

  it('masks a mainland mobile number without a country code', () => {
    expect(maskPhone('19900000001')).toBe('199****0001')
  })

  it('keeps short non-sensitive identifiers readable', () => {
    expect(maskPhone('1234567')).toBe('1234567')
  })
})

describe('profile device names', () => {
  const device = (platform: string, name: string): DeviceInfo => ({
    id: 'device-1',
    platform,
    name,
    lastActiveAt: '2026-08-27T00:00:00.000Z',
    createdAt: '2026-08-27T00:00:00.000Z',
    current: false,
  })

  it('localizes legacy generated device names instead of exposing stored English labels', () => {
    const zh: Record<string, string> = {
      device_name_ios: 'iOS 客户端',
      device_name_desktop_browser: '桌面浏览器',
    }
    const t = (key: string) => zh[key] ?? key

    expect(displayDeviceName(device('ios', 'ios App'), t)).toBe('iOS 客户端')
    expect(displayDeviceName(device('web', 'Desktop Browser'), t)).toBe('桌面浏览器')
  })

  it('uses the canonical iOS capitalization in English', () => {
    const en: Record<string, string> = { device_name_ios: 'iOS App' }
    expect(displayDeviceName(device('ios', 'ios App'), (key) => en[key] ?? key)).toBe('iOS App')
  })

  it('labels Mac and Windows desktop sessions distinctly in both languages', () => {
    const zh: Record<string, string> = {
      device_name_mac_desktop: 'Mac 桌面端',
      device_name_windows_desktop: 'Windows 桌面端',
    }
    const en: Record<string, string> = {
      device_name_mac_desktop: 'Mac Desktop',
      device_name_windows_desktop: 'Windows Desktop',
    }

    expect(displayDeviceName(device('desktop', 'Mac Desktop'), (key) => zh[key] ?? key)).toBe('Mac 桌面端')
    expect(displayDeviceName(device('desktop', 'Windows Desktop'), (key) => zh[key] ?? key)).toBe('Windows 桌面端')
    expect(displayDeviceName(device('macos', 'Legacy'), (key) => en[key] ?? key)).toBe('Mac Desktop')
    expect(displayDeviceName(device('windows', 'Legacy'), (key) => en[key] ?? key)).toBe('Windows Desktop')
    expect(platformIconName('desktop')).toBe('laptop-outline')
  })
})
