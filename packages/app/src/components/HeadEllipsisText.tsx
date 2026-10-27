// @arch docs/architecture/app/chat-composer-keyboard.md
// @test src/__tests__/head-ellipsis-text.test.ts

import { Platform, Text, type StyleProp, type TextStyle } from 'react-native'
import { resolveHeadEllipsisText } from './headEllipsis'

/** Single-line text that keeps the end of the string and elides the beginning. */
export function HeadEllipsisText({ children, style }: { children: unknown; style?: StyleProp<TextStyle> }) {
  const spec = resolveHeadEllipsisText(children, Platform.OS)
  return (
    <Text numberOfLines={1} ellipsizeMode={spec.ellipsizeMode} style={[style, spec.style]}>
      {spec.text}
    </Text>
  )
}
