// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test ../../../__tests__/room-workspace.test.ts
// @test ../../../__tests__/room-conversation-screen.test.ts

import type { StyleProp, TextStyle, ViewStyle } from 'react-native'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'

export function RoomHeaderTitle({
  name,
  count,
  style,
  textStyle,
}: {
  name: string
  count: number | null
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // A 2-member Room reads as a plain 1:1 conversation; only real groups (3+) show a count.
  const countSuffix = count === null || count <= 2 ? null : t('spaces_title_with_count', { name: '', count })

  return (
    <View style={[styles.row, style]}>
      <Text
        style={[styles.name, textStyle, { color: colors.text }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {name}
      </Text>
      {countSuffix === null ? null : (
        <Text style={[styles.suffix, textStyle, { color: colors.text }]}>{countSuffix}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { minWidth: 0, flexShrink: 1 },
  suffix: { flexShrink: 0 },
})
