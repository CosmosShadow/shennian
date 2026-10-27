// @arch docs/features/network-rooms/ui.md#45-消息正文
// @test src/__tests__/room-message-layout.test.ts

import { Platform, type TextStyle } from 'react-native'

type RoomMessageTextStyle = TextStyle & {
  overflowWrap?: 'anywhere'
  whiteSpace?: 'pre-wrap'
  wordBreak?: 'break-word'
}

export function roomMessageTextWrapStyleForPlatform(
  platform: string,
): RoomMessageTextStyle {
  return {
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 1,
    ...(platform === 'web'
      ? {
          overflowWrap: 'anywhere' as const,
          whiteSpace: 'pre-wrap' as const,
          wordBreak: 'break-word' as const,
        }
      : {}),
  }
}

/**
 * React Native wraps long text on iOS and Android. React Native Web also needs
 * an explicit arbitrary break opportunity for paths and other unspaced tokens.
 */
export const roomMessageTextWrapStyle = roomMessageTextWrapStyleForPlatform(Platform.OS)
