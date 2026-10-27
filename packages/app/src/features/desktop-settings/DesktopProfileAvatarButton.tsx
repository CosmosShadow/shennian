// @arch docs/design/components.md#10-头像徽标与状态点
// @test ../../__tests__/desktop-profile-avatar-button.test.ts
import { useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import { avatarBorderRadius } from '../../components/avatarShape'
import { useTheme } from '../../hooks/useTheme'

export function DesktopProfileAvatarButton({ uri, initial, label, busy, onPress }: {
  uri?: string; initial: string; label: string; busy: boolean; onPress: () => void
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const imageStyle = { width: 56, height: 56, borderRadius: avatarBorderRadius(56) }
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onPress}
    testID="desktop-profile-avatar" onFocus={event => setFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => ({ padding: 3, borderRadius: avatarBorderRadius(56) + 4, borderWidth: 2,
      borderColor: focused ? colors.brand : colors.border,
      backgroundColor: hovered || pressed ? colors.surfaceHover : colors.bg,
      opacity: busy ? 0.45 : pressed ? 0.7 : 1 })}>
    {uri ? <Image source={{ uri }} style={imageStyle} />
      : <View style={[imageStyle, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }]}>
        <Text style={{ color: colors.text, fontSize: 24 }}>{initial}</Text>
      </View>}
  </Pressable>
}
