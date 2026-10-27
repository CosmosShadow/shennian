// @arch docs/architecture/app/modular-features.md
// @test packages/app/src/__tests__/profile-docs-link.test.ts

import { Linking } from 'react-native'
import { getDocsUrl } from '../../config/server'

export function getProfileDocsUrl(): string {
  return getDocsUrl()
}

export async function openProfileDocs(openUrl = Linking.openURL): Promise<boolean> {
  try {
    await openUrl(getProfileDocsUrl())
    return true
  } catch {
    return false
  }
}
