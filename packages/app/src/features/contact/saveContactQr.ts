// @arch docs/features/contact-and-reviews.md

import { Platform } from 'react-native'
import { Asset } from 'expo-asset'

export const CONTACT_QR_IMAGE = require('../../../public/landing/wechat-group-qr.jpg')

export async function saveContactQr(): Promise<'saved' | 'download' | 'permission-denied'> {
  const asset = Asset.fromModule(CONTACT_QR_IMAGE)
  if (Platform.OS === 'web') {
    const link = document.createElement('a')
    link.href = asset.uri
    link.download = 'shennian-wechat-qr.jpg'
    document.body.appendChild(link)
    link.click()
    link.remove()
    return 'download'
  }
  const MediaLibrary = await import('expo-media-library')
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo'])
  if (!permission.granted) return 'permission-denied'
  await asset.downloadAsync()
  if (!asset.localUri) throw new Error('QR image unavailable')
  await MediaLibrary.saveToLibraryAsync(asset.localUri)
  return 'saved'
}
