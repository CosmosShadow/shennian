// @arch docs/product/user-guide.md
// The public site owns the current privacy policy; the app host is only a legacy entry.

import { useEffect } from 'react'
import Head from 'expo-router/head'
import { Text, View } from 'react-native'

const PRIVACY_URL = 'https://shennian.net/privacy'

export default function PublicPrivacyRedirect() {
  useEffect(() => { window.location.replace(PRIVACY_URL) }, [])
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <Head><title>隐私政策 · Shennian</title></Head>
    <Text>隐私政策已移至官网 / The privacy policy is on the official site. <a href={PRIVACY_URL}>神念隐私政策 / Privacy policy</a></Text>
  </View>
}
