// @arch docs/features/mobile-app-update-experience.md#更新目的地

import { getServerUrl, PUBLIC_SITE_URL } from '../config/server'
import { getAppProductLinks } from '../config/product-links'

export type MobileAppPlatform = 'ios' | 'android'

export function getMobileAppDownloadUrl(platform: MobileAppPlatform): string {
  const contact = getAppProductLinks()
  return platform === 'ios'
    ? contact.iosAppId
      ? `https://apps.apple.com/app/id${contact.iosAppId}`
      : `${PUBLIC_SITE_URL}/#download`
    : `${getServerUrl().replace(/\/+$/, '')}/download/android`
}
