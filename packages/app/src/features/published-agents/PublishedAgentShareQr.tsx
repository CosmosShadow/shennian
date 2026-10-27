// @arch docs/features/published-agent-direct-conversations.md

import { View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'

/** The QR payload is only the share URL; explanatory text stays outside it. */
export function PublishedAgentShareQr({ url, label }: { url: string; label: string }) {
  return <View accessible accessibilityLabel={label} style={{ alignSelf: 'flex-start', padding: 12,
    backgroundColor: '#FFFFFF', borderRadius: 8 }}>
    <QRCode value={url} size={168} quietZone={4} />
  </View>
}
