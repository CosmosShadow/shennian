// @arch docs/product/user-guide.md
// The public site owns the current documentation; the app host is only a legacy entry.

import { useEffect } from 'react'
import Head from 'expo-router/head'
import { Text, View } from 'react-native'

const DOCS_URL = 'https://shennian.net/docs'

export default function PublicDocsRedirect() {
  useEffect(() => { window.location.replace(DOCS_URL) }, [])
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <Head><title>神念文档 · Shennian</title></Head>
    <Text>文档已移至官网 / Docs are on the official site. <a href={DOCS_URL}>神念文档 / Docs</a></Text>
  </View>
}
