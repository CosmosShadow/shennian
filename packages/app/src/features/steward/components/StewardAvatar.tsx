// @arch docs/tasks/20260929-1455_神念管家本机入口.md
import { Image, StyleSheet } from 'react-native'
import { avatarBorderRadius } from '../../../components/avatarShape'

/** The steward's own app icon, used instead of an initial-letter placeholder. */
export function StewardAvatar({ size = 32 }: { size?: number }) {
  return (
    <Image
      source={require('../../../../assets/shennian-avatar.png')}
      style={[styles.image, { width: size, height: size, borderRadius: avatarBorderRadius(size) }]}
    />
  )
}

const styles = StyleSheet.create({
  image: { resizeMode: 'cover' },
})
