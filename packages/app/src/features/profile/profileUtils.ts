import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'

export type { DeviceInfo } from '../../config/profileDevices'
import type { DeviceInfo } from '../../config/profileDevices'

export function displayDeviceName(device: DeviceInfo, t: (key: string) => string): string {
  const platform = device.platform.toLowerCase()
  const storedName = device.name.trim()
  const normalizedName = storedName.toLowerCase()

  if (platform === 'ios' || normalizedName === 'ios app') return t('device_name_ios')
  if (platform === 'android' || normalizedName === 'android app') return t('device_name_android')
  if (platform === 'web' || normalizedName.endsWith('browser')) {
    return normalizedName.includes('mobile')
      ? t('device_name_mobile_browser')
      : t('device_name_desktop_browser')
  }
  if (platform === 'macos' || platform === 'darwin' || normalizedName === 'mac desktop') {
    return t('device_name_mac_desktop')
  }
  if (platform === 'windows' || platform === 'win32' || normalizedName === 'windows desktop') {
    return t('device_name_windows_desktop')
  }
  if (platform === 'desktop' || normalizedName === 'shennian desktop') return t('device_name_desktop_app')
  return storedName || device.platform
}

export function platformIconName(platform: string): React.ComponentProps<typeof Ionicons>['name'] {
  switch (platform) {
    case 'ios':
    case 'android':
      return 'phone-portrait-outline'
    case 'macos':
    case 'darwin':
    case 'windows':
    case 'win32':
    case 'desktop':
      return 'laptop-outline'
    default:
      return 'globe-outline'
  }
}

export function useRelativeTime() {
  const { t } = useTranslation()
  return useCallback(
    (dateStr: string) => {
      const diff = Date.now() - new Date(dateStr).getTime()
      const minutes = Math.floor(diff / 60_000)
      if (minutes < 1) return t('time_just_now')
      if (minutes < 60) return t('time_minutes_ago', { count: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('time_hours_ago', { count: hours })
      return t('time_days_ago', { count: Math.floor(hours / 24) })
    },
    [t],
  )
}

export function maskPhone(phone?: string | null): string {
  if (!phone) return '--'
  const cleaned = phone.replace(/\s/g, '')
  if (cleaned.startsWith('+86') && cleaned.length >= 14) {
    return `+86 ${cleaned.slice(3, 6)}****${cleaned.slice(10)}`
  }
  if (cleaned.length >= 8) {
    return (
      cleaned.slice(0, cleaned.length - 8) +
      cleaned.slice(cleaned.length - 8, cleaned.length - 4).replace(/./g, '*') +
      cleaned.slice(-4)
    )
  }
  return cleaned
}

function maskEmail(email: string): string {
  const [u, d] = email.split('@')
  if (!d || u.length < 2) return email
  return `${u.slice(0, 2)}***@${d}`
}

function isAppleRelay(email?: string | null): boolean {
  return !!email && email.endsWith('@privaterelay.appleid.com')
}

type AccountDisplay = {
  label: string
  icon: React.ComponentProps<typeof Ionicons>['name']
}

export function displayAccount(
  user: {
    name?: string
    phone?: string | null
    email?: string | null
  } | null,
  t: (key: string) => string,
): AccountDisplay {
  if (!user) return { label: '--', icon: 'person-outline' }
  if (user.phone) {
    return { label: user.name || maskPhone(user.phone), icon: 'phone-portrait-outline' }
  }
  if (isAppleRelay(user.email)) {
    return { label: user.name || t('account_apple'), icon: 'logo-apple' }
  }
  if (user.email) {
    return { label: user.name || maskEmail(user.email), icon: 'logo-google' }
  }
  return { label: user.name || '--', icon: 'person-outline' }
}
